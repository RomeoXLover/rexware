import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Loader2,
  ShieldAlert,
  X,
  MessageSquare,
  UserPlus,
  Search,
  Inbox,
  CheckCheck,
  AtSign,
} from "lucide-react";

import {
  getPluginRunEvents,
  sendPluginReply,
  solvePluginCaptcha,
  cancelPluginCaptcha,
  type RunEvent,
} from "@/lib/api/plugins.functions";

// A polished Discord-style DM panel for an active plugin run. It polls the
// structured DM/relationship events the bot container pushes to the website,
// groups them into per-user conversations, lets the user reply manually, and
// surfaces a manual captcha solver whenever the container raises a challenge.

type Conversation = {
  authorId: string;
  author: string;
  messages: RunEvent[];
  last: RunEvent;
  unread: number;
};

type PendingCaptcha = {
  id: string;
  sitekey: string;
  service: string;
  createdAt: number;
} | null;

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Deterministic accent per author so avatars stay stable across renders.
// Tuned to the site's cool indigo/teal/sky brand palette.
const AVATAR_COLORS = [
  "bg-indigo-500/20 text-indigo-200 ring-indigo-400/30",
  "bg-sky-500/20 text-sky-200 ring-sky-400/30",
  "bg-teal-500/20 text-teal-200 ring-teal-400/30",
  "bg-violet-500/20 text-violet-200 ring-violet-400/30",
  "bg-emerald-500/20 text-emerald-200 ring-emerald-400/30",
  "bg-rose-500/20 text-rose-200 ring-rose-400/30",
];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function DiscordDmPanel({
  runId,
  live,
}: {
  runId: string | null;
  live: boolean;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [captcha, setCaptcha] = useState<PendingCaptcha>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const lastIdRef = useRef(0);
  const seenRef = useRef<Set<number>>(new Set());
  // Tracks the highest event id the user has already seen per conversation,
  // so we can render Discord-style unread badges.
  const readUpToRef = useRef<Map<string, number>>(new Map());

  // Reset everything when switching runs.
  useEffect(() => {
    setEvents([]);
    setCaptcha(null);
    setActiveId(null);
    setQuery("");
    lastIdRef.current = 0;
    seenRef.current = new Set();
    readUpToRef.current = new Map();
  }, [runId]);

  // Incremental polling of the live DM feed.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await getPluginRunEvents({
          data: { runId, afterId: lastIdRef.current, limit: 300 },
        });
        if (cancelled) return;
        if (res.events.length > 0) {
          lastIdRef.current = res.lastId;
          setEvents((prev) => {
            const next = [...prev];
            for (const ev of res.events) {
              if (seenRef.current.has(ev.id)) continue;
              seenRef.current.add(ev.id);
              next.push(ev);
            }
            return next.length > 2000 ? next.slice(-2000) : next;
          });
        }
        setCaptcha(res.captcha);
      } catch {
        // best-effort — keep showing what we have
      }
    };

    poll();
    const id = setInterval(poll, live ? 2500 : 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, live]);

  // Group events into per-user conversations (system events excluded).
  const conversations = useMemo<Conversation[]>(() => {
    const map = new Map<string, Conversation>();
    for (const ev of events) {
      if (ev.kind === "system") continue;
      const key = ev.authorId || ev.author || "unknown";
      const label =
        ev.kind === "outgoing" || ev.author === "Auto-Reply" || ev.author === "You"
          ? ev.authorId || key
          : ev.author || key;
      const existing = map.get(key);
      if (existing) {
        existing.messages.push(ev);
        existing.last = ev;
        if (ev.kind === "incoming" && ev.author) existing.author = ev.author;
      } else {
        map.set(key, {
          authorId: key,
          author: ev.kind === "incoming" ? ev.author || label : label,
          messages: [ev],
          last: ev,
          unread: 0,
        });
      }
    }
    // Compute unread counts from the last-read watermark.
    for (const c of map.values()) {
      const readUpTo = readUpToRef.current.get(c.authorId) ?? 0;
      c.unread = c.messages.filter(
        (m) => m.id > readUpTo && m.kind !== "outgoing",
      ).length;
    }
    return Array.from(map.values()).sort((a, b) => b.last.id - a.last.id);
  }, [events]);

  const totalUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread, 0),
    [conversations],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.author.toLowerCase().includes(q) ||
        c.authorId.toLowerCase().includes(q),
    );
  }, [conversations, query]);

  // Keep a sensible active conversation selected.
  useEffect(() => {
    if (activeId && conversations.some((c) => c.authorId === activeId)) return;
    if (conversations.length > 0) setActiveId(conversations[0].authorId);
  }, [conversations, activeId]);

  // Mark the active conversation as read whenever it gains new messages.
  const active = conversations.find((c) => c.authorId === activeId) ?? null;
  useEffect(() => {
    if (active) readUpToRef.current.set(active.authorId, active.last.id);
  }, [active, active?.last.id]);

  const systemEvents = events.filter((e) => e.kind === "system");
  const lastSystem =
    systemEvents.length > 0 ? systemEvents[systemEvents.length - 1] : null;

  return (
    <div className="ac-noise relative flex flex-col self-start overflow-hidden rounded-xl border border-border/40 bg-[#0e1119] shadow-[var(--shadow-card)]">
      {/* Title bar */}
      <div className="relative flex items-center justify-between border-b border-white/5 bg-gradient-to-b from-white/[0.05] to-transparent px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/15 ring-1 ring-inset ring-indigo-400/20">
            <MessageSquare className="h-3.5 w-3.5 text-indigo-300" />
          </span>
          <span className="text-sm font-medium text-foreground/90">
            Direct Messages
          </span>
          {totalUnread > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold tabular-nums text-white">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            live
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-border/60 bg-muted/30 text-muted-foreground"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400/70" />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                live ? "bg-green-400" : "bg-muted-foreground"
              }`}
            />
          </span>
          {live ? "Live" : "Offline"}
        </span>
      </div>

      {captcha && runId && (
        <CaptchaSolver
          runId={runId}
          captcha={captcha}
          onResolved={() => setCaptcha(null)}
        />
      )}

      {/* Discord-like two-pane layout */}
      <div className="flex h-[460px]">
        {/* Conversation list */}
        <aside className="flex w-[42%] min-w-[156px] max-w-[260px] flex-col border-r border-white/5 bg-black/25">
          <div className="border-b border-white/5 p-2">
            <div className="group flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2 py-1.5 ring-1 ring-inset ring-transparent transition-colors focus-within:bg-white/[0.06] focus-within:ring-indigo-500/30">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a conversation"
                className="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="shrink-0 text-muted-foreground/50 transition-colors hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-6 text-center">
                <Inbox className="h-7 w-7 text-muted-foreground/25" />
                <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                  {!runId
                    ? "Start a run to receive DMs."
                    : query
                      ? "No matches."
                      : "No conversations yet."}
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const isActive = c.authorId === activeId;
                return (
                  <button
                    key={c.authorId}
                    onClick={() => {
                      readUpToRef.current.set(c.authorId, c.last.id);
                      setActiveId(c.authorId);
                    }}
                    className={`group relative mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      isActive
                        ? "bg-white/[0.08]"
                        : "hover:bg-white/[0.04]"
                    }`}
                  >
                    {/* Active indicator pill */}
                    <span
                      className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-indigo-400 transition-opacity ${
                        isActive ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <span className="relative shrink-0">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold ring-1 ring-inset ${avatarColor(
                          c.authorId,
                        )}`}
                      >
                        {initials(c.author)}
                      </span>
                      {live && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0e1119] bg-green-400" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`block truncate text-[12px] ${
                            c.unread > 0
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground/85"
                          }`}
                        >
                          {c.author}
                        </span>
                      </span>
                      <span
                        className={`block truncate text-[11px] ${
                          c.unread > 0
                            ? "text-foreground/70"
                            : "text-muted-foreground/55"
                        }`}
                      >
                        {c.last.kind === "friend"
                          ? "Friend request"
                          : c.last.kind === "outgoing"
                            ? `You: ${c.last.content}`
                            : c.last.content}
                      </span>
                    </span>
                    {c.unread > 0 && (
                      <span className="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold tabular-nums text-white">
                        {c.unread > 9 ? "9+" : c.unread}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
          {/* List footer */}
          <div className="border-t border-white/5 px-3 py-1.5 text-[10px] text-muted-foreground/50">
            {conversations.length}{" "}
            {conversations.length === 1 ? "conversation" : "conversations"}
          </div>
        </aside>

        {/* Conversation view */}
        <section className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <ConversationView
              key={active.authorId}
              conversation={active}
              runId={runId}
              live={live}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] ring-1 ring-inset ring-white/5">
                <AtSign className="h-6 w-6 text-muted-foreground/30" />
              </span>
              <div className="space-y-1">
                <p className="text-[13px] font-medium text-foreground/70">
                  {runId ? "Waiting for messages" : "No active run"}
                </p>
                <p className="text-[11px] text-muted-foreground/50">
                  {lastSystem
                    ? lastSystem.content
                    : "Incoming DMs from your bot will appear here."}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// A cluster groups consecutive messages from the same side/sender so the
// avatar + name render once, Discord-style.
type Cluster = {
  key: number;
  isOut: boolean;
  sender: string;
  authorId: string;
  items: RunEvent[];
};

function buildClusters(messages: RunEvent[], authorId: string): Cluster[] {
  const clusters: Cluster[] = [];
  for (const m of messages) {
    if (m.kind === "friend") {
      clusters.push({
        key: m.id,
        isOut: false,
        sender: "__friend__",
        authorId,
        items: [m],
      });
      continue;
    }
    const isOut = m.kind === "outgoing";
    const sender = isOut
      ? m.author === "Auto-Reply"
        ? "Auto-Reply"
        : "You"
      : m.author || authorId;
    const prev = clusters[clusters.length - 1];
    if (
      prev &&
      prev.sender !== "__friend__" &&
      prev.isOut === isOut &&
      prev.sender === sender
    ) {
      prev.items.push(m);
    } else {
      clusters.push({ key: m.id, isOut, sender, authorId, items: [m] });
    }
  }
  return clusters;
}

function ConversationView({
  conversation,
  runId,
  live,
}: {
  conversation: Conversation;
  runId: string | null;
  live: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conversation.messages.length]);

  const clusters = useMemo(
    () => buildClusters(conversation.messages, conversation.authorId),
    [conversation.messages, conversation.authorId],
  );

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || !runId || !live || sending) return;
    setSending(true);
    try {
      await sendPluginReply({
        data: { runId, targetId: conversation.authorId, content },
      });
      setDraft("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not send the reply.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Conversation header */}
      <div className="flex items-center gap-2.5 border-b border-white/5 bg-white/[0.02] px-3.5 py-2.5">
        <span className="relative shrink-0">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-semibold ring-1 ring-inset ${avatarColor(
              conversation.authorId,
            )}`}
          >
            {initials(conversation.author)}
          </span>
          {live && (
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0e1119] bg-green-400" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground/90">
            {conversation.author}
          </span>
          <span className="flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground/50">
            <AtSign className="h-2.5 w-2.5" />
            {conversation.authorId}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5"
      >
        <div className="flex flex-col items-center gap-1 pb-2 text-center">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-semibold ring-1 ring-inset ${avatarColor(
              conversation.authorId,
            )}`}
          >
            {initials(conversation.author)}
          </span>
          <p className="text-[12px] font-medium text-foreground/80">
            {conversation.author}
          </p>
          <p className="text-[10px] text-muted-foreground/50">
            This is the beginning of your conversation.
          </p>
        </div>
        {clusters.map((cluster) =>
          cluster.sender === "__friend__" ? (
            <FriendNotice key={cluster.key} message={cluster.items[0]} />
          ) : (
            <MessageCluster key={cluster.key} cluster={cluster} />
          ),
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="border-t border-white/5 bg-white/[0.02] p-2.5"
      >
        <div
          className={`flex items-center gap-2 rounded-lg bg-white/[0.05] px-2 py-1 ring-1 ring-inset transition-colors ${
            live
              ? "ring-transparent focus-within:ring-indigo-500/40"
              : "ring-transparent opacity-60"
          }`}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!live || sending}
            maxLength={2000}
            placeholder={
              live
                ? `Message ${conversation.author}`
                : "Run offline — replies disabled"
            }
            className="min-w-0 flex-1 bg-transparent px-1.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:cursor-not-allowed"
          />
          {draft.length > 1800 && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
              {2000 - draft.length}
            </span>
          )}
          <button
            type="submit"
            disabled={!live || sending || draft.trim().length === 0}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-indigo-500 text-white transition-all hover:bg-indigo-400 disabled:bg-white/5 disabled:text-muted-foreground/40"
            aria-label="Send reply"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </form>
    </>
  );
}

function MessageCluster({ cluster }: { cluster: Cluster }) {
  const isOut = cluster.isOut;
  const isAuto = cluster.sender === "Auto-Reply";
  const colorClass = avatarColor(isOut ? cluster.sender : cluster.authorId);
  const headTs = cluster.items[0].ts;

  return (
    <div
      className={`flex animate-[ac-fade-in_0.28s_ease-out] gap-2.5 ${
        isOut ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* Avatar — rendered once per cluster */}
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ring-1 ring-inset ${colorClass}`}
      >
        {isOut ? (isAuto ? "AR" : "ME") : initials(cluster.sender)}
      </span>

      <div className={`flex min-w-0 flex-col gap-1 ${isOut ? "items-end" : "items-start"}`}>
        {/* Name + time header */}
        <div className="flex items-center gap-1.5 px-0.5">
          <span
            className={`text-[11px] font-semibold ${
              isOut
                ? isAuto
                  ? "text-teal-300"
                  : "text-indigo-300"
                : "text-foreground/85"
            }`}
          >
            {isOut ? (isAuto ? "Auto-Reply" : "You") : cluster.sender}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/40">
            {headTs}
          </span>
        </div>

        {/* Stacked bubbles */}
        {cluster.items.map((m) => (
          <div
            key={m.id}
            className={`max-w-[min(85%,360px)] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-[12px] leading-relaxed shadow-sm ${
              isOut
                ? isAuto
                  ? "rounded-tr-md bg-teal-500/15 text-teal-50 ring-1 ring-inset ring-teal-400/20"
                  : "rounded-tr-md bg-indigo-500 text-white"
                : "rounded-tl-md bg-white/[0.06] text-foreground/90 ring-1 ring-inset ring-white/5"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>
    </div>
  );
}

