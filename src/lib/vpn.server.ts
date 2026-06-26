import process from "node:process";

import { getClientIp, getRequestCountry, getSessionUser } from "./auth.server";
import { botSettingsRepo, usersRepo, vpnCacheRepo } from "./repos.server";

// ---------------------------------------------------------------------------
// Anti-VPN / proxy detection (server-only).
//
// `getVpnStatus()` decides whether the current request should be blocked. It is
// deliberately defensive: it NEVER throws, so it is safe to await inside a
// router `beforeLoad`. When detection is disabled, misconfigured, or the lookup
// fails, it fails OPEN (blocked: false) so a provider outage can't lock out the
// whole site.
//
// The actual IP reputation lookup is pluggable — see `lookupIp()`. Wire your
// preferred provider there (suggestions are documented in the chat).
// ---------------------------------------------------------------------------

export type VpnReason = "vpn" | "proxy" | "tor" | "hosting" | null;
export interface VpnStatus {
  blocked: boolean;
  reason: VpnReason;
}

interface IpVerdict {
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
  hosting: boolean;
}

// Two-tier verdict cache. IP reputation rarely changes, so we cache for a long
// window to stay well under provider rate limits (proxycheck free = 1000/day).
//   tier 1: in-memory (fast, per-instance, cleared on restart)
//   tier 2: DB (persistent, shared across instances) — see vpnCacheRepo
// With tier 2, each IP costs at most ONE provider lookup per TTL window.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const cache = new Map<string, { verdict: IpVerdict; expires: number }>();

function getMemCached(ip: string): IpVerdict | null {
  const hit = cache.get(ip);
  if (hit && hit.expires > Date.now()) return hit.verdict;
  if (hit) cache.delete(ip);
  return null;
}

/** Reads memory first, then the persistent DB cache. */
async function getCached(ip: string): Promise<IpVerdict | null> {
  const mem = getMemCached(ip);
  if (mem) return mem;
  const row = await vpnCacheRepo.get(ip);
  if (!row) return null;
  const verdict: IpVerdict = {
    vpn: row.vpn === 1,
    proxy: row.proxy === 1,
    tor: row.tor === 1,
    hosting: row.hosting === 1,
  };
  // Re-warm the in-memory tier without resetting the DB expiry.
  cache.set(ip, { verdict, expires: row.expires_at });
  return verdict;
}

/** Writes both cache tiers. Only called after a real provider lookup. */
async function setCached(ip: string, verdict: IpVerdict): Promise<void> {
  const expires = Date.now() + CACHE_TTL_MS;
  cache.set(ip, { verdict, expires });
  try {
    await vpnCacheRepo.set(ip, verdict, expires);
  } catch {
    // DB write failure must not break the request — memory cache still applies.
  }
}

/** Loopback, RFC1918 and link-local ranges — never treated as VPNs. */
function isPrivateIp(ip: string): boolean {
  return (
    /^(10\.|127\.|192\.168\.|169\.254\.|::1|fc00:|fd00:|fe80:)/i.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

// ---------------------------------------------------------------------------
// Tor exit-node list (authoritative, free, no Cloudflare/provider needed).
// The Tor Project publishes the full list of exit relay IPs. We fetch it,
// cache it in memory, and refresh hourly. This is the most reliable way to
// block Tor regardless of how the request reaches the app.
// ---------------------------------------------------------------------------
const TOR_LIST_TTL_MS = 60 * 60 * 1000; // refresh hourly
let torExits: Set<string> | null = null;
let torExitsExpires = 0;
let torRefreshing: Promise<void> | null = null;

async function refreshTorExits(): Promise<void> {
  // Two independent sources; merge whatever responds.
  const sources = [
    "https://check.torproject.org/torbulkexitlist",
    "https://www.dan.me.uk/torlist/?exit",
  ];
  const set = new Set<string>();
  for (const src of sources) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const text = await res.text();
      for (const line of text.split("\n")) {
        const ip = line.trim();
        if (ip && !ip.startsWith("#")) set.add(ip);
      }
    } catch {
      // try next source
    }
  }
  if (set.size > 0) {
    torExits = set;
    torExitsExpires = Date.now() + TOR_LIST_TTL_MS;
    console.log("[v0] vpn: tor exit list loaded,", set.size, "nodes");
  } else {
    console.log("[v0] vpn: tor exit list fetch returned nothing");
  }
}

async function isTorExit(ip: string): Promise<boolean> {
  if (!torExits || Date.now() > torExitsExpires) {
    if (!torRefreshing) {
      torRefreshing = refreshTorExits().finally(() => {
        torRefreshing = null;
      });
    }
    // First-ever load: wait so the very first Tor visitor is caught.
    if (!torExits) await torRefreshing;
  }
  return torExits?.has(ip) ?? false;
}

