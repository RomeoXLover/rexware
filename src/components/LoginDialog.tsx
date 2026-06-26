"use client";

import {
  createContext, useCallback, useContext,
  useEffect, useRef, useState, type ReactNode
} from "react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { fetchSessionUser } from "@/lib/api/auth.functions";
import { useT } from "@/lib/preferences";

type Ctx = { open: () => void; close: () => void };
const LoginDialogContext = createContext<Ctx | null>(null);

export function useLoginDialog() {
  const ctx = useContext(LoginDialogContext);
  if (!ctx) throw new Error("useLoginDialog must be used within LoginDialogProvider");
  return ctx;
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3a13.51 13.51 0 0 0-.61 1.247 18.27 18.27 0 0 0-5.487 0A12.46 12.46 0 0 0 9.85 3a19.74 19.74 0 0 0-3.76 1.37C2.66 9.413 1.73 14.33 2.19 19.176a19.9 19.9 0 0 0 6.034 3.04c.487-.66.92-1.36 1.293-2.1a12.93 12.93 0 0 1-2.037-.97c.171-.124.338-.253.5-.385a14.21 14.21 0 0 0 12.04 0c.163.132.33.261.5.385-.65.385-1.334.712-2.04.972.373.74.806 1.44 1.293 2.099a19.86 19.86 0 0 0 6.038-3.04c.54-5.61-.92-10.486-3.875-14.806ZM9.682 16.46c-1.183 0-2.157-1.084-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.955 2.418-2.157 2.418Zm7.974 0c-1.184 0-2.157-1.084-2.157-2.418 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

/* ─── Particle canvas ─── */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -999, y: -999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const COUNT = 55;
    const MAX_DIST = 140;
    let raf: number;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();

    // Cool palette: indigo / blue / cyan / violet — gives the constellation
    // subtle color while staying calm and premium.
    const HUES = [232, 248, 268, 200];
    const pts = Array.from({ length: COUNT }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.32,
      vy: (Math.random() - 0.5) * 0.32,
      r: Math.random() * 1.6 + 1.0,
      opacity: Math.random() * 0.35 + 0.25,
      hue: HUES[Math.floor(Math.random() * HUES.length)],
    }));

    const loop = () => {
      const { width: W, height: H } = canvas;
      const { x: mx, y: my } = mouseRef.current;
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < MAX_DIST) {
            const t = 1 - d / MAX_DIST;
            const hue = (a.hue + b.hue) / 2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `hsla(${hue}, 70%, 72%, ${t * t * 0.26})`;
            ctx.lineWidth = t * 1.4 + 0.3;
            ctx.stroke();
          }
        }
        const md = Math.hypot(a.x - mx, a.y - my);
        if (md < MAX_DIST * 1.5) {
          const t = 1 - md / (MAX_DIST * 1.5);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mx, my);
          ctx.strokeStyle = `hsla(${a.hue}, 85%, 78%, ${t * 0.55})`;
          ctx.lineWidth = t * 1.8 + 0.4;
          ctx.stroke();
        }
      }

      for (const p of pts) {
        const glow = Math.max(0, 1 - Math.hypot(p.x - mx, p.y - my) / 140);
        if (glow > 0.01) {
          const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r + 9);
          halo.addColorStop(0, `hsla(${p.hue}, 90%, 75%, ${glow * 0.5})`);
          halo.addColorStop(1, "hsla(0,0%,0%,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + glow * 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 75%, 85%, ${p.opacity + glow * 0.4})`;
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
      }

      raf = requestAnimationFrame(loop);
    };

    loop();
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={(e) => {
        const r = canvasRef.current!.getBoundingClientRect();
        mouseRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => { mouseRef.current = { x: -999, y: -999 }; }}
      className="absolute inset-0 w-full h-full"
    />
  );
}

/* ─── Hovering Discord button with shimmer ─── */
function DiscordButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const t = useT();

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative w-full flex items-center justify-center gap-2.5 py-3 rounded-[11px] overflow-hidden
                 text-white text-sm font-medium
                 active:scale-[0.982] transition-all duration-200"
      style={{
        background: hovered
          ? "linear-gradient(180deg, oklch(0.6 0.18 264 / 0.95), oklch(0.52 0.18 264 / 0.95))"
          : "oklch(0.55 0.16 264 / 0.16)",
        border: `1px solid ${hovered ? "oklch(0.72 0.16 264 / 0.6)" : "oklch(0.7 0.12 264 / 0.28)"}`,
        boxShadow: hovered
          ? "0 6px 28px oklch(0.5 0.18 264 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.18)"
          : "inset 0 1px 0 oklch(1 0 0 / 0.06)",
        transform: hovered ? "translateY(-1px)" : "none",
        transition: "all 0.25s cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* Shimmer sweep on hover */}
      {hovered && (
        <span
          className="pointer-events-none absolute inset-y-0 w-1/3"
          style={{
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
            animation: "shimmer-slide 0.65s cubic-bezier(0.22,1,0.36,1) forwards",
          }}
        />
      )}
      <DiscordIcon className="w-[22px] h-[17px] relative z-10" />
      <span className="relative z-10">{t("login.discord")}</span>
    </button>
  );
}

