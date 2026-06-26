import {
  createFileRoute,
  redirect,
  Link,
  useSearch,
  useNavigate,
} from "@tanstack/react-router";
import { fetchMaintenance, captureReferral } from "@/lib/api/auth.functions";
import { fetchVpnStatus } from "@/lib/api/vpn.functions";
import { Button } from "@/components/ui/button";
import {
  Bot,
  Shield,
  ArrowRight,
  Terminal,
  Clock,
  Layers,
  ChevronDown,
  Zap,
  Book,
  Star,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SplashLogo } from "@/components/SplashLogo";
import { useLoginDialog } from "@/components/LoginDialog";
import { usePreferences, useT } from "@/lib/preferences";
import { useTosDialog, TosDialog } from "@/components/TosDialog";
import { BannedDialog } from "@/components/BannedDialog";
import { AuthErrorDialog } from "@/components/AuthErrorDialog";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // Anti-VPN gate: flagged connections never reach the app.
    const { blocked } = await fetchVpnStatus();
    if (blocked) throw redirect({ to: "/blocked" });

    const { enabled, bypass } = await fetchMaintenance();
    // Maintenance gate: block everyone except admins.
    if (enabled && !bypass) throw redirect({ to: "/maintenance" });
  },
  validateSearch: (search: Record<string, unknown>) => {
    const raw =
      typeof search.auth_error === "string" ? search.auth_error.trim() : "";
    // Reject empty values and the literal strings "null"/"undefined" that can
    // leak into the URL, so logged-out visitors land on a clean `/` instead of
    // an ugly `/?auth_error=null`.
    const authError =
      raw && raw !== "null" && raw !== "undefined" ? raw : undefined;
    const rawRef = typeof search.ref === "string" ? search.ref.trim() : "";
    const ref = /^[A-Za-z0-9]{4,32}$/.test(rawRef) ? rawRef.toUpperCase() : undefined;
    return { auth_error: authError, ref } as {
      auth_error?: string;
      ref?: string;
    };
  },
  head: () => ({
    meta: [
      { title: "RexWare — Autobeam Minecraft Accounts" },
      {
        name: "description",
        content:
          "RexWare is a premium platform to autobeam Minecraft accounts. Deploy multiple undetected bots and manage everything from one clean dashboard.",
      },
      {
        property: "og:title",
        content: "RexWare — Autobeam Minecraft Accounts",
      },
      {
        property: "og:description",
        content: "Premium Minecraft beaming bots. Fast, reliable, undetected.",
      },
    ],
  }),
  component: Home,
});

const NOISE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

