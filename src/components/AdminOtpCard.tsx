import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Copy, CheckCircle2, Eye, AlertCircle } from "lucide-react";
import { getAdminOtp } from "@/lib/api/dashboard.functions";
import { useT } from "@/lib/preferences";

// --- Browser-side TOTP (RFC 6238, HMAC-SHA1) --------------------------------
// Mirrors src/lib/totp.server.ts so the displayed code always matches what the
// bot verifies. Computed locally from the secret for a smooth countdown.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret: string): Uint8Array {
  const clean = secret.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function computeTotp(
  secret: string,
  period: number,
  digits: number,
  time = Date.now(),
): Promise<string> {
  const counter = Math.floor(time / 1000 / period);
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export function AdminOtpCard() {
  const t = useT();
  const [config, setConfig] = useState<{
    secret: string;
    period: number;
    digits: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("------");
  const [remaining, setRemaining] = useState(1); // 0..1 fraction of period left
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef("------");

  // Fetch the admin secret once.
  useEffect(() => {
    let active = true;
    getAdminOtp()
      .then((c) => active && setConfig(c))
      .catch((e) =>
        active &&
        setError(e instanceof Error ? e.message : t("adminOtp.loadFail")),
      );
    return () => {
      active = false;
    };
  }, []);

  // Recompute the rotating code + countdown.
  useEffect(() => {
    if (!config) return;
    let active = true;
    const { secret, period, digits } = config;

    async function tick() {
      const now = Date.now();
      const periodMs = period * 1000;
      const frac = 1 - (now % periodMs) / periodMs;
      if (active) setRemaining(frac);
      const next = await computeTotp(secret, period, digits, now);
      if (active && next !== codeRef.current) {
        codeRef.current = next;
        setCode(next);
      }
    }

    tick();
    const id = setInterval(tick, 250);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [config]);

  async function copy() {
    if (!config) return;
    await navigator.clipboard.writeText(code);
    setRevealed(true);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const secondsLeft = config ? Math.ceil(remaining * config.period) : 0;
  // Ring geometry
  const R = 18;
  const C = 2 * Math.PI * R;

  return (
    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-400" />
        <p className="text-sm font-semibold">{t("adminOtp.title")}</p>
        <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
          {t("adminOtp.badge")}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t("adminOtp.desc")}</p>

      {error ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-5">
          {/* Code (blurred until revealed) */}
          <button
            type="button"
            onMouseEnter={() => setRevealed(true)}
            onMouseLeave={() => setRevealed(false)}
            onFocus={() => setRevealed(true)}
            onBlur={() => setRevealed(false)}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? t("adminOtp.hide") : t("adminOtp.reveal")}
            className="group relative rounded-xl bg-background/50 px-5 py-3 outline-none ring-1 ring-border/40 transition focus-visible:ring-2 focus-visible:ring-amber-500/50"
          >
            <span
              className={[
                "block font-mono text-3xl font-semibold tabular-nums tracking-[0.3em] transition-all duration-200 select-none",
                revealed ? "blur-0" : "blur-[10px]",
              ].join(" ")}
            >
              {code}
            </span>
            {!revealed && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                {t("adminOtp.hover")}
              </span>
            )}
          </button>

          {/* Countdown ring */}
          <div className="relative h-12 w-12 shrink-0" aria-hidden="true">
            <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
              <circle
                cx="22"
                cy="22"
                r={R}
                fill="none"
                strokeWidth="3"
                className="stroke-border/40"
              />
              <circle
                cx="22"
                cy="22"
                r={R}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - remaining)}
                className={
                  secondsLeft <= 5 ? "stroke-destructive" : "stroke-amber-400"
                }
                style={{ transition: "stroke-dashoffset 250ms linear" }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
              {secondsLeft}
            </span>
          </div>

          {/* Copy */}
          <button
            type="button"
            onClick={copy}
            disabled={!config}
            aria-label={t("oauth.copyCode")}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      )}
    </div>
  );
}
