import { createFileRoute, Link } from "@tanstack/react-router";
import { Trophy, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/preferences";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — SkyUtils" },
      {
        name: "description",
        content:
          "See how SkyUtils operators stack up. Top bot-hours, most active operations, and more.",
      },
    ],
  }),
  component: LeaderboardPage,
});

type RankEntry = {
  rank: number;
  name: string;
  bots: number;
  hours: number;
  score: number;
  plan: string;
};

const LEADERBOARD: RankEntry[] = [
  { rank: 1, name: "VoidHost", bots: 25, hours: 8472, score: 9842, plan: "Champion" },
  { rank: 2, name: "ApexCore", bots: 22, hours: 7931, score: 9105, plan: "Champion" },
  { rank: 3, name: "NightCrawler", bots: 18, hours: 6210, score: 7843, plan: "Elite" },
  { rank: 4, name: "SpectreHost", bots: 20, hours: 5892, score: 7310, plan: "Champion" },
  { rank: 5, name: "DarkMatter_FX", bots: 16, hours: 5430, score: 6621, plan: "Champion" },
  { rank: 6, name: "NocturneOps", bots: 14, hours: 4881, score: 5890, plan: "Elite" },
  { rank: 7, name: "FluxRunner", bots: 12, hours: 4120, score: 5012, plan: "Elite" },
  { rank: 8, name: "GhostNode", bots: 10, hours: 3744, score: 4490, plan: "Elite" },
  { rank: 9, name: "Operator_X", bots: 8, hours: 2981, score: 3560, plan: "Elite" },
  { rank: 10, name: "NovaFlare", bots: 7, hours: 2450, score: 2940, plan: "Elite" },
  { rank: 11, name: "PixelStorm", bots: 5, hours: 1820, score: 2184, plan: "Rookie" },
  { rank: 12, name: "CypherRun", bots: 4, hours: 1560, score: 1872, plan: "Rookie" },
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-yellow-400/20 border border-yellow-400/50 text-yellow-300 font-bold text-sm">
        1
      </span>
    );
  if (rank === 2)
    return (
      <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gray-300/20 border border-gray-400/50 text-gray-300 font-bold text-sm">
        2
      </span>
    );
  if (rank === 3)
    return (
      <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-amber-600/20 border border-amber-600/50 text-amber-500 font-bold text-sm">
        3
      </span>
    );
  return (
    <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-muted text-muted-foreground font-semibold text-sm">
      {rank}
    </span>
  );
}

function LeaderboardPage() {
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
            <Link to="/changelog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {t("home.nav.changelog")}
            </Link>
            <Button asChild size="sm" className="rounded-full">
              <Link to="/dash">{t("nav.dashboard")}</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        {/* Page header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur mb-6">
            <Trophy className="h-3.5 w-3.5" />
            Leaderboard
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            {t("leaderboard.subtitle")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-lg mx-auto">
            See how your bots stack up against other operators. Rankings update daily.
          </p>
        </div>

        {/* Top 3 podium cards */}
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {[1, 0, 2].map((idx) => {
            const entry = LEADERBOARD[idx];
            const heights = ["h-40", "h-48", "h-36"];
            return (
              <div
                key={entry.rank}
                className={`relative overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-5 flex flex-col justify-end ${heights[idx]}`}
                style={{
                  background: idx === 1
                    ? "linear-gradient(180deg, oklch(0.40 0.06 45 / 0.08) 0%, oklch(0.25 0.04 215 / 0.6) 100%)"
                    : "linear-gradient(180deg, oklch(0.25 0.03 215 / 0.08) 0%, oklch(0.25 0.04 215 / 0.6) 100%)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-20 pointer-events-none"
                  style={{
                    background: idx === 1
                      ? "radial-gradient(ellipse at 50% 0%, oklch(0.60 0.15 45 / 0.5), transparent 70%)"
                      : "radial-gradient(ellipse at 50% 0%, oklch(0.55 0.12 215 / 0.4), transparent 70%)",
                  }}
                />
                <div className="relative">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-3xl font-bold tracking-tight">{entry.rank}</span>
                    {idx === 1 && (
                      <span className="text-yellow-300">
                        <Trophy className="h-5 w-5 fill-yellow-300/30" />
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-base">{entry.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{entry.bots} bots</span>
                    <span>·</span>
                    <span>{entry.hours.toLocaleString()}h</span>
                    <span>·</span>
                    <span>{entry.score.toLocaleString()} pts</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Full table */}
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/50">
          {/* Table header */}
          <div className="grid grid-cols-[56px_1fr_80px_80px_100px] gap-4 px-5 py-3 border-b border-border/50 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span>{t("leaderboard.rank")}</span>
            <span>{t("leaderboard.user")}</span>
            <span className="text-right">{t("leaderboard.bots")}</span>
            <span className="text-right">{t("leaderboard.hours")}</span>
            <span className="text-right">{t("leaderboard.score")}</span>
          </div>

          {/* Rows */}
          {LEADERBOARD.map((entry, i) => (
            <div
              key={entry.rank}
              className="grid grid-cols-[56px_1fr_80px_80px_100px] gap-4 px-5 py-4 items-center border-b border-border/30 last:border-0
                         hover:bg-foreground/[0.03] transition-colors duration-150"
            >
              <div>
                <RankBadge rank={entry.rank} />
              </div>
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-semibold text-sm">{entry.name}</p>
                </div>
                <span className="ml-auto inline-flex items-center rounded-full border border-foreground/15 bg-foreground/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {entry.plan}
                </span>
              </div>
              <span className="text-right font-semibold text-sm tabular-nums">{entry.bots}</span>
              <span className="text-right font-semibold text-sm tabular-nums text-muted-foreground">
                {entry.hours.toLocaleString()}h
              </span>
              <span className="text-right font-semibold text-sm tabular-nums text-muted-foreground">
                {entry.score.toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-6">
            Think you can reach the top?
          </p>
          <Button size="lg" className="rounded-full" asChild>
            <Link to="/dash">
              Start beaming <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
