import { useEffect, useState } from "react";

/* Multi-step cinematic splash:
   0 → 1  logo scales in with blur
   1 → 2  wordmark slides up
   2 → 3  progress bar animates
   3 → 4  everything blurs out + scales up (exit)
   4 → hidden
*/

export function SplashLogo() {
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 120),  // logo in
      setTimeout(() => setPhase(2), 820),  // wordmark in
      setTimeout(() => setPhase(3), 1600), // exit starts
      setTimeout(() => setPhase(4), 2350), // hidden
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  if (phase === 4) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background pointer-events-none select-none"
      style={{
        transition: "opacity 0.65s cubic-bezier(0.22,1,0.36,1)",
        opacity: phase === 3 ? 0 : 1,
      }}
    >
      {/* Radial vignette */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, transparent 40%, oklch(0 0 0 / 0.55))" }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-6">
        {/* Logo container */}
        <div
          className="relative"
          style={{
            transition: "opacity 0.7s cubic-bezier(0.22,1,0.36,1), transform 0.7s cubic-bezier(0.22,1,0.36,1), filter 0.7s cubic-bezier(0.22,1,0.36,1)",
            opacity: phase >= 1 ? 1 : 0,
            transform: phase >= 1 ? "scale(1) translateY(0)" : "scale(0.78) translateY(8px)",
            filter: phase >= 1 ? "blur(0)" : "blur(14px)",
          }}
        >
          {/* Glow ring (outer) */}
          <div
            className="absolute inset-0 rounded-2xl"
            aria-hidden="true"
            style={{
              boxShadow: phase >= 1
                ? "0 0 0 1px oklch(1 0 0 / 0.10), 0 0 60px oklch(1 0 0 / 0.08)"
                : "none",
              transition: "box-shadow 0.9s ease",
            }}
          />
          {/* Pulsing ring */}
          <div
            className="absolute -inset-3 rounded-3xl border border-white/5"
            aria-hidden="true"
            style={{
              animation: phase === 1 ? "ac-ring-pulse 2s cubic-bezier(0,0,0.2,1) infinite" : "none",
              opacity: phase >= 1 ? 1 : 0,
              transition: "opacity 0.4s ease",
            }}
          />
          <div className="grid h-[72px] w-[72px] place-items-center rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-xl shadow-[0_4px_32px_oklch(0_0_0/0.6)]">
            <img src="/logo.png" alt="RexWare" className="h-10 w-10" />
          </div>
        </div>

        {/* Wordmark */}
        <div
          className="flex flex-col items-center gap-2"
          style={{
            transition: "opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)",
            opacity: phase >= 2 ? 1 : 0,
            transform: phase >= 2 ? "translateY(0)" : "translateY(10px)",
          }}
        >
          <span className="text-sm font-medium tracking-[0.35em] text-foreground/90 uppercase">
            REXWARE
          </span>

          {/* Animated bar */}
          <div className="h-px bg-white/[0.07] rounded-full overflow-hidden" style={{ width: "48px" }}>
            <div
              className="h-full bg-white/40 rounded-full"
              style={{
                transition: "width 0.85s cubic-bezier(0.22,1,0.36,1)",
                width: phase >= 2 ? "100%" : "0%",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