function NoiseTex({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 rounded-[inherit] opacity-[0.035] ${className ?? ""}`}
      style={{ backgroundImage: NOISE_BG }}
    />
  );
}

/* ─── Animated mesh background ─── */
function MeshBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-20 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="ac-mesh-1 absolute -top-1/4 -left-1/4 w-[80vw] h-[80vw] rounded-full opacity-[0.035]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.9 0 0), transparent 70%)",
        }}
      />
      <div
        className="ac-mesh-2 absolute -bottom-1/4 -right-1/4 w-[70vw] h-[70vw] rounded-full opacity-[0.025]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.8 0 0), transparent 70%)",
        }}
      />
      <div
        className="ac-mesh-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50vw] h-[50vw] rounded-full opacity-[0.015]"
        style={{
          background:
            "radial-gradient(circle, oklch(0.98 0 0), transparent 70%)",
        }}
      />
    </div>
  );
}

/* ─── Magnetic button wrapper ─── */
function MagneticButton({
  children,
  className,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) * 0.22;
    const dy = (e.clientY - cy) * 0.22;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  const handleLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "translate(0,0)";
  }, []);

  return (
    <div
      ref={ref}
      className={`btn-magnetic inline-block ${className ?? ""}`}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={onClick}
      role="presentation"
    >
      {children}
    </div>
  );
}

/* ─── Animated counter ─── */
function AnimatedNumber({
  target,
  suffix = "",
  duration = 1400,
}: {
  target: number;
  suffix?: string;
  duration?: number;
}) {
  const [current, setCurrent] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - t, 4);
          setCurrent(Math.round(ease * target));
          if (t < 1) animRef.current = requestAnimationFrame(step);
        };
        animRef.current = requestAnimationFrame(step);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(animRef.current);
    };
  }, [target, duration]);

  return (
    <span ref={ref}>
      {current}
      {suffix}
    </span>
  );
}

/* ─── Typing headline ─── */
function TypedText({ phrases }: { phrases: string[] }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const phrase = phrases[phraseIdx];
    if (!deleting && charIdx < phrase.length) {
      const t = setTimeout(() => setCharIdx((c) => c + 1), 60);
      return () => clearTimeout(t);
    }
    if (!deleting && charIdx === phrase.length) {
      const t = setTimeout(() => setDeleting(true), 2200);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx > 0) {
      const t = setTimeout(() => setCharIdx((c) => c - 1), 32);
      return () => clearTimeout(t);
    }
    if (deleting && charIdx === 0) {
      setDeleting(false);
      setPhraseIdx((i) => (i + 1) % phrases.length);
    }
  }, [charIdx, deleting, phraseIdx, phrases]);

  const phrase = phrases[phraseIdx];
  return (
    <span>
      {phrase.slice(0, charIdx)}
      <span
        className="inline-block w-[2px] h-[0.85em] bg-foreground/70 align-middle ml-0.5"
        style={{ animation: "ac-cursor 0.9s step-start infinite" }}
      />
    </span>
  );
}

/* ─── Stats ribbon ─── */
function StatsRow() {
  const t = useT();
  const stats = [
    { value: 2500, suffix: "$+", label: t("home.stats.value") },
    { value: 99.7, suffix: "%", label: t("home.stats.uptime") },
    { value: 100, suffix: "+", label: t("home.stats.activeBots") },
    { value: 10, suffix: "s", label: t("home.stats.deploy") },
  ];
  return (
    <div className="ac-section-hidden mx-auto max-w-6xl px-6 py-16">
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden rounded-2xl border border-border/50"
        style={{ background: "oklch(1 0 0 / 0.04)" }}
      >
        {stats.map(({ value, suffix, label }, i) => (
          <div
            key={label}
            className="ac-reveal flex flex-col gap-1 px-8 py-6 bg-background/60 backdrop-blur-sm"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span className="text-3xl font-semibold tracking-tight tabular-nums">
              <AnimatedNumber target={value} suffix={suffix} />
            </span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Scroll progress bar ─── */
function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? (h.scrollTop / max) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-[2px]"
      aria-hidden="true"
    >
      <div
        className="h-full origin-left bg-foreground/70"
        style={{
          transform: `scaleX(${progress / 100})`,
          transition: "transform 0.1s linear",
        }}
      />
    </div>
  );
}

/* ─── Fluid particle canvas ─── */
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
};

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = () => window.innerWidth;
    const H = () => window.innerHeight * 1.4;

    function resize() {
      canvas!.width = W();
      canvas!.height = H();
    }
    resize();
    window.addEventListener("resize", resize, { passive: true });

    // Spawn particles
    const COUNT = Math.min(Math.floor(W() / 10), 120);
    particlesRef.current = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W(),
      y: Math.random() * H(),
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.4 + 0.4,
      alpha: Math.random() * 0.45 + 0.08,
    }));

    const LINE_DIST = 120;
    const MOUSE_PUSH = 80;

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      const ps = particlesRef.current;
      const mx = mouse.current.x;
      const my = mouse.current.y;

      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        // Mouse repulsion
        const dxm = p.x - mx;
        const dym = p.y - my;
        const dm = Math.sqrt(dxm * dxm + dym * dym);
        if (dm < MOUSE_PUSH) {
          const force = ((MOUSE_PUSH - dm) / MOUSE_PUSH) * 0.015;
          p.vx += (dxm / dm) * force;
          p.vy += (dym / dm) * force;
        }
        // Dampen
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        // Wrap
        if (p.x < 0) p.x = canvas!.width;
        if (p.x > canvas!.width) p.x = 0;
        if (p.y < 0) p.y = canvas!.height;
        if (p.y > canvas!.height) p.y = 0;

        // Draw dot
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `oklch(0.92 0 0 / ${p.alpha})`;
        ctx!.fill();

        // Draw connections
        for (let j = i + 1; j < ps.length; j++) {
          const q = ps[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINE_DIST) {
            const lineAlpha = (1 - dist / LINE_DIST) * 0.12;
            ctx!.beginPath();
            ctx!.moveTo(p.x, p.y);
            ctx!.lineTo(q.x, q.y);
            ctx!.strokeStyle = `oklch(0.9 0 0 / ${lineAlpha})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();

    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ opacity: 0.6 }}
    />
  );
}

/* ─── Section stagger reveal (IntersectionObserver) ─── */
function useSectionReveal(deps?: unknown[]) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".ac-section-hidden");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}

/* ─── Per-card scroll reveal for feature cards (Apple-style) ───
   Each .ac-feat reveals exactly when it scrolls into view. Because the two
   cards sharing a grid row cross the threshold at the same scroll position,
   they animate together as a pair, sliding in from opposite sides. */
