import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

import { fetchVpnStatus } from "@/lib/api/vpn.functions";
import type { VpnReason } from "@/lib/vpn.server";

export const Route = createFileRoute("/blocked")({
  beforeLoad: async () => {
    const { blocked, reason } = await fetchVpnStatus();
    // Nothing to show if the visitor isn't actually blocked.
    if (!blocked) throw redirect({ to: "/" });
    return { reason };
  },
  loader: ({ context }) => ({ reason: (context as { reason: VpnReason }).reason }),
  component: BlockedPage,
});

const REASON_COPY: Record<NonNullable<VpnReason>, string> = {
  vpn: "We detected that you're connecting through a VPN.",
  proxy: "We detected that you're connecting through a proxy.",
  tor: "We detected that you're connecting through the Tor network.",
  hosting: "We detected that you're connecting from a hosting / datacenter network.",
};

// Decorative floating bubbles — mirrors the maintenance page for visual parity.
const FLOAT_BUBBLES = [
  { size: 220, top: "8%", left: "-4%", delay: "0s", duration: "18s", opacity: 0.45 },
  { size: 140, top: "62%", left: "6%", delay: "-4s", duration: "20s", opacity: 0.4 },
  { size: 90, top: "20%", left: "82%", delay: "-2s", duration: "15s", opacity: 0.5 },
  { size: 300, top: "55%", left: "70%", delay: "-7s", duration: "24s", opacity: 0.3 },
  { size: 60, top: "80%", left: "40%", delay: "-1s", duration: "14s", opacity: 0.55 },
];

function BlockedPage() {
  const { reason } = Route.useLoaderData();
  const message = reason
    ? REASON_COPY[reason]
    : "Your connection was flagged as a VPN or proxy.";

  return (
    <div className="ac-noise relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      {/* Ambient hero glow */}
      <div
        className="ac-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[700px] opacity-70"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden="true"
      />

      {/* Floating bubbles */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
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
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md text-center">
        <div
          className="ac-icon-breathe mx-auto mb-7 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-card/60 backdrop-blur-xl"
          style={{ animation: "fadeUp 0.6s cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <ShieldAlert className="h-7 w-7 text-primary" />
        </div>

        <h1
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.08s both" }}
        >
          Access blocked
        </h1>

        <p
          className="mx-auto mt-4 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base"
          style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.16s both" }}
        >
          {message} To keep our platform safe, anonymized connections aren&apos;t
          allowed. Please turn it off and reload the page.
        </p>

        {/* Subtle animated divider */}
        <div
          className="mx-auto mt-8 h-px w-12 bg-border"
          style={{ animation: "ac-splash-bar 0.9s cubic-bezier(0.22,1,0.36,1) 0.3s both" }}
        />

        <button
          onClick={() => location.reload()}
          className="btn-shimmer mt-8 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          style={{ animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 0.4s both" }}
        >
          I&apos;ve disabled it — reload
        </button>
      </div>
    </div>
  );
}
