import { createFileRoute, Link } from "@tanstack/react-router";
import { Star, ArrowRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePreferences, useT } from "@/lib/preferences";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Reviews — RexWare" },
      {
        name: "description",
        content:
          "See what operators are saying about RexWare. Real reviews from real users.",
      },
    ],
  }),
  component: ReviewsPage,
  loader: async () => {
    const base = import.meta.env.VITE_APP_BASE_URL ?? "";
    const res = await fetch(`${base}/api/reviews`);
    if (!res.ok) return { reviews: [] };
    const reviews = await res.json();
    return { reviews };
  },
});

interface ReviewData {
  id: string;
  discord_tag: string;
  stars: number;
  feedback: string;
  created_at: number;
}

function StarRating({ stars }: { stars: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i < stars ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </div>
  );
}

function ReviewsPage() {
  const t = useT();
  const { theme } = usePreferences();
  const { reviews } = Route.useLoaderData() as { reviews: ReviewData[] };

  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1)
    : "0.0";

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
            <span>RexWare</span>
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

      <main className="mx-auto max-w-6xl px-6 py-16">
        {/* Page header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur mb-6">
            <MessageCircle className="h-3.5 w-3.5" />
            {t("home.reviews.kicker")}
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4">
            {t("home.reviews.title")}
          </h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            {t("home.reviews.sub")}
          </p>

          {/* Average rating */}
          <div className="mt-8 flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-5xl font-bold tracking-tight">{avgRating}</span>
              <span className="text-2xl text-muted-foreground">/ 5</span>
            </div>
            <div className="flex flex-col gap-1">
              <StarRating stars={reviews.length ? Math.round(Number(avgRating)) : 0} />
              <p className="text-xs text-muted-foreground">Based on {reviews.length} reviews</p>
            </div>
          </div>
        </div>

        {/* All reviews grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <div
              key={r.id}
              className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/50 p-6
                         hover:border-foreground/25 hover:bg-card transition-all duration-300 hover:shadow-[0_8px_40px_oklch(0_0_0/0.55)]"
            >
              <div className="flex items-center gap-1 mb-4">
                <StarRating stars={r.stars} />
              </div>
              <p className="text-sm leading-relaxed text-foreground/80 mb-5">&ldquo;{r.feedback}&rdquo;</p>
              <div className="flex items-center justify-between pt-4 border-t border-border/40">
                <div>
                  <p className="text-sm font-semibold">{r.discord_tag}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {reviews.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              No reviews yet. Be the first to leave one with <code>/review</code>!
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-6">
            Ready to try RexWare for yourself?
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="rounded-full" asChild>
              <Link to="/dash">
                Get started free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="rounded-full" asChild>
              <Link to="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
