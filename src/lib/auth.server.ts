import process from "node:process";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  getCookie,
  setCookie,
  deleteCookie,
  getRequestHeaders,
  getRequestIP,
} from "@tanstack/react-start/server";

import {
  getAuthSecret,
  getDiscordConfig,
  getDiscordGuildConfig,
  getGlobalChatConfig,
  isOwnerId,
  isProd,
} from "./config.server";
import {
  usersRepo,
  bannedIpsRepo,
  userWebhooksRepo,
  type UserRow,
} from "./repos.server";

// ---------------------------------------------------------------------------
// Server-only auth helpers for Discord OAuth2.
// The `.server.ts` suffix keeps every secret here out of the client bundle.
// Flow: /api/auth/discord -> Discord consent -> /api/auth/discord/callback
// On success we upsert the user into SQLite, optionally add them to the
// support guild, then mint a signed JWT stored in an HttpOnly cookie.
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "session";
const STATE_COOKIE = "oauth_state";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

const JWT_ISSUER = "rexware";
const JWT_AUDIENCE = "rexware-dashboard";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = `${DISCORD_API}/oauth2/token`;
const DISCORD_USER = `${DISCORD_API}/users/@me`;
const OAUTH_SCOPE = "identify email guilds.join guilds.members.read";

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string;
  email: string | null;
  is_owner: number;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar: string | null;
  discriminator?: string;
  email?: string | null;  
  verified?: boolean;     
}

/** Derive the redirect URI from the incoming request origin so it works in
 *  any deploy/preview environment without extra config. */
export function getRedirectUri(requestUrl: URL): string {
  const { redirectUri } = getDiscordConfig();
  if (redirectUri) return redirectUri;
  return `${requestUrl.origin}/api/auth/discord/callback`;
}

// --- OAuth state (CSRF protection) -----------------------------------------

export function createState(): string {
  const state = crypto.randomBytes(32).toString("hex");
  setCookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 minutes to complete the round trip
  });
  return state;
}

export function verifyState(received: string | null): boolean {
  const expected = getCookie(STATE_COOKIE);
  // One-time use: always clear it.
  deleteCookie(STATE_COOKIE, { path: "/" });
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- Referral attribution cookie -------------------------------------------
// Set when a visitor lands with ?ref=CODE, read once after OAuth signup, then
// cleared. Not httpOnly-sensitive (just a referral code), but kept httpOnly so
// it isn't tampered with client-side.

const REFERRAL_COOKIE = "mf_ref";

export function setReferralCookie(code: string): void {
  setCookie(REFERRAL_COOKIE, code, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days to sign up
  });
}

export function getReferralCookie(): string | null {
  return getCookie(REFERRAL_COOKIE) ?? null;
}

export function clearReferralCookie(): void {
  deleteCookie(REFERRAL_COOKIE, { path: "/" });
}

export function buildAuthorizeUrl(redirectUri: string, state: string): string {
  const { clientId } = getDiscordConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    state,
    prompt: "consent",
  });
  return `${DISCORD_AUTHORIZE}?${params.toString()}`;
}

// --- Token exchange + profile fetch -----------------------------------------

export interface OAuthResult {
  user: SessionUser;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number | null;
}

export async function exchangeCodeForUser(
  code: string,
  redirectUri: string,
): Promise<OAuthResult> {
  const { clientId, clientSecret } = getDiscordConfig();

  const tokenRes = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const status = tokenRes.status;
    if (status === 401) throw new Error("discord_invalid_client");
    if (status === 403) throw new Error("discord_forbidden");
    if (status === 400) throw new Error("discord_bad_request");
    throw new Error("discord_token_failed");
  }

  const token = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
  };

  const expiresAt = token.expires_in
    ? Date.now() + token.expires_in * 1000
    : undefined;

  const userRes = await fetch(DISCORD_USER, {
    headers: { Authorization: `${token.token_type} ${token.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error("discord_user_failed");
  }

  const profile = (await userRes.json()) as DiscordUser;
  return {
    user: toSessionUser(profile),
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: expiresAt ?? null,
  };
}

function toSessionUser(profile: DiscordUser): SessionUser {
  let avatarUrl: string;
  if (profile.avatar) {
    const ext = profile.avatar.startsWith("a_") ? "gif" : "png";
    avatarUrl = `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${ext}?size=128`;
  } else {
    const index = (BigInt(profile.id) >> 22n) % 6n;
    avatarUrl = `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  
  return {
    id: profile.id,
    username: profile.username,
    globalName: profile.global_name ?? null,
    avatarUrl,
    email: profile.email ?? null,  // ✅ Aggiungi email
  };
}

// --- Support guild auto-join ------------------------------------------------

/**
 * Adds the authenticated user to the support guild using the bot token and the
 * user's OAuth access token (requires the `guilds.join` scope). No-ops cleanly
 * when the bot token / guild id are not configured, so login never breaks.
 * Returns true if the user is now a member (added or already present).
 */
export async function addUserToSupportGuild(
  userId: string,
  accessToken: string,
): Promise<boolean> {
  const { botToken, guildId } = getDiscordGuildConfig();
  
  if (!botToken || !guildId) {
    return false;
  }

  try {
    const res = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${userId}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
    
    // 201 = aggiunto, 204 = già membro
    const success = res.status === 201 || res.status === 204;
    
    if (success) {
    }
    
    return success;
  } catch (err) {
    console.error("Errore aggiunta al guild:", err);
    return false;
  }
}

// --- Global Chat webhook (per-user) ----------------------------------------

/**
 * Creates a Discord webhook in the global chat channel for the given user.
 * This allows sending messages FROM the web TO Discord AS the user, with their
 * avatar and username. Safe to call multiple times — idempotent per user/channel.
 * No-ops when DISCORD_GLOBAL_CHAT_CHANNEL_ID is not configured.
 */
export async function createGlobalChatWebhook(
  userId: string,
  username: string,
  avatarUrl: string | null,
): Promise<void> {
  const config = getGlobalChatConfig();
  if (!config) return;

  const { botToken } = getDiscordGuildConfig();
  if (!botToken) return;

  try {
    // Fetch avatar and convert to base64 data URI for Discord webhook
    let avatarData: string | null = null;
    if (avatarUrl) {
      try {
        const avatarRes = await fetch(avatarUrl);
        if (avatarRes.ok) {
          const blob = await avatarRes.blob();
          const buffer = Buffer.from(await blob.arrayBuffer());
          avatarData = `data:${blob.type};base64,${buffer.toString("base64")}`;
        }
      } catch {
        // Ignore avatar fetch errors — webhook will use default avatar
      }
    }

    const res = await fetch(`${DISCORD_API}/channels/${config.channelId}/webhooks`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: username,
        avatar: avatarData,
      }),
    });

    if (!res.ok) {
      console.error(`Failed to create global chat webhook for user ${userId}: ${res.status}`);
      return;
    }

    const webhook = (await res.json()) as {
      id: string;
      token: string;
      url: string;
    };

    await userWebhooksRepo.set(userId, config.channelId, webhook.url, webhook.token);
  } catch (err) {
    console.error(`Error creating global chat webhook for user ${userId}:`, err);
  }
}

