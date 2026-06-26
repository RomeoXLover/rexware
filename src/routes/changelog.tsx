import { createFileRoute, Link } from "@tanstack/react-router";
import { Terminal, Zap, Star, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences, useT } from "@/lib/preferences";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "Changelog — SkyUtils" },
      {
        name: "description",
        content:
          "See what's new in SkyUtils. Every update, improvement, and fix — all in one place.",
      },
    ],
  }),
  component: ChangelogPage,
});

type Change = {
  type: "new" | "improved" | "fixed";
  text: string;
};

type Entry = {
  version: string;
  date: string;
  badge?: string;
  changes: Change[];
};

const CHANGELOG: Entry[] = [
  {
    version: "v1.4",
    date: "15 June 2026",
    badge: "Major",
    changes: [
      {
        type: "new",
        text: 'Brand-new "Aurora" theme with a cleaner azure look across the whole site and dashboard.',
      },
      {
        type: "new",
        text: "Public changelog page so you can always see what's new.",
      },
      {
        type: "new",
        text: 'Leave a star rating and comment with the /reviews command — top reviews now show on the homepage and Reviews page.',
      },
      {
        type: "new",
        text: "Leaderboard so you can see how your bots stack up.",
      },
      {
        type: "improved",
        text: "Your dashboard now shows how many bot-hours you've used today, per bot.",
      },
      {
        type: "improved",
        text: "Refreshed homepage with loading skeletons and a smoother first impression.",
      },
      {
        type: "improved",
        text: "Pro plan daily allowance is now 7 bot-hours per day per bot.",
      },
    ],
  },
  {
    version: "v1.3",
    date: "1 June 2026",
    changes: [
      {
        type: "new",
        text: "Custom actions dialog — run bespoke command sequences per bot.",
      },
      {
        type: "new",
        text: "Referral system with commission tracking.",
      },
      {
        type: "improved",
        text: "Proxy management — bulk add, validate, and organize proxies.",
      },
      {
        type: "improved",
        text: "Bot console performance — faster log streaming and search.",
      },
      {
        type: "fixed",
        text: "Fixed rare crash when bot disconnects mid-beam.",
      },
    ],
  },
  {
    version: "v1.2",
    date: "15 May 2026",
    changes: [
      {
        type: "new",
        text: "Discord DM panel — send and receive DMs directly from the dashboard.",
      },
      {
        type: "new",
        text: "Plugin marketplace with 5 launch plugins.",
      },
      {
        type: "improved",
        text: "Dashboard loading time reduced by 40%.",
      },
      {
        type: "fixed",
        text: "Fixed OAuth redirect loop for certain Discord configurations.",
      },
    ],
  },
  {
    version: "v1.1",
    date: "1 May 2026",
    changes: [
      {
        type: "new",
        text: "Crypto checkout with automatic subscription activation.",
      },
      {
        type: "new",
        text: "Free 24-hour trial for new users.",
      },
      {
        type: "improved",
        text: "Bot deployment speed improved by 25%.",
      },
      {
        type: "fixed",
        text: "Minor UI fixes across the pricing page.",
      },
    ],
  },
  {
    version: "v1.0",
    date: "15 April 2026",
    badge: "Launch",
    changes: [
      {
        type: "new",
        text: "SkyUtils launches — Minecraft account autobeaming platform.",
      },
      {
        type: "new",
        text: "Discord OAuth authentication.",
      },
      {
        type: "new",
        text: "Dashboard with bot management and live console.",
      },
      {
        type: "new",
        text: "Three pricing tiers — Rookie, Elite, Champion.",
      },
    ],
  },
];

const TYPE_CONFIG = {
  new: {
    label: "New",
    icon: Zap,
    className: "text-green-400 border-green-400/30 bg-green-400/10",
  },
  improved: {
    label: "Improved",
    icon: Terminal,
    className: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  },
  fixed: {
    label: "Fixed",
    icon: Star,
    className: "text-purple-400 border-purple-400/30 bg-purple-400/10",
  },
};

function ChangelogPage() {
  const t = useT();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[600px] -z-10 opacity-60"
        style={{ background: "var(--gradient-hero)" }}
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 backdrop-blur-xl border-b border-border/50 bg-background/80">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight group"
          >
            <img src="/logo.png" alt="Logo" className="h-6 w-6 transition-transform duration-300 group-hover:scale-110" />
            <span>SkyUtils</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("home.nav.home")}
            </Link>
            <Link to="/reviews" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("home.nav.reviews")}
            </Link>
            <Button asChild size="sm" className="rounded-full">
              <Link to="/dash">{t("nav.dashboard")}</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* Page header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur mb-6">
            <Terminal className="h-3.5 w-3.5" />
            {t("changelog.title")}
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            {t("changelog.subtitle")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            Every update, improvement, and bug fix — all in one place.
          </p>
        </div>

        {/* Entries */}
        <div className="space-y-8">
          {CHANGELOG.map((entry, ei) => (
            <div
              key={entry.version}
              className="relative"
              style={{ animationDelay: `${ei * 60}ms` }}
            >
              {/* Timeline connector */}
              {ei < CHANGELOG.length - 1 && (
                <div className="absolute left-5 top-12 bottom-0 w-px bg-border/40" />
              )}

              <div className="relative flex gap-5">
                {/* Timeline dot */}
                <div className="mt-1.5 shrink-0">
                  <div className="h-3 w-3 rounded-full border-2 border-primary bg-background" />
                </div>

                {/* Entry card */}
                <div className="flex-1 overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-semibold tracking-tight">
                        {entry.version}
                      </h2>
                      {entry.badge && (
                        <span className="inline-flex items-center rounded-full border border-foreground/20 bg-foreground/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                          {entry.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{entry.date}</span>
                  </div>

                  <ul className="space-y-3">
                    {entry.changes.map((change, ci) => {
                      const config = TYPE_CONFIG[change.type];
                      const Icon = config.icon;
                      return (
                        <li key={ci} className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${config.className}`}
                          >
                            <Icon className="h-2.5 w-2.5" />
                            {config.label}
                          </span>
                          <span className="text-sm leading-relaxed text-foreground/80">
                            {change.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-6">
            Stay up to date — powered by SkyUtils.
          </p>
          <Button size="lg" className="rounded-full" asChild>
            <Link to="/dash">
              Get started free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
