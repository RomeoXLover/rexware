import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Book,
  Rocket,
  LogIn,
  LayoutDashboard,
  Bot,
  Terminal as TerminalIcon,
  Reply,
  Layers,
  Shield,
  Puzzle,
  CreditCard,
  Wallet,
  Lock,
  HelpCircle,
  Ticket,
  Search,
  Sun,
  Moon,
  Languages,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Info,
  Lightbulb,
  AlertTriangle,
  MessageCircle,
  Hash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreferences } from "@/lib/preferences";
import { LANGUAGES, type Language } from "@/lib/i18n/dictionaries";
import {
  getDocsContent,
  DOCS_DISCORD_URL,
  type DocsBlock,
  type DocsSection,
  type TerminalTab,
  type TermLineType,
} from "@/lib/i18n/docs-content";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Documentation — RexWare" },
      {
        name: "description",
        content:
          "Learn how to deploy, run and master your RexWare beam bots — sign-in, bots, the live console, reply actions, presets, proxies, plugins, plans and billing.",
      },
    ],
  }),
  component: DocsPage,
});

/* ─── Icon mapping ─── */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  book: Book,
  rocket: Rocket,
  login: LogIn,
  layout: LayoutDashboard,
  bot: Bot,
  terminal: TerminalIcon,
  reply: Reply,
  layers: Layers,
  shield: Shield,
  puzzle: Puzzle,
  credit: CreditCard,
  wallet: Wallet,
  lock: Lock,
  help: HelpCircle,
  ticket: Ticket,
};

/* ─── Animated mesh background (lightweight, matches landing) ─── */
function MeshBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-20 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className="absolute inset-x-0 top-0 h-[600px]"
        style={{ background: "var(--gradient-hero)" }}
      />
      <div
        className="ac-aurora absolute inset-x-0 top-0 mx-auto h-[520px] max-w-5xl opacity-70"
        aria-hidden="true"
      />
    </div>
  );
}

/* ─── macOS-style terminal with feature-card tabs ─── */
const LINE_CLASS: Record<TermLineType, string> = {
  cmd: "text-foreground",
  out: "text-muted-foreground",
  ok: "text-emerald-400",
  warn: "text-amber-300",
  err: "text-red-400",
  muted: "text-muted-foreground/55",
  prompt: "text-sky-300",
  chat: "text-indigo-300",
};

