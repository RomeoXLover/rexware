/**
 * rexware — TOTP (RFC 6238) core.
 *
 * Used to gate critical admin actions behind a rotating one-time code that the
 * admin reads from the authenticated website (Settings → Admin OTP) and types
 * into the Discord bot. The secret lives server-side, per admin, and is only
 * ever exposed to that admin's own logged-in web session — so it acts as a
 * true second factor that is independent of the admin's Discord account.
 *
 * This module is plain Node (node:crypto) so it runs identically in both the
 * web container and the bot container.
 */

// Re-exported from ./totp for convenience (no node: imports here).
export const TOTP_PERIOD = 30; // seconds per code
export const TOTP_DIGITS = 6;
export const TOTP_ALGO = "sha1"; // matches standard authenticator apps

// --- Base32 (RFC 4648, no padding) -----------------------------------------

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a new random base32 secret (default 20 bytes → 32 chars). */
export function generateBase32Secret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // skip invalid chars
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// --- TOTP -------------------------------------------------------------------

/** Compute the TOTP code for a given secret at a given time (ms epoch). */
export function totp(
  secret: string,
  opts: { time?: number; period?: number; digits?: number } = {},
): string {
  const period = opts.period ?? TOTP_PERIOD;
  const digits = opts.digits ?? TOTP_DIGITS;
  const time = opts.time ?? Date.now();
  const counter = Math.floor(time / 1000 / period);

  const key = base32Decode(secret);
  const counterBuf = Buffer.alloc(8);
  // 64-bit big-endian counter (high word is 0 for any realistic timestamp).
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac(TOTP_ALGO, key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * Verify a token against a secret, allowing a small window of clock drift.
 * `window = 1` accepts the previous, current and next period (±30s).
 */
export function verifyTotp(
  secret: string,
  token: string,
  opts: { window?: number; period?: number; digits?: number; time?: number } = {},
): boolean {
  const window = opts.window ?? 1;
  const period = opts.period ?? TOTP_PERIOD;
  const digits = opts.digits ?? TOTP_DIGITS;
  const time = opts.time ?? Date.now();

  const cleaned = token.replace(/\D/g, "");
  if (cleaned.length !== digits) return false;

  for (let drift = -window; drift <= window; drift++) {
    const candidate = totp(secret, {
      time: time + drift * period * 1000,
      period,
      digits,
    });
    const a = Buffer.from(candidate);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Milliseconds remaining until the current code rotates. */
export function msUntilRotation(time = Date.now(), period = TOTP_PERIOD): number {
  return period * 1000 - (time % (period * 1000));
}
