import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Book,
  Search,
  Languages,
  X,
  MessageCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  type DocsSection,
} from "@/lib/i18n/docs-content";
import { ICONS, SectionView } from "@/components/docs-renderer";

// ---------------------------------------------------------------------------
// In-app multilingual Guide — the same content and look as the /docs page,
// delivered as a focused popup so users never have to leave the dashboard.
// Pass `initialSection` to jump straight to the most relevant topic.
// ---------------------------------------------------------------------------

export function GuideDialog({
  open,
  onOpenChange,
  initialSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}) {
  const { language, setLanguage, t } = usePreferences();
  const { chrome, sections } = useMemo(
    () => getDocsContent(language),
    [language],
  );

  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(initialSection ?? sections[0]?.id);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionEls = useRef<Map<string, HTMLElement>>(new Map());

  const register = useCallback((id: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el);
    else sectionEls.current.delete(id);
  }, []);

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

  const scrollTo = useCallback((id: string) => {
    setActiveId(id);
    const el = sectionEls.current.get(id);
    const container = scrollRef.current;
    if (el && container) {
      container.scrollTo({
        top: el.offsetTop - 16,
        behavior: "smooth",
      });
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] max-h-[860px] w-[96vw] max-w-5xl flex-col gap-0 overflow-hidden rounded-3xl border-border/70 bg-background/95 p-0 backdrop-blur-2xl sm:w-[92vw]"
      >
        {/* Header */}
        <div className="relative shrink-0 border-b border-border/50 bg-card/40 px-5 py-4 sm:px-6">
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-60"
            style={{ background: "var(--gradient-hero)" }}
            aria-hidden="true"
          />
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card/70 text-foreground">
              <Book className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold tracking-tight">
                {chrome.title}
              </DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                {chrome.subtitle}
              </DialogDescription>
            </div>

            {/* Language switcher */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full border-border/60 bg-card/60"
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

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={() => onOpenChange(false)}
              aria-label={t("common.cancel")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={chrome.searchPlaceholder}
              className="h-9 rounded-full border-border/60 bg-card/60 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Body */}
        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[200px_minmax(0,1fr)]">
          {/* Sidebar nav */}
          <nav
            className="hidden min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-border/50 p-3 sm:flex"
            aria-label={chrome.navHeading}
          >
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

          {/* Content */}
          <div
            ref={scrollRef}
            className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8"
          >
            {filtered.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-card/50 p-12 text-center">
                <Search className="mx-auto h-6 w-6 text-muted-foreground/50" />
                <p className="mt-3 font-medium">{chrome.searchEmpty}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {chrome.searchEmptyHint}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-14">
                {filtered.map((s) => (
                  <SectionView key={s.id} section={s} register={register} />
                ))}

                {/* CTA */}
                <div className="ac-spotlight relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 text-center">
                  <div
                    className="pointer-events-none absolute inset-0 -z-10 opacity-50"
                    style={{ background: "var(--gradient-hero)" }}
                    aria-hidden="true"
                  />
                  <h3 className="text-lg font-semibold tracking-tight">
                    {chrome.ctaTitle}
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    {chrome.ctaText}
                  </p>
                  <Button asChild className="mt-5 rounded-full">
                    <a
                      href={DOCS_DISCORD_URL}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <MessageCircle className="mr-2 h-4 w-4" />
                      {chrome.ctaButton}
                    </a>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