function TerminalCard({ tabs }: { tabs: TerminalTab[] }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0];

  return (
    <div className="ac-spotlight group relative overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-[0_8px_40px_oklch(0_0_0/0.45)] backdrop-blur-xl">
      {/* Title bar with traffic lights */}
      <div className="flex items-center gap-3 border-b border-border/60 bg-background/40 px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="ml-1 flex-1 truncate font-mono text-xs text-muted-foreground">
          {tab.title}
        </span>
      </div>

      {/* Tabs (feature-card style) */}
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/50 bg-background/20 px-3 py-2">
          {tabs.map((tb, i) => (
            <button
              key={tb.label + i}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                i === active
                  ? "border border-foreground/20 bg-foreground/10 text-foreground"
                  : "border border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="relative overflow-x-auto px-4 py-4">
        <pre className="font-mono text-[12.5px] leading-relaxed">
          <code>
            {tab.lines.map((l, i) => (
              <div key={i} className={LINE_CLASS[l.t]}>
                {l.text || "\u00A0"}
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ─── Callout ─── */
const CALLOUT_META = {
  info: {
    icon: Info,
    cls: "border-sky-500/25 bg-sky-500/[0.06]",
    icl: "text-sky-300",
  },
  tip: {
    icon: Lightbulb,
    cls: "border-emerald-500/25 bg-emerald-500/[0.06]",
    icl: "text-emerald-300",
  },
  warn: {
    icon: AlertTriangle,
    cls: "border-amber-500/25 bg-amber-500/[0.06]",
    icl: "text-amber-300",
  },
} as const;

function Callout({
  tone,
  title,
  text,
}: {
  tone: "info" | "tip" | "warn";
  title: string;
  text: string;
}) {
  const meta = CALLOUT_META[tone];
  const Icon = meta.icon;
  return (
    <div className={`flex gap-3 rounded-xl border p-4 ${meta.cls}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.icl}`} />
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {text}
        </p>
      </div>
    </div>
  );
}

/* ─── Block renderer ─── */
function Block({ block }: { block: DocsBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {block.text}
        </p>
      );

    case "list":
      return (
        <ul className="flex flex-col gap-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[15px]">
              <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-foreground/40" />
              <span className="leading-relaxed text-muted-foreground">
                {item}
              </span>
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol className="flex flex-col gap-3">
          {block.items.map((item, i) => (
            <li
              key={i}
              className="ac-spotlight flex gap-4 rounded-xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm transition-colors hover:border-foreground/20"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-foreground/20 bg-foreground/10 text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    case "fields":
      return (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm">
          {block.rows.map((row, i) => (
            <div
              key={i}
              className={`flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4 ${
                i > 0 ? "border-t border-border/50" : ""
              }`}
            >
              <div className="sm:w-44 sm:shrink-0">
                <span className="font-mono text-[13px] font-medium text-foreground">
                  {row.name}
                </span>
                {row.type && (
                  <span className="ml-2 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {row.type}
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {row.desc}
              </p>
            </div>
          ))}
        </div>
      );

    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60">
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground/70"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={`border-b border-border/40 last:border-0 ${
                    block.highlight === ri ? "bg-foreground/[0.04]" : ""
                  }`}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-4 py-3 ${
                        ci === 0
                          ? "font-medium text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "callout":
      return (
        <Callout tone={block.tone} title={block.title} text={block.text} />
      );

    case "terminal":
      return <TerminalCard tabs={block.tabs} />;

    case "cards":
      return (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {block.items.map((item, i) => (
            <div
              key={i}
              className="ac-spotlight group relative overflow-hidden rounded-xl border border-border/60 bg-card/50 p-4 backdrop-blur-sm transition-colors hover:border-foreground/20 hover:bg-card/70"
            >
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      );

    default:
      return null;
  }
}

/* ─── Section ─── */
function SectionView({
  section,
  register,
}: {
  section: DocsSection;
  register: (id: string, el: HTMLElement | null) => void;
}) {
  const Icon = ICONS[section.icon] ?? Book;
  return (
    <section
      id={section.id}
      ref={(el) => register(section.id, el)}
      className="scroll-mt-28"
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/70 backdrop-blur">
          <Icon className="h-[1.1rem] w-[1.1rem]" />
        </span>
        <h2 className="group flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <a href={`#${section.id}`} className="hover:underline">
            {section.title}
          </a>
          <Hash className="h-4 w-4 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" />
        </h2>
      </div>
      {section.lead && (
        <p className="mb-5 text-[15px] leading-relaxed text-muted-foreground/90">
          {section.lead}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {section.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    </section>
  );
}

/* ─── Page ─── */
function DocsPage() {
  const { language, setLanguage, theme, setTheme, t } = usePreferences();
  const { chrome, sections } = useMemo(
    () => getDocsContent(language),
    [language],
  );

  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  }, []);

  // Filter sections by search query (title, lead, and text content).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    const matches = (s: DocsSection) => {
      if (s.title.toLowerCase().includes(q)) return true;
      if (s.lead?.toLowerCase().includes(q)) return true;
      return s.blocks.some((b) => JSON.stringify(b).toLowerCase().includes(q));
    };
    return sections.filter(matches);
  }, [query, sections]);

  // Scroll-spy: highlight the section currently in view.
  useEffect(() => {
    if (query) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    sectionEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [query, filtered]);

  const scrollTo = useCallback((id: string) => {
    const el = sectionEls.current.get(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const tt = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MeshBackground />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
          >
            <img src="/logo.png" alt="RexWare" className="h-6 w-6" />
            <span className="hidden sm:inline">RexWare</span>
          </Link>
          <span className="hidden text-muted-foreground/40 sm:inline">/</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {chrome.navHeading}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* Search */}
            <div className="relative hidden sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={chrome.searchPlaceholder}
                className="h-9 w-48 rounded-full border-border/60 bg-card/60 pl-9 text-sm backdrop-blur lg:w-64"
              />
            </div>

            {/* Language */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full border-border/60 bg-card/60 backdrop-blur"
                  aria-label={chrome.langLabel}
                >
                  <Languages className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {LANGUAGES.map((l) => (
                  <DropdownMenuItem
                    key={l.code}
                    onClick={() => setLanguage(l.code as Language)}
                    className={language === l.code ? "bg-accent" : ""}
                  >
                    <span className="mr-2">{l.flag}</span>
                    {l.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Theme */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-full border-border/60 bg-card/60 backdrop-blur"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={chrome.themeLabel}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>

            <Button
              asChild
              size="sm"
              className="hidden rounded-full sm:inline-flex"
            >
              <Link to="/">{chrome.openDashboard}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-7xl px-4 pb-2 pt-12 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {chrome.backHome}
        </Link>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Book className="h-3.5 w-3.5" />
          {chrome.badge}
        </div>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {chrome.title}
        </h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted-foreground/80 text-pretty">
          {chrome.subtitle}
        </p>

        {/* Mobile search */}
        <div className="relative mt-6 sm:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={chrome.searchPlaceholder}
            className="h-10 rounded-full border-border/60 bg-card/60 pl-9 backdrop-blur"
          />
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_200px]">
        {/* Sidebar nav */}
        <aside className="hidden lg:block">
          <nav
            className="sticky top-24 flex flex-col gap-0.5"
            aria-label={chrome.navHeading}
          >
            <p className="mb-2 px-3 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
              {chrome.navHeading}
            </p>
            {sections.map((s) => {
              const Icon = ICONS[s.icon] ?? Book;
              const active = activeId === s.id && !query;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-foreground/10 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0">
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-border/60 bg-card/50 p-12 text-center backdrop-blur">
              <Search className="mx-auto h-6 w-6 text-muted-foreground/50" />
              <p className="mt-3 font-medium">{chrome.searchEmpty}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {chrome.searchEmptyHint}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-16">
              {filtered.map((s) => (
                <SectionView key={s.id} section={s} register={register} />
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="ac-spotlight relative mt-16 overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-8 text-center backdrop-blur-xl">
            <div
              className="pointer-events-none absolute inset-0 -z-10 opacity-50"
              style={{ background: "var(--gradient-hero)" }}
            />
            <h3 className="text-2xl font-semibold tracking-tight">
              {chrome.ctaTitle}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-muted-foreground">
              {chrome.ctaText}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-full">
                <a
                  href={DOCS_DISCORD_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  {chrome.ctaButton}
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-full"
              >
                <Link to="/">
                  {chrome.openDashboard}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </main>

        {/* On this page */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground/50">
              {chrome.onThisPage}
            </p>
            <nav className="flex flex-col gap-1.5 border-l border-border/50">
              {(query ? filtered : sections).map((s) => {
                const active = activeId === s.id && !query;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={`-ml-px border-l-2 pl-3 text-left text-[13px] transition-colors ${
                      active
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.title}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>
      </div>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span>RexWare © {new Date().getFullYear()}</span>
          <div className="flex items-center gap-6">
            <Link to="/" className="transition-colors hover:text-foreground">
              {tt("home.nav.home", "Home")}
            </Link>
            <a
              href={DOCS_DISCORD_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-colors hover:text-foreground"
            >
              Discord
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