// ---------------------------------------------------------------------------
// Provider lookup. Swap the provider via env: VPN_PROVIDER + VPN_API_KEY.
// Currently supports "proxycheck" and "ipqualityscore". Returns null on any
// failure so the caller fails open.
// ---------------------------------------------------------------------------
async function lookupIp(ip: string): Promise<IpVerdict | null> {
  const provider = (process.env.VPN_PROVIDER || "").toLowerCase().trim();
  const apiKey = process.env.VPN_API_KEY?.trim() || "";
  if (!provider) return null; // detection not configured -> fail open

  try {
    if (provider === "proxycheck") {
      // https://proxycheck.io/api/  (key optional on the free tier)
      const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=3&risk=1${apiKey ? `&key=${apiKey}` : ""}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) {
        console.log("[v0] vpn: proxycheck http error", res.status);
        return null;
      }
      const json = (await res.json()) as Record<string, any>;
      // Surface API-level problems (bad key, quota exceeded, etc.) instead of
      // silently failing open.
      if (json.status && json.status !== "ok") {
        console.log("[v0] vpn: proxycheck status =", json.status, "message =", json.message);
      }
      const node = json[ip];
      if (!node || typeof node !== "object") return null;
      console.log("[v0] vpn: proxycheck node =", JSON.stringify(node));
      const proxy = node.proxy === "yes";
      const type = String(node.type || "").toLowerCase();
      const risk = typeof node.risk === "number" ? node.risk : 0;
      return {
        // A VPN is reported either via type "VPN" or via the proxy flag with a
        // high risk score. Don't require both, so anonymizing VPNs are caught.
        vpn: type === "vpn" || (proxy && risk >= 66),
        proxy: proxy || risk >= 66,
        tor: type === "tor",
        hosting: type === "hosting" || type === "compromised server",
      };
    }

    if (provider === "ipqualityscore") {
      // https://www.ipqualityscore.com/documentation/proxy-detection/overview
      const url = `https://ipqualityscore.com/api/json/ip/${apiKey}/${encodeURIComponent(ip)}?strictness=1`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (!res.ok) return null;
      const json = (await res.json()) as Record<string, any>;
      if (json.success === false) return null;
      return {
        vpn: !!json.vpn,
        proxy: !!json.proxy,
        tor: !!json.tor,
        hosting: !!json.hosting,
      };
    }

    return null;
  } catch {
    return null; // timeout / network error -> fail open
  }
}

/**
 * Evaluates the current request. Never throws.
 * Bypassed for: admins, private/dev IPs, and any IP in the allowlist.
 */
export async function getVpnStatus(): Promise<VpnStatus> {
  try {
    const enabled = (await botSettingsRepo.get("vpn_block")) === "1";
    console.log("[v0] vpn: enabled =", enabled);
    if (!enabled) return { blocked: false, reason: null };

    const ip = getClientIp();
    console.log("[v0] vpn: clientIp =", ip, "private =", ip ? isPrivateIp(ip) : "n/a");
    if (!ip || isPrivateIp(ip)) return { blocked: false, reason: null };

    // Manual allowlist (comma/space separated) — e.g. office or staff IPs.
    const allowRaw = (await botSettingsRepo.get("vpn_allowlist")) || "";
    const allow = allowRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (allow.includes(ip)) {
      console.log("[v0] vpn: ip in allowlist, bypassing");
      return { blocked: false, reason: null };
    }

    // Admins always bypass.
    const session = getSessionUser();
    if (session) {
      const u = await usersRepo.byId(session.id);
      if (u?.is_admin) {
        console.log("[v0] vpn: admin user, bypassing");
        return { blocked: false, reason: null };
      }
    }

    // Tor — two independent checks, neither needs a paid provider:
    //  1) Cloudflare's pseudo-country "T1" via CF-IPCountry (only if proxied).
    //  2) The authoritative Tor Project exit-node list (always works).
    console.log("[v0] vpn: cf-ipcountry =", getRequestCountry());
    if (getRequestCountry() === "T1") return { blocked: true, reason: "tor" };
    if (await isTorExit(ip)) {
      console.log("[v0] vpn: ip is a known Tor exit node");
      return { blocked: true, reason: "tor" };
    }

    // Cache hit (memory or DB) costs zero provider quota.
    let verdict = await getCached(ip);
    console.log("[v0] vpn: cached verdict =", JSON.stringify(verdict));
    if (!verdict) {
      // Cache miss: spend exactly one provider lookup, then persist the result.
      verdict = await lookupIp(ip);
      console.log("[v0] vpn: provider lookup verdict =", JSON.stringify(verdict), "provider =", process.env.VPN_PROVIDER);
      if (!verdict) return { blocked: false, reason: null };
      await setCached(ip, verdict);
    }

    // Which categories to block. Hosting/datacenter IPs are opt-in because they
    // also cover some mobile carriers and corporate gateways.
    const blockHosting = (await botSettingsRepo.get("vpn_block_hosting")) === "1";

    if (verdict.tor) return { blocked: true, reason: "tor" };
    if (verdict.vpn) return { blocked: true, reason: "vpn" };
    if (verdict.proxy) return { blocked: true, reason: "proxy" };
    if (blockHosting && verdict.hosting) return { blocked: true, reason: "hosting" };

    return { blocked: false, reason: null };
  } catch {
    return { blocked: false, reason: null };
  }
}
