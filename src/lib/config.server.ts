import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// All secret reads are centralized here behind small helpers so that handlers
// fail loudly (and consistently) when a required variable is missing, and so
// values are read per-request (important on edge/serverless runtimes).

/** Read a required env var, throwing a clear error when it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Read an optional env var, returning a fallback when unset. */
export function optionalEnv(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
  };
}

// --- Auth ------------------------------------------------------------------

/**
 * The signing secret for session JWTs. Must be reasonably long so HS256
 * signatures cannot be brute-forced. We enforce a minimum length to avoid
 * footguns where a weak/empty secret silently ships to production.
 */
export function getAuthSecret(): string {
  const secret = requireEnv("AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 48",
    );
  }
  return secret;
}

// --- Discord ---------------------------------------------------------------

export function getDiscordConfig() {
  return {
    clientId: requireEnv("DISCORD_CLIENT_ID"),
    clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
    redirectUri: optionalEnv("DISCORD_REDIRECT_URI"),
  };
}

/** Bot token — used for guild operations and webhook management. */
export function getDiscordBotToken(): string | undefined {
  return optionalEnv("DISCORD_BOT_TOKEN");
}

/** Bot token + guild used to auto-join authenticated users to the support server. */
export function getDiscordGuildConfig() {
  return {
    botToken: getDiscordBotToken(),
    guildId: optionalEnv("DISCORD_GUILD_ID"),
  };
}

// --- Payments (CryptAPI, non-custodial) ------------------------------------

/**
 * CryptAPI is keyless and non-custodial: we supply our OWN destination wallet
 * per coin, CryptAPI generates a temporary forwarding address and calls our
 * callback URL on payment. APP_BASE_URL is used to build that callback URL.
 */
export function getCryptApiConfig() {
  return {
    ltcAddress: optionalEnv("CRYPTAPI_LTC_ADDRESS"),
    btcAddress: optionalEnv("CRYPTAPI_BTC_ADDRESS"),
    // Optional public base URL override; otherwise derived from the request.
    appBaseUrl: optionalEnv("APP_BASE_URL"),
  };
}

// --- Database --------------------------------------------------------------

export function getDatabasePath(): string {
  return optionalEnv("DATABASE_PATH", "./data/rexware.db");
}

// --- Ticket system -----------------------------------------------------------

export interface TicketConfig {
  categoryName: string;
  supportRoleId: string;
  archivePrefix: string;
  archiveDelayMs: number;
}

export function getTicketConfig(): TicketConfig {
  const archiveDelayMs = Number(process.env.DISCORD_TICKET_ARCHIVE_DELAY_MS ?? "5000");
  return {
    categoryName: optionalEnv("DISCORD_TICKETS_CATEGORY", "Tickets"),
    supportRoleId: optionalEnv("DISCORD_SUPPORT_ROLE_ID"),
    archivePrefix: optionalEnv("DISCORD_TICKET_ARCHIVE_PREFIX", "closed-"),
    archiveDelayMs: isNaN(archiveDelayMs) ? 5000 : archiveDelayMs,
  };
}

// --- Reviews -----------------------------------------------------------------

export interface ReviewsConfig {
  channelId: string;
}

export function getReviewsConfig(): ReviewsConfig {
  return {
    channelId: optionalEnv("DISCORD_REVIEWS_CHANNEL_ID"),
  };
}

// --- Global Chat -----------------------------------------------------------

export interface GlobalChatConfig {
  channelId: string;
}

export function getGlobalChatConfig(): GlobalChatConfig | null {
  const channelId = optionalEnv("DISCORD_GLOBAL_CHAT_CHANNEL_ID");
  if (!channelId) return null;
  return { channelId };
}

// --- Owner IDs ---------------------------------------------------------------

const DEFAULT_OWNER_IDS = [
  1313146713468309526n,
  423116901498224641n,
  342473721442861062n,
  1270753781688041586n,
  384782722356477953n,
];

/**
 * Returns an array of Discord user IDs that have owner-level access.
 * These IDs bypass all admin checks and have full system access.
 * Configurable via OWNER_IDS env var (comma-separated snowflakes).
 */
export function getOwnerIds(): string[] {
  const envValue = optionalEnv("OWNER_IDS");
  if (envValue) {
    return envValue
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return DEFAULT_OWNER_IDS.map(String);
}

/**
 * Check if a given Discord user ID is an owner.
 */
export function isOwnerId(userId: string): boolean {
  return getOwnerIds().includes(userId);
}

// --- Trial role ---------------------------------------------------------------

export interface TrialRoleConfig {
  trialRoleId: string;
}

export function getTrialRoleConfig(): TrialRoleConfig {
  return {
    trialRoleId: optionalEnv("DISCORD_TRIAL_ROLE_ID"),
  };
}