function FriendNotice({ message }: { message: RunEvent }) {
  return (
    <div className="flex animate-[ac-fade-in_0.28s_ease-out] items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-200">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
        <UserPlus className="h-3.5 w-3.5 text-emerald-300" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-emerald-100">{message.author}</span>{" "}
        sent a friend request
      </span>
      <span className="shrink-0 font-mono text-[10px] text-emerald-300/50">
        {message.ts}
      </span>
    </div>
  );
}

function CaptchaSolver({
  runId,
  captcha,
  onResolved,
}: {
  runId: string;
  captcha: NonNullable<PendingCaptcha>;
  onResolved: () => void;
}) {
  const [solution, setSolution] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = solution.trim();
    if (!token || busy) return;
    setBusy(true);
    try {
      await solvePluginCaptcha({
        data: { runId, captchaId: captcha.id, solution: token },
      });
      onResolved();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not submit the solution.");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    try {
      await cancelPluginCaptcha({ data: { runId, captchaId: captcha.id } });
      onResolved();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative animate-[ac-fade-in_0.3s_ease-out] overflow-hidden border-b border-amber-500/25 bg-amber-500/[0.08] px-4 py-3">
      {/* Scanning accent line */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500/15 ring-1 ring-inset ring-amber-400/25">
          <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[12px] font-semibold text-amber-100">
              Captcha challenge
            </p>
            <span className="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-300 ring-1 ring-inset ring-amber-400/20">
              {captcha.service}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">
            The bot won&apos;t auto-solve this. Solve the{" "}
            <span className="font-mono text-amber-200/90">
              {captcha.sitekey.slice(0, 14)}…
            </span>{" "}
            challenge and paste the response token to resume.
          </p>
          <form onSubmit={submit} className="mt-2.5 flex items-center gap-2">
            <input
              value={solution}
              onChange={(e) => setSolution(e.target.value)}
              autoFocus
              placeholder="Paste captcha response token"
              className="min-w-0 flex-1 rounded-md bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/50 ring-1 ring-inset ring-amber-400/15 focus:outline-none focus:ring-amber-500/40"
            />
            <button
              type="submit"
              disabled={busy || solution.trim().length === 0}
              className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              Submit
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={busy}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-500/30 text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-40"
              aria-label="Dismiss captcha"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
