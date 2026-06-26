import { useState } from "react";
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
  ChevronRight,
  Info,
  Lightbulb,
  AlertTriangle,
  Hash,
} from "lucide-react";
import type {
  DocsBlock,
  DocsSection,
  TerminalTab,
  TermLineType,
} from "@/lib/i18n/docs-content";

// ---------------------------------------------------------------------------
// Shared documentation renderer — used both by the full /docs page and the
// in-app multilingual Guide popup so the two always look and read identically.
// ---------------------------------------------------------------------------

/* ─── Icon mapping ─── */
export const ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
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

export function TerminalCard({ tabs }: { tabs: TerminalTab[] }) {
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

export function Callout({
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
export function Block({ block }: { block: DocsBlock }) {
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
export function SectionView({
  section,
  register,
}: {
  section: DocsSection;
  register?: (id: string, el: HTMLElement | null) => void;
}) {
  const Icon = ICONS[section.icon] ?? Book;
  return (
    <section
      id={section.id}
      ref={(el) => register?.(section.id, el)}
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