export function LoginDialogProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <LoginDialogContext.Provider value={{ open, close }}>
      {children}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="p-0 overflow-hidden border-0 max-w-none w-screen h-screen rounded-none bg-transparent shadow-none">

          {/* Scan line effect */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-[5]">
            <div
              className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent"
              style={{ animation: "scan 5s linear infinite" }}
            />
          </div>

          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{
              // Tinted indigo charcoal — never pure black — with a cool light
              // pool rising from the bottom, matching the site theme.
              backgroundColor: "oklch(0.165 0.013 264)",
              backgroundImage:
                "radial-gradient(ellipse 90% 55% at 50% 120%, oklch(0.55 0.14 264 / 0.4), transparent 70%)," +
                "radial-gradient(ellipse 60% 45% at 82% 110%, oklch(0.62 0.13 205 / 0.22), transparent 72%)," +
                "radial-gradient(ellipse 70% 40% at 50% -10%, oklch(0.45 0.08 264 / 0.25), transparent 70%)",
            }}
          >
            {/* Colorful animated aurora drifting behind everything */}
            <div
              className="pointer-events-none absolute"
              style={{
                width: "min(820px, 90vw)",
                height: "min(820px, 90vh)",
                background:
                  "radial-gradient(38% 50% at 32% 38%, oklch(0.6 0.16 264 / 0.32), transparent 70%)," +
                  "radial-gradient(42% 48% at 70% 30%, oklch(0.66 0.14 200 / 0.26), transparent 70%)," +
                  "radial-gradient(46% 56% at 52% 72%, oklch(0.58 0.16 300 / 0.24), transparent 72%)",
                filter: "blur(46px)",
                animation: "ac-aurora-drift 18s ease-in-out infinite alternate",
              }}
              aria-hidden="true"
            />

            <ParticleCanvas />

            {/* Depth radial glow behind card */}
            <div
              className="pointer-events-none absolute"
              style={{
                width: "520px",
                height: "520px",
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, oklch(0.7 0.12 264 / 0.07) 0%, transparent 65%)",
                animation: "ac-glow-drift 12s ease-in-out infinite",
              }}
              aria-hidden="true"
            />

            {/* Card */}
            <div
              className="ac-login-ring relative z-10 w-full max-w-[380px] mx-4 flex flex-col items-center
                          px-9 py-10 backdrop-blur-2xl"
              style={{
                background:
                  "linear-gradient(160deg, oklch(0.22 0.02 264 / 0.86), oklch(0.17 0.016 264 / 0.9))",
                borderRadius: "18px",
                boxShadow:
                  "inset 0 1px 0 oklch(1 0 0 / 0.06), 0 24px 80px oklch(0.05 0.02 264 / 0.8), 0 8px 32px oklch(0.4 0.12 264 / 0.25)",
                animation: "fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both",
              }}
            >
              {/* Inner top highlight */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-[18px]"
                style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }}
                aria-hidden="true"
              />

              {/* Logo */}
              <div
                className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10"
                style={{
                  background:
                    "radial-gradient(120% 120% at 50% 0%, oklch(0.55 0.14 264 / 0.22), oklch(1 0 0 / 0.04))",
                  boxShadow:
                    "inset 0 1px 0 oklch(1 0 0 / 0.12), 0 8px 28px oklch(0.5 0.16 264 / 0.35)",
                  animation: "ac-splash-in 0.7s cubic-bezier(0.22,1,0.36,1) 0.1s both",
                }}
              >
                <img src="/logo.png" alt="SkyUtils" className="h-8 w-8" />
              </div>

              <DialogTitle
                className="text-[20px] font-semibold text-[#f2f2f2] text-center mb-1.5 tracking-tight"
                style={{ animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.18s both" }}
              >
                {t("login.title")}
              </DialogTitle>
              <DialogDescription
                className="text-[13px] text-white/35 text-center leading-relaxed mb-7 max-w-[260px]"
                style={{ animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.26s both" }}
              >
                {t("login.subtitle")}
              </DialogDescription>

              {/* Divider */}
              <div
                className="w-full mb-4"
                style={{ animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.32s both" }}
              >
                <div className="h-px bg-white/[0.06]" />
              </div>

              {/* Discord button */}
              <div
                className="w-full"
                style={{ animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.38s both" }}
              >
                <DiscordButton
                  onClick={async () => {
                    const user = await fetchSessionUser();
                    if (user) { window.location.href = "/dash"; return; }
                    window.location.href = "/api/auth/discord";
                  }}
                />
              </div>

              {/* Footer */}
              <p
                className="mt-5 text-[11px] text-white/18 text-center leading-relaxed"
                style={{ animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 0.44s both" }}
              >
                {t("login.agree.pre")}{" "}
                <span className="text-white/30 underline decoration-white/[0.12] cursor-pointer hover:text-white/50 transition-colors duration-200">
                  {t("login.agree.tos")}
                </span>
                {" "}{t("login.agree.and")}{" "}
                <span className="text-white/30 underline decoration-white/[0.12] cursor-pointer hover:text-white/50 transition-colors duration-200">
                  {t("login.agree.privacy")}
                </span>.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </LoginDialogContext.Provider>
  );
}