// --- Session cookie (signed JWT) --------------------------------------------

export function createSession(user: SessionUser): void {
  const token = jwt.sign({ user }, getAuthSecret(), {
    algorithm: "HS256",
    expiresIn: SESSION_MAX_AGE,
    subject: user.id,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function getSessionUser(): SessionUser | null {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getAuthSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }) as { user?: SessionUser };
    return payload.user ?? null;
  } catch {
    return null;
  }
}

export function destroySession(): void {
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

// --- Client IP extraction ---------------------------------------------------

/**
 * Extracts the real client IP. Prefers Cloudflare / proxy headers, falls back
 * to the h3 built-in getRequestIP(). Returns null when not determinable.
 */
export function getClientIp(): string | null {
  try {
    // Proxy / CDN headers have the real client IP
    const headers = getRequestHeaders();
    const cf = headers["cf-connecting-ip"];
    if (cf) return cf.trim();
    const xff = headers["x-forwarded-for"];
    if (xff) return xff.split(",")[0].trim();
    const xri = headers["x-real-ip"];
    if (xri) return xri.trim();
    // Fallback: h3 built-in (works without a proxy)
    const ip = getRequestIP({ xForwardedFor: true });
    return ip ?? null;
  } catch {
    return null;
  }
}

/**
 * Two-letter country code Cloudflare attaches to every request via the
 * `CF-IPCountry` header. Returns the value uppercased, or null. Cloudflare uses
 * the pseudo-code "T1" for traffic exiting the Tor network, which we rely on to
 * block Tor reliably regardless of WAF rules.
 */
export function getRequestCountry(): string | null {
  try {
    const headers = getRequestHeaders();
    const c = headers["cf-ipcountry"];
    return c ? c.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

// --- Ban status -------------------------------------------------------------

export type BanReason = "account" | "ip" | null;

/**
 * Returns why the current request is banned, or null if not banned.
 * Checks both account-level ban (DB flag) and IP-level ban.
 * Does NOT throw — safe to call in beforeLoad.
 */
export async function getBanStatus(): Promise<BanReason> {
  const ip = getClientIp();
  if (ip && (await bannedIpsRepo.isBanned(ip))) return "ip";

  const session = getSessionUser();
  if (!session) return null;
  const row = await usersRepo.byId(session.id);
  if (row?.is_banned) return "account";
  return null;
}

// --- Server-side guards -----------------------------------------------------

/**
 * Resolves the current user from the session cookie AND the database. Throws
 * when unauthenticated or banned. Use inside server functions / handlers — it
 * is the single source of truth for "who is making this request".
 */
export async function requireUser(): Promise<UserRow> {
  // IP ban check first — applies even to unauthenticated requests
  const ip = getClientIp();
  if (ip && (await bannedIpsRepo.isBanned(ip))) throw new Error("BANNED");

  const session = getSessionUser();
  if (!session) throw new Error("UNAUTHORIZED");
  const row = await usersRepo.byId(session.id);
  if (!row) throw new Error("UNAUTHORIZED");
  if (row.is_banned) throw new Error("BANNED");
  return row;
}

/** Like requireUser but additionally enforces the admin flag from the DB, OR owner status. */
export async function requireAdmin(): Promise<UserRow> {
  const user = await requireUser();
  if (!user.is_admin && !isOwnerId(user.id)) throw new Error("FORBIDDEN");
  return user;
}

/**
 * Check if the current session user is an owner (bypasses admin check).
 * Returns null if not authenticated or not an owner.
 */
export async function isOwner(): Promise<boolean> {
  const session = getSessionUser();
  if (!session) return false;
  return isOwnerId(session.id);
}

/** Like requireUser but enforces owner status (bypasses admin check). */
export async function requireOwner(): Promise<UserRow> {
  const user = await requireUser();
  if (!isOwnerId(user.id)) throw new Error("FORBIDDEN");
  return user;
}
