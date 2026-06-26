import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { Wrench, ArrowRight } from "lucide-react";

import { fetchMaintenance } from "@/lib/api/auth.functions";
import { useT } from "@/lib/preferences";

export const Route = createFileRoute("/maintenance")({
  beforeLoad: async () => {
    const { enabled, message, bypass } = await fetchMaintenance();
    // If maintenance is off, or the viewer is an admin, there's nothing to show.
    if (!enabled || bypass) throw redirect({ to: "/" });
    return { message };
  },
  loader: ({ context }) => ({ message: (context as { message: string }).message }),
  component: MaintenancePage,
});

// Decorative floating bubbles — randomized but stable per render.
const FLOAT_BUBBLES = [
  { size: 220, top: "8%", left: "-4%", delay: "0s", duration: "18s", opacity: 0.5 },
  { size: 140, top: "62%", left: "6%", delay: "-4s", duration: "20s", opacity: 0.45 },
  { size: 90, top: "20%", left: "82%", delay: "-2s", duration: "15s", opacity: 0.55 },
  { size: 300, top: "55%", left: "70%", delay: "-7s", duration: "24s", opacity: 0.35 },
  { size: 60, top: "80%", left: "40%", delay: "-1s", duration: "14s", opacity: 0.6 },
];

const RISE_BUBBLES = [
  { size: 28, left: "12%", delay: "0s", duration: "20s" },
  { size: 16, left: "28%", delay: "-6s", duration: "26s" },
  { size: 40, left: "48%", delay: "-12s", duration: "22s" },
  { size: 20, left: "66%", delay: "-3s", duration: "24s" },
  { size: 34, left: "84%", delay: "-9s", duration: "28s" },
  { size: 12, left: "92%", delay: "-15s", duration: "19s" },
];

function MaintenancePage() {
  const { message } = Route.useLoaderData();
  const t = useT();

  return (
    <div className="ac-noise relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      {/* Ambient hero glow */}
      <div
        className="ac-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[700px] opacity-70"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden="true"
      />

      {/* Floating bubbles */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        {FLOAT_BUBBLES.map((b, i) => (
          <span
            key={`f-${i}`}
            className="ac-bubble ac-bubble-float"
            style={{
              width: b.size,
              height: b.size,
              top: b.top,
              left: b.left,
              opacity: b.opacity,
              animationDelay: b.delay,
              animationDuration: b.duration,
            }}
          />
        ))}
        {RISE_BUBBLES.map((b, i) => (
          <span
            key={`r-${i}`}
            className="ac-bubble ac-bubble-rise"
            style={{
              width: b.size,
              height: b.size,
              bottom: -b.size,
              left: b.left,
              animationDelay: b.delay,
              animationDuration: b.duration,
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md text-center">
        <div
          className="ac-icon-breathe mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl"
          style={{ animation: "fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <Wrench className="h-7 w-7 text-primary" />
        </div>

        <h1
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.08s both" }}
        >
          {t("maint.title")}
        </h1>

        <p
          className="mx-auto mt-4 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base"
          style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.16s both" }}
        >
          {message}
        </p>

        {/* Subtle animated divider */}
        <div
          className="mx-auto mt-8 h-px w-12 bg-border"
          style={{ animation: "ac-splash-bar 0.9s cubic-bezier(0.22,1,0.36,1) 0.3s both" }}
        />
      </div>

      {/* Admin login */}
      <div
        className="absolute inset-x-0 bottom-8 flex justify-center px-4"
        style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.4s both" }}
      >
        <Link
          to="/login"
          className="btn-shimmer group inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/40 px-4 py-2 text-xs text-muted-foreground backdrop-blur-xl transition-colors hover:border-border hover:text-foreground"
        >
          {t("maint.admin")}
          <span className="font-medium text-foreground">{t("maint.loginHere")}</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
