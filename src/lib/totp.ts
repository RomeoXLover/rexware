// Shared TOTP constants (pure values — safe for both client and server).
export const TOTP_PERIOD = 30; // seconds per code
export const TOTP_DIGITS = 6;
export const TOTP_ALGO = "sha1"; // matches standard authenticator apps