function useFeatureReveal(deps?: unknown[]) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".ac-feat");
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.25, rootMargin: "0px 0px -12% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}

/* ─── Interactive spotlight + parallax tilt ───
   Attaches to every .ac-spotlight element: tracks the cursor to drive a
   radial glow (--mx/--my) and a subtle 3D tilt (--tilt-x/--tilt-y). One
   global listener set keeps it cheap regardless of card count. */
function useSpotlight(deps?: unknown[]) {
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>(".ac-spotlight"),
    );
    if (!els.length) return;

    const TILT = 5;
    const handlers = els.map((el) => {
      const onMove = (e: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        el.style.setProperty("--mx", `${px * 100}%`);
        el.style.setProperty("--my", `${py * 100}%`);
        el.style.setProperty("--tilt-x", `${(0.5 - py) * 2 * TILT}deg`);
        el.style.setProperty("--tilt-y", `${(px - 0.5) * 2 * TILT}deg`);
      };
      const onLeave = () => {
        el.style.setProperty("--tilt-x", "0deg");
        el.style.setProperty("--tilt-y", "0deg");
      };
      el.addEventListener("mousemove", onMove);
      el.addEventListener("mouseleave", onLeave);
      return { el, onMove, onLeave };
    });

    return () => {
      handlers.forEach(({ el, onMove, onLeave }) => {
        el.removeEventListener("mousemove", onMove);
        el.removeEventListener("mouseleave", onLeave);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}

/* ─── Home ─── */
function Home() {
  const t = useT();
  const { open: openLogin } = useLoginDialog();
  const { formatPrice, theme } = usePreferences();
  const { auth_error, ref } = useSearch({ from: "/" });
  const navigate = useNavigate();

  // Persist the referral code (if any) so it survives the Discord OAuth round
  // trip; attribution is finalized server-side after signup.
  useEffect(() => {
    if (!ref) return;
    captureReferral({ data: { code: ref } }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  const [bannedOpen, setBannedOpen] = useState(auth_error === "account_banned");
  // Surface non-ban OAuth failures (oauth_failed, invalid_state, etc.) in a dialog.
  const [authErrorOpen, setAuthErrorOpen] = useState(
    !!auth_error && auth_error !== "account_banned",
  );

  // Strip the auth_error param from the URL once a dialog has consumed it,
  // so refreshes don't re-trigger and the address bar stays clean.
  const clearAuthError = useCallback(() => {
    navigate({ to: "/", search: {}, replace: true });
  }, [navigate]);

  // If a stale `auth_error` lingers in the address bar but no dialog consumes
  // it, scrub it on mount so the URL stays clean.
  useEffect(() => {
    if (
      !authErrorOpen &&
      !bannedOpen &&
      window.location.search.includes("auth_error")
    ) {
      clearAuthError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const heroRef = useRef<HTMLElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroParallaxY = scrollY * 0.38;

  const {
    open: tosOpen,
    accept,
    decline,
    setOpen: setTosOpen,
    openDialog: openTosDialog,
    mounted,
  } = useTosDialog();

  // Register IntersectionObserver for section reveals once mounted.
  useSectionReveal([mounted]);
  // Per-card scroll reveal for the feature bento cards (animate in as pairs).
  useFeatureReveal([mounted]);
  // Wire interactive spotlight + tilt once content is in the DOM.
  useSpotlight([mounted]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollProgress />
      <MeshBackground />
      <ParticleCanvas />
      <SplashLogo />
      <TosDialog
        open={tosOpen}
        onAccept={accept}
        onDecline={decline}
        onOpenChange={setTosOpen}
      />
      <BannedDialog
        open={bannedOpen}
        onOpenChange={(o) => {
          setBannedOpen(o);
          if (!o) clearAuthError();
        }}
      />
      <AuthErrorDialog
        error={auth_error ?? null}
        open={authErrorOpen}
        onOpenChange={(o) => {
          setAuthErrorOpen(o);
          if (!o) clearAuthError();
        }}
        onRetry={openLogin}
      />

      {/* Ambient glow */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[700px] -z-10 ac-glow"
        style={{ background: "var(--gradient-hero)" }}
      />
      {/* Animated aurora behind the hero */}
      <div
        aria-hidden="true"
        className="ac-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[560px] max-w-5xl"
      />

      {/* Nav */}
      <header
        className="sticky top-0 z-40 backdrop-blur-xl border-b border-border/50"
        style={{
          background:
            theme === "light"
              ? `oklch(1 0 0 / ${Math.min(scrollY / 80, 1) * 0.82})`
              : `oklch(0 0 0 / ${Math.min(scrollY / 80, 1) * 0.82})`,
          transition: "background 0.3s ease",
        }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight group"
          >
            <div className="relative">
              <img
                src="/logo.png"
                alt="Logo"
                className="h-6 w-6 transition-transform duration-300 group-hover:scale-110"
              />
            </div>
            <span className="transition-colors duration-200 group-hover:text-foreground/80">
              RexWare
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            {[
              { href: "#features", label: t("home.nav.features") },
              { href: "#pricing", label: t("home.nav.pricing") },
              { href: "/changelog", label: t("home.nav.changelog") },
              { href: "/reviews", label: t("home.nav.reviews") },
              { href: "#faq", label: t("home.nav.faq") },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="relative py-1 transition-colors duration-200 hover:text-foreground group"
              >
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-foreground/60 transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
            <Link
              to="/docs"
              className="relative py-1 transition-colors duration-200 hover:text-foreground group"
            >
              {t("home.nav.docs")}
              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-foreground/60 transition-all duration-300 group-hover:w-full" />
            </Link>
          </div>
          <MagneticButton>
            <a
              href="/api/auth/discord"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3 text-xs rounded-full btn-shimmer shadow-[0_2px_12px_oklch(1_0_0/0.08)] transition-all duration-200 hover:shadow-[0_4px_20px_oklch(1_0_0/0.15)]"
            >
              {t("home.nav.signin")}
            </a>
          </MagneticButton>
        </nav>
      </header>

      {/* Hero */}
      <section
        ref={heroRef}
        className="mx-auto max-w-6xl px-6 pt-24 pb-16 text-center"
        style={{
          transform: `translateY(${heroParallaxY}px)`,
          opacity: Math.max(0, 1 - scrollY / 600),
          willChange: "transform, opacity",
        }}
      >
        {/* Badge */}
        <div
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur mb-8"
          style={{
            animation: "fadeUp 0.7s cubic-bezier(0.22,1,0.36,1) 2.6s both",
          }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-foreground/70 opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground/90" />
          </span>
          {t("home.badge")} &mdash;{" "}
          <Link
            to="/changelog"
            className="underline underline-offset-2 hover:text-foreground/80 transition-colors"
          >
            {t("home.changelog.viewAll")}
          </Link>
        </div>

        {/* Headline */}
        <h1
          className="text-5xl md:text-[4.5rem] lg:text-[5.5rem] font-semibold tracking-tight leading-[1.04] text-balance mb-6"
          style={{
            animation: "fadeUp 0.9s cubic-bezier(0.22,1,0.36,1) 2.75s both",
          }}
        >
          {t("home.hero.line1")}
          <br />
          <span
            className="ac-hero-gradient bg-clip-text text-transparent block mt-1 leading-[1.15] pb-2"
            style={{ backgroundImage: "var(--gradient-primary)" }}
          >
            <TypedText
              phrases={[
                t("home.hero.typed1"),
                t("home.hero.typed2"),
                t("home.hero.typed3"),
              ]}
            />
          </span>
        </h1>

        <p
          className="mx-auto max-w-xl text-lg md:text-xl text-muted-foreground/90 leading-relaxed text-balance mb-10"
          style={{
            animation: "fadeUp 0.9s cubic-bezier(0.22,1,0.36,1) 2.95s both",
          }}
        >
          {t("home.hero.sub")}
        </p>

        <div
          className="flex flex-wrap items-center justify-center gap-3"
          style={{
            animation: "fadeUp 0.9s cubic-bezier(0.22,1,0.36,1) 3.1s both",
          }}
        >
          <MagneticButton>
            <a
              href="/api/auth/discord"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-full px-7 btn-shimmer shadow-[0_0_32px_oklch(1_0_0/0.10)] hover:shadow-[0_0_48px_oklch(1_0_0/0.18)] transition-all duration-300 hover:scale-[1.03]"
            >
              {t("home.hero.cta")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </MagneticButton>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="rounded-full px-7 border-border/50 hover:border-foreground/30 hover:bg-foreground/5 transition-all duration-200"
          >
            <a href="#pricing">{t("home.hero.viewPricing")}</a>
          </Button>
        </div>
        {/* Scroll indicator */}
        <div
          className="mt-48 flex flex-col items-center gap-2 text-muted-foreground/70"
          style={{
            animation: "fadeUp 0.9s cubic-bezier(0.22,1,0.36,1) 3.3s both",
          }}
        >
          <span className="text-[10px] tracking-[0.3em] uppercase font-semibold">
            {t("home.hero.scroll")}
          </span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </div>
      </section>

      {/* Stats ribbon */}
      <StatsRow />

      {/* Features — bento grid */}
      <section
        id="features"
        className="ac-section-hidden mx-auto max-w-6xl px-6 py-8 scroll-mt-20"
      >
        <div className="max-w-2xl ac-reveal mb-12">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50 mb-3">
            {t("home.features.kicker")}
          </p>
          <h2 className="text-[1.75rem] md:text-[2.25rem] font-semibold tracking-[-0.02em] leading-[1.1]">
            {t("home.features.title")}
          </h2>
          <p className="mt-3 text-muted-foreground/70 text-base leading-relaxed">
            {t("home.features.sub")}
          </p>
        </div>

        {/* Bento grid */}
        <div className="grid gap-2.5 md:grid-cols-3 lg:grid-cols-6">
          {/* Big card — Multi-bot Management */}
          <div
            className="ac-feat ac-spotlight ac-sheen group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-6
                       lg:col-span-3 lg:row-span-2 flex flex-col justify-between min-h-[240px]
                       hover:border-foreground/25 hover:bg-card
                       hover:shadow-[0_8px_40px_oklch(0_0_0/0.55),0_0_0_1px_oklch(1_0_0/0.07)]"
            style={
              {
                "--feat-dir": "-48px",
                "--feat-delay": "0ms",
              } as React.CSSProperties
            }
          >
            <NoiseTex />
            <div
              className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 0%, oklch(1 0 0 / 0.04), transparent 60%)",
              }}
            />
            <div>
              <div
                className="ac-icon-tile grid h-10 w-10 place-items-center rounded-xl mb-4"
              >
                <Bot className="h-[1.15rem] w-[1.15rem]" />
              </div>
              <h3 className="text-lg font-semibold mb-2 tracking-tight">
                {t("home.feat.smart.title")}
              </h3>
              <p className="text-[0.8125rem] text-muted-foreground leading-relaxed">
                {t("home.feat.smart.desc")}
              </p>
            </div>
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground/50">
              <Zap className="h-3 w-3" />
              <span>{t("home.feat.smart.note")}</span>
            </div>
          </div>

          {/* Medium card — Undetected */}
          <div
            className="ac-feat ac-spotlight ac-sheen group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-5
                       lg:col-span-3 flex flex-col justify-between
                       hover:border-foreground/25 hover:bg-card
                       hover:shadow-[0_8px_40px_oklch(0_0_0/0.55)]"
            style={
              {
                "--feat-dir": "48px",
                "--feat-delay": "110ms",
              } as React.CSSProperties
            }
          >
            <NoiseTex />
            <div
              className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 0%, oklch(1 0 0 / 0.03), transparent 60%)",
              }}
            />
            <div>
              <div
                className="ac-icon-tile grid h-9 w-9 place-items-center rounded-xl mb-3.5"
              >
                <Shield className="h-[1.15rem] w-[1.15rem]" />
              </div>
              <h3 className="font-semibold mb-1.5 tracking-tight">
                {t("home.feat.undetected.title")}
              </h3>
              <p className="text-[0.8125rem] text-muted-foreground leading-relaxed">
                {t("home.feat.undetected.desc")}
              </p>
            </div>
          </div>

          {/* Small cards */}
          {[
            {
              icon: Clock,
              title: t("home.feat.uptime.title"),
              desc: t("home.feat.uptime.desc"),
            },
            {
              icon: Terminal,
              title: t("home.feat.console.title"),
              desc: t("home.feat.console.desc"),
            },
            {
              icon: Layers,
              title: t("home.feat.multi.title"),
              desc: t("home.feat.multi.desc"),
            },
            {
              icon: ArrowRight,
              title: t("home.feat.deploy.title"),
              desc: t("home.feat.deploy.desc"),
            },
            {
              icon: Book,
              title: t("home.feat.methods.title"),
              desc: t("home.feat.methods.desc"),
            },
          ].map(({ icon: Icon, title, desc }, i) => (
            <div
              key={title}
              className="ac-feat ac-spotlight ac-sheen group relative overflow-hidden rounded-2xl border border-border bg-card/60 p-4
                         lg:col-span-3 md:col-span-1
                         hover:border-foreground/25 hover:bg-card
                         hover:shadow-[0_8px_32px_oklch(0_0_0/0.5)]"
              style={
                {
                  // Even cards sit on the right column, odd on the left. Left
                  // leads (0ms), right follows (110ms) so each row slides in
                  // from opposite sides as a pair.
                  "--feat-dir": i % 2 === 0 ? "48px" : "-48px",
                  "--feat-delay": i % 2 === 0 ? "110ms" : "0ms",
                } as React.CSSProperties
              }
            >
              <NoiseTex />
              <div
                className="ac-icon-tile grid h-8 w-8 place-items-center rounded-lg mb-3"
              >
                <Icon className="h-[0.95rem] w-[0.95rem]" />
              </div>
              <h3 className="font-medium text-sm mb-1 tracking-tight">
                {title}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section
        id="pricing"
        className="ac-section-hidden mx-auto max-w-6xl px-6 py-24 scroll-mt-20"
      >
        <div className="text-center max-w-xl mx-auto ac-reveal mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            {t("home.pricing.kicker")}
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t("home.pricing.title")}
          </h2>
          <p className="mt-3 text-muted-foreground/70 text-lg">
            {t("home.pricing.sub")}
          </p>
          {/* Free trial callout */}
          <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-foreground/15 bg-card/60 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
            </span>
            {t("home.pricing.trial")}
          </div>
        </div>

        {/* Beta pricing warning */}
        <div className="ac-reveal mx-auto mb-10 max-w-2xl">
          <div className="flex items-start gap-3 rounded-2xl border border-yellow-500/40 bg-yellow-400/10 px-4 py-3 text-sm text-yellow-200 backdrop-blur">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="leading-relaxed text-pretty">
              {t("home.pricing.betaWarning")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3 items-stretch">
          {[
            {
              name: t("home.plan.starter.name") || "Rookie",
              price: "20",
              bots: t("home.plan.starter.bots"),
              hours: t("home.plan.starter.hours"),
              proxies: t("home.plan.starter.proxies"),
              speed: t("pay.cmp.standard"),
              perks: [
                t("home.perk.starter.1"),
                t("home.perk.starter.2"),
                t("home.perk.starter.3"),
                t("home.perk.starter.4"),
                t("home.perk.starter.5"),
                t("home.perk.starter.6"),
              ],
              featured: false,
              delay: 0,
            },
            {
              name: t("home.plan.pro.name") || "Elite",
              price: "35",
              bots: t("home.plan.pro.bots"),
              hours: t("home.plan.pro.hours"),
              proxies: t("home.plan.pro.proxies"),
              speed: t("pay.cmp.fast"),
              perks: [
                t("home.perk.pro.1"),
                t("home.perk.pro.2"),
                t("home.perk.pro.3"),
                t("home.perk.pro.4"),
                t("home.perk.pro.5"),
                t("home.perk.pro.6"),
                t("home.perk.pro.7"),
                t("home.perk.pro.8"),
              ],
              featured: true,
              delay: 60,
            },
            {
              name: t("home.plan.enterprise.name"),
              price: "55",
              bots: t("home.plan.enterprise.bots"),
              hours: t("home.plan.enterprise.hours"),
              proxies: t("home.plan.enterprise.proxies"),
              speed: t("pay.cmp.maximum"),
              perks: [
                t("home.perk.enterprise.1"),
                t("home.perk.enterprise.2"),
                t("home.perk.enterprise.3"),
                t("home.perk.enterprise.4"),
                t("home.perk.enterprise.5"),
                t("home.perk.enterprise.6"),
                t("home.perk.enterprise.7"),
                t("home.perk.enterprise.8"),
                t("home.perk.enterprise.9"),
              ],
              featured: false,
              delay: 120,
            },
          ].map((p) =>
            p.featured ? (
              <div
                key={p.name}
                className="ac-reveal ac-grad-border relative rounded-[22px] p-px"
                style={{
                  animationDelay: `${p.delay}ms`,
                }}
              >
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border border-foreground/20 bg-foreground px-3.5 py-1 text-[11px] font-semibold tracking-wide uppercase text-background"
                    style={{
                      animation:
                        "ac-badge-pop 0.5s cubic-bezier(0.22,1,0.36,1) 3.5s both",
                    }}
                  >
                    {t("home.pricing.mostPopular")}
                  </span>
                </div>
                <div className="relative flex flex-col overflow-hidden rounded-[21px] bg-card p-8 pt-11 h-full">
                  <NoiseTex />
                  <div
                    className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-25"
                    style={{
                      background:
                        "radial-gradient(ellipse at 50% -10%, oklch(1 0 0 / 0.18), transparent 60%)",
                    }}
                  />
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {p.name}
                  </p>
                  <div className="mt-3 flex items-end gap-1">
                    <span className="text-[2.75rem] font-semibold leading-none tracking-tight">
                      {formatPrice(Number(p.price))}
                    </span>
                    <span className="mb-1 text-sm text-muted-foreground">
                      {t("home.pricing.perMo")}
                    </span>
                  </div>
                  {/* Key stats */}
                  <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl border border-border/50 bg-muted/20 p-2.5">
                    {[
                      { label: t("home.pricing.bots"), val: p.bots },
                      { label: t("home.pricing.hours"), val: p.hours },
                      { label: t("home.pricing.proxies"), val: p.proxies },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="flex flex-col items-center gap-0.5"
                      >
                        <span className="text-[11px] font-semibold">
                          {s.val}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {s.label}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="my-5 border-t border-border/60" />
                  <ul className="flex-1 space-y-2.5">
                    {p.perks.map((x) => (
                      <li key={x} className="flex items-center gap-2.5 text-sm">
                        <svg
                          className="h-4 w-4 shrink-0 text-foreground"
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                        >
                          <circle
                            cx="8"
                            cy="8"
                            r="7.5"
                            stroke="currentColor"
                            strokeOpacity="0.25"
                          />
                          <path
                            d="M5 8l2 2 4-4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="text-foreground/85">{x}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="/api/auth/discord"
                    className="mt-8 w-full inline-flex items-center justify-center rounded-full btn-shimmer shadow-[0_2px_20px_oklch(1_0_0/0.1)] hover:shadow-[0_4px_32px_oklch(1_0_0/0.16)] transition-all duration-300 hover:scale-[1.02] bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6 font-medium"
                  >
                    {t("home.pricing.getStarted")}
                  </a>
                </div>
              </div>
            ) : (
              <div
                key={p.name}
                className="ac-reveal ac-spotlight pricing-card relative flex flex-col overflow-hidden rounded-[22px] border border-border/70 bg-card/50 p-8
                           hover:border-foreground/25 hover:bg-card/80
                           hover:shadow-[0_12px_40px_oklch(0_0_0/0.6)]"
                style={{ animationDelay: `${p.delay}ms` }}
              >
                <NoiseTex />
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {p.name}
                </p>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-[2.75rem] font-semibold leading-none tracking-tight">
                    {formatPrice(Number(p.price))}
                  </span>
                  <span className="mb-1 text-sm text-muted-foreground">
                    {t("home.pricing.perMo")}
                  </span>
                </div>
                {/* Key stats */}
                <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-xl border border-border/50 bg-muted/20 p-2.5">
                  {[
                    { label: t("home.pricing.bots"), val: p.bots },
                    { label: t("home.pricing.hours"), val: p.hours },
                    { label: t("home.pricing.proxies"), val: p.proxies },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="flex flex-col items-center gap-0.5"
                    >
                      <span className="text-[11px] font-semibold">{s.val}</span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="my-5 border-t border-border/60" />
                <ul className="flex-1 space-y-2.5">
                  {p.perks.map((x) => (
                    <li key={x} className="flex items-center gap-2.5 text-sm">
                      <svg
                        className="h-4 w-4 shrink-0 text-muted-foreground/60"
                        viewBox="0 0 16 16"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="7.5"
                          stroke="currentColor"
                          strokeOpacity="0.35"
                        />
                        <path
                          d="M5 8l2 2 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="text-foreground/65">{x}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/api/auth/discord"
                  className="mt-8 w-full inline-flex items-center justify-center rounded-full hover:scale-[1.02] transition-transform duration-200 border border-border/50 hover:border-foreground/30 hover:bg-foreground/5 h-10 px-6 font-medium"
                >
                  {t("home.pricing.getStarted")}
                </a>
              </div>
            ),
          )}
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="ac-section-hidden mx-auto max-w-3xl px-6 py-24 scroll-mt-20"
      >
        <div className="text-center ac-reveal mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3">
            {t("home.faq.kicker")}
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            {t("home.faq.title")}
          </h2>
          <p className="mt-3 text-muted-foreground/70  text-lg">
            {t("home.faq.sub")}
          </p>
        </div>
        <div className="ac-reveal">
          <Accordion type="single" collapsible className="w-full">
            {[
              {
                q: t("home.faq.q1"),
                a: t("home.faq.a1"),
              },
              {
                q: t("home.faq.q2"),
                a: t("home.faq.a2"),
              },
              {
                q: t("home.faq.q3"),
                a: t("home.faq.a3"),
              },
              {
                q: t("home.faq.q4"),
                a: t("home.faq.a4"),
              },
              {
                q: t("home.faq.q5"),
                a: t("home.faq.a5"),
              },
            ].map((item, i) => (
              <AccordionItem
                key={i}
                value={`item-${i}`}
                className="border-border/50 transition-colors hover:border-border"
              >
                <AccordionTrigger className="text-left hover:no-underline py-5 text-[15px] font-medium">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed pb-5">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Top Reviews Preview */}
      <section className="ac-section-hidden mx-auto max-w-6xl px-6 py-16 scroll-mt-20">
        <div className="max-w-2xl ac-reveal mb-10">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50 mb-3">
            {t("home.reviews.kicker")}
          </p>
          <h2 className="text-[1.75rem] md:text-[2.25rem] font-semibold tracking-[-0.02em] leading-[1.1]">
            {t("home.reviews.title")}
          </h2>
          <p className="mt-3 text-muted-foreground/70 text-base leading-relaxed">
            {t("home.reviews.sub")}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              stars: 5,
              name: "Operator_X",
              text: "Hands down the best beaming tool I've used. Setup takes seconds and my bots have never been flagged. The dashboard is incredibly clean.",
              plan: "Elite",
            },
            {
              stars: 5,
              name: "NightCrawler",
              text: "The multi-bot management alone is worth the price. I run 5 bots 24/7 and the uptime has been flawless. The rotating proxies are a game changer.",
              plan: "Elite",
            },
            {
              stars: 5,
              name: "VoidHost",
              text: "Came for the stealth, stayed for everything else. Support responds fast, the UI is gorgeous, and the pricing is transparent. Highly recommended.",
              plan: "Champion",
            },
          ].map((r, i) => (
            <div
              key={r.name}
              className="ac-reveal ac-spotlight ac-sheen group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6
                         hover:border-foreground/25 hover:bg-card hover:shadow-[0_8px_40px_oklch(0_0_0/0.55)]"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <NoiseTex />
              <div className="flex items-center gap-1 mb-4">
                {Array.from({ length: 5 }).map((_, si) => (
                  <Star
                    key={si}
                    className={`h-3.5 w-3.5 ${si < r.stars ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30"}`}
                  />
                ))}
              </div>
              <p className="text-sm leading-relaxed text-foreground/80 mb-5">&ldquo;{r.text}&rdquo;</p>
              <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/40">
                <div>
                  <p className="text-sm font-semibold">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.plan} user</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-foreground/20 bg-foreground/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                    {r.plan}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="ac-reveal mt-8 text-center">
          <Button
            asChild
            variant="outline"
            className="rounded-full border-border/50 hover:border-foreground/30 hover:bg-foreground/5 transition-all duration-200"
          >
            <Link to="/reviews">{t("home.reviews.writeBtn")}</Link>
          </Button>
        </div>
      </section>

      {/* CTA */}
      <section className="ac-section-hidden mx-auto max-w-4xl px-6 py-24">
        <div className="ac-reveal relative overflow-hidden rounded-3xl border border-border/60 bg-card/60 p-12 text-center">
          <NoiseTex />
          <div
            className="absolute inset-0 -z-10 opacity-50 ac-glow"
            style={{ background: "var(--gradient-hero)" }}
          />
          {/* Grid lines decoration */}
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(oklch(1 0 0 / 0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 0.6) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              WebkitMaskImage:
                "radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent 75%)",
              maskImage:
                "radial-gradient(ellipse 70% 70% at 50% 50%, black, transparent 75%)",
            }}
          />
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-balance">
            {t("home.cta.title")}
          </h2>
          <p className="mt-3 text-muted-foreground/70 text-lg max-w-md mx-auto">
            {t("home.cta.sub")}
          </p>
          <MagneticButton className="mt-8">
            <a
              href="/api/auth/discord"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-full px-8 btn-shimmer shadow-[0_0_48px_oklch(1_0_0/0.12)] hover:shadow-[0_0_64px_oklch(1_0_0/0.2)] transition-all duration-300 hover:scale-[1.03]"
            >
              {t("home.cta.button")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </MagneticButton>
        </div>
      </section>

      <footer className="border-t border-border/40">
        <div className="mx-auto max-w-6xl px-6 py-8 flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>RexWare © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6">
            <Link
              to="/docs"
              className="hover:text-foreground transition-colors duration-200"
            >
              {t("home.footer.docs")}
            </Link>
            <Link
              to="/changelog"
              className="hover:text-foreground transition-colors duration-200"
            >
              {t("home.nav.changelog")}
            </Link>
            <Link
              to="/reviews"
              className="hover:text-foreground transition-colors duration-200"
            >
              {t("home.nav.reviews")}
            </Link>
            <button
              onClick={openTosDialog}
              className="hover:text-foreground transition-colors duration-200"
            >
              {t("home.footer.terms")}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
