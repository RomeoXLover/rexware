import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Loader2, Wifi, WifiOff, Reply, Trash2, Share2, X, Copy, MessageSquare } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { fetchSessionUser, fetchIsAdmin } from "@/lib/api/auth.functions";

type ChatMessage = {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  content: string;
  reply_to_id: string | null;
  reply_to_username: string | null;
  created_at: number;
};

type InitEvent = { type: "init"; messages: ChatMessage[] };
type MessageEvent = { type: "message"; message: ChatMessage };
type ModerationEvent = {
  type: "moderation";
  action: "delete";
  messageId: string;
};
type SSEEvent = InitEvent | MessageEvent | ModerationEvent;

const AVATAR_BG = [
  "#5865F2", "#3BA55C", "#FAA61A", "#ED4245",
  "#9B59B6", "#E91E63", "#1ABC9C", "#E74C3C",
  "#9C27B0", "#00BCD4", "#FF5722", "#8BC34A",
];

function avatarBg(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

type MsgGroup = {
  authorId: string;
  username: string;
  avatarUrl: string | null;
  messages: ChatMessage[];
  showDate: string | null;
};

function buildGroups(msgs: ChatMessage[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  for (const msg of msgs) {
    const prev = msgs[msgs.indexOf(msg) - 1];
    const showDate =
      !prev ? formatDate(msg.created_at)
      : new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString()
      ? formatDate(msg.created_at)
      : null;

    const sameUser =
      groups.length > 0 &&
      groups[groups.length - 1].authorId === msg.user_id;

    const within5min =
      sameUser &&
      msg.created_at -
        groups[groups.length - 1].messages[groups[groups.length - 1].messages.length - 1].created_at <
        5 * 60 * 1000;

    if (sameUser && within5min) {
      groups[groups.length - 1].messages.push(msg);
    } else {
      groups.push({
        authorId: msg.user_id,
        username: msg.username,
        avatarUrl: msg.avatar_url,
        messages: [msg],
        showDate,
      });
    }
  }
  return groups;
}

type ReplyTarget = {
  id: string;
  username: string;
  content: string;
};

type ShareMessage = {
  id: string;
  username: string;
  content: string;
};

export function GlobalChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [shareMsg, setShareMsg] = useState<ShareMessage | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load session info client-side
  useEffect(() => {
    fetchSessionUser()
      .then((session) => {
        if (session?.id) setCurrentUserId(session.id);
      })
      .catch(() => {});
    fetchIsAdmin()
      .then((val) => setIsAdmin(val))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    let es: EventSource;
    let destroyed = false;

    const connect = () => {
      es = new EventSource("/api/runner/global-chat");

      es.addEventListener("open", () => setConnected(true));
      es.addEventListener("message", (e) => {
        if (destroyed) return;
        try {
          const data: SSEEvent = JSON.parse(e.data);
          if (data.type === "init") {
            setMessages(data.messages);
          } else if (data.type === "message") {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.message.id)) return prev;
              return [...prev, data.message];
            });
          } else if (data.type === "moderation") {
            if (data.action === "delete") {
              setMessages((prev) => prev.filter((m) => m.id !== data.messageId));
            }
          }
        } catch { /* ignore */ }
      });
      es.addEventListener("error", () => {
        setConnected(false);
        es.close();
        if (!destroyed) setTimeout(connect, 3000);
      });
    };

    connect();
    return () => { destroyed = true; es?.close(); };
  }, []);

  useEffect(() => {
    if (!userScrolledUp) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, userScrolledUp]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setUserScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      const body: Record<string, string> = { content };
      if (replyTarget) {
        body.replyToId = replyTarget.id;
        body.replyToUsername = replyTarget.username;
      }
      const res = await fetch("/api/global-chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to send");
      setReplyTarget(null);
    } catch {
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  const handleDeleteOwn = async (messageId: string) => {
    try {
      const res = await fetch("/api/global-chat/delete-own", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    } catch { /* ignore */ }
  };

  const handleDeleteAdmin = async (messageId: string) => {
    try {
      const res = await fetch("/api/global-chat/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", messageId }),
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    } catch { /* ignore */ }
  };

  const handleReply = (msg: ChatMessage) => {
    setReplyTarget({ id: msg.id, username: msg.username, content: msg.content });
    textareaRef.current?.focus();
  };

  const handleForward = (msg: ChatMessage) => {
    setShareMsg({ id: msg.id, username: msg.username, content: msg.content });
  };

  const handleCopyLink = (msg: ChatMessage) => {
    const text = `${msg.username}: ${msg.content}`;
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const groups = useMemo(() => buildGroups(messages), [messages]);

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-0 overflow-hidden rounded-2xl" style={{ background: "#0d0d12" }}>
      {/* Share/Forward popup */}
      {shareMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-xl border border-[#313338] bg-[#1e1f22] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-white">Share Message</h3>
              <button
                onClick={() => setShareMsg(null)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#949ba4] hover:bg-[#2d2d2d] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 rounded-lg border border-[#313338] bg-[#0d0d12] p-4">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[14px] font-semibold text-white">{shareMsg.username}</span>
              </div>
              <p className="text-[14px] leading-relaxed text-white/80 whitespace-pre-wrap break-words">
                {shareMsg.content}
              </p>
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[12px] font-medium text-[#949ba4]">
                Copy message text
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const text = `${shareMsg.username}: ${shareMsg.content}`;
                    navigator.clipboard.writeText(text).catch(() => {});
                    setShareMsg(null);
                  }}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#4752c4]"
                >
                  <Copy className="h-4 w-4" />
                  Copy to Clipboard
                </button>
              </div>
            </div>
            <p className="text-[12px] text-[#6d6f78]">
              Share this message with others. To forward to Discord, the recipient can add the bot.
            </p>
          </div>
        </div>
      )}

      {/* Main chat */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div
          className="flex h-[52px] shrink-0 items-center justify-between border-b border-black/30 px-6"
          style={{ background: "#0e0f12" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-white">Global Chat</span>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium"
            style={{
              background: connected ? "rgba(63,185,80,0.12)" : "rgba(239,68,68,0.12)",
              color: connected ? "#3fb950" : "#f14c4c",
            }}
          >
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "Live" : "Offline"}
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="no-scrollbar flex-1 overflow-y-auto py-6"
        >
          {groups.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center pt-16">
              <div className="ac-float mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[#2b2d31]">
                <MessageSquare className="h-7 w-7 text-[#5865F2]" />
              </div>
              <h2 className="mb-2 text-xl font-bold text-white">Global Chat</h2>
              <p className="text-[14px] text-[#b5bac1]">
                Chat with other SkyUtils operators in real time.
              </p>
            </div>
          ) : (
            <>
              {groups.map((group, gi) => (
                <div key={`${group.authorId}-${gi}`}>
                  {group.showDate && (
                    <div className="my-5 flex items-center px-6">
                      <div className="h-px flex-1 bg-[#313338]" />
                      <div className="mx-4 flex items-center gap-2 rounded-full border border-[#313338] bg-[#1e1f22] px-4 py-1">
                        <span className="text-[12px] font-medium text-[#b5bac1]">{group.showDate}</span>
                      </div>
                      <div className="h-px flex-1 bg-[#313338]" />
                    </div>
                  )}

                  <div className="group flex gap-4 px-6 py-1 hover:bg-[#2b2d31]/60 rounded-lg mx-2 transition-colors">
                    {/* Avatar */}
                    <div className="mt-0.5 w-[40px] shrink-0 pt-1">
                      {group.avatarUrl ? (
                        <img
                          src={group.avatarUrl}
                          alt={group.username}
                          className="h-10 w-10 rounded-full object-cover"
                          crossOrigin="anonymous"
                        />
                      ) : (
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold text-white"
                          style={{ background: avatarBg(group.authorId) }}
                        >
                          {initials(group.username)}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-baseline gap-2">
                        <span className="text-[15px] font-semibold text-white">{group.username}</span>
                        <span className="text-[12px] text-[#949ba4]">{formatTime(group.messages[0].created_at)}</span>
                      </div>
                      {group.messages.map((msg) => (
                        <div key={msg.id}>
                          {/* Reply reference */}
                          {msg.reply_to_id && msg.reply_to_username && (
                            <div className="mb-1 flex items-center gap-2 pl-2 border-l-2 border-[#5865F2]/40">
                              <Reply className="h-3 w-3 shrink-0 text-[#5865F2]" />
                              <span className="text-[12px] text-[#5865F2]">{msg.reply_to_username}</span>
                            </div>
                          )}
                          <ContextMenu>
                            <ContextMenuTrigger asChild>
                              <p className="text-[14px] leading-[1.5] text-white/90 whitespace-pre-wrap break-words">
                              {msg.content}
                            </p>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onClick={() => handleReply(msg)}
                              className="gap-2"
                            >
                              <Reply className="h-4 w-4" />
                              Reply
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => handleForward(msg)}
                              className="gap-2"
                            >
                              <Share2 className="h-4 w-4" />
                              Forward
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() => handleCopyLink(msg)}
                              className="gap-2"
                            >
                              <Copy className="h-4 w-4" />
                              Copy Text
                            </ContextMenuItem>
                            {(currentUserId === msg.user_id) && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => handleDeleteOwn(msg.id)}
                                  className="gap-2 text-red-400 focus:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </ContextMenuItem>
                              </>
                            )}
                            {isAdmin && currentUserId !== msg.user_id && (
                              <>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  onClick={() => handleDeleteAdmin(msg.id)}
                                  className="gap-2 text-red-400 focus:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete (Admin)
                                </ContextMenuItem>
                              </>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* Scroll to bottom */}
        {userScrolledUp && (
          <button
            onClick={() => { setUserScrolledUp(false); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
            className="nex-nav-indicator absolute bottom-28 left-1/2 z-10 flex cursor-pointer items-center gap-2 rounded-full border border-[#5865F2] bg-[#5865F2] px-4 py-2 text-[13px] font-medium text-white shadow-[0_4px_20px_rgba(88,101,242,0.4)] transition-all hover:bg-[#4752c4]"
          >
            ↓ New messages
          </button>
        )}

        {/* Reply banner */}
        {replyTarget && (
          <div className="mx-6 mb-2 flex items-center gap-3 rounded-lg border border-[#5865F2]/50 bg-[#5865F2]/10 px-4 py-2">
            <Reply className="h-4 w-4 shrink-0 text-[#5865F2]" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-[#5865F2]">Replying to {replyTarget.username}</p>
              <p className="truncate text-[12px] text-[#949ba4]">{replyTarget.content}</p>
            </div>
            <button
              onClick={() => setReplyTarget(null)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#949ba4] hover:bg-[#2d2d2d] hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Composer */}
        <form onSubmit={handleSend} className="px-6 pb-6 pt-2">
          <div
            className="flex items-end gap-3 rounded-xl border border-[#313338] px-4 py-3 transition-colors focus-within:border-[#5865F2]"
            style={{ background: "#1e1f22" }}
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e as unknown as React.FormEvent);
                }
              }}
              disabled={sending}
              maxLength={1000}
              placeholder="Message global chat…"
              rows={1}
              className="min-h-[20px] max-h-40 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-white placeholder:text-[#6d6f78] focus:outline-none disabled:opacity-50"
            />
            {draft.length > 800 && (
              <span className="shrink-0 font-mono text-[11px] text-[#6d6f78]">{1000 - draft.length}</span>
            )}
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5865F2] text-white transition-all hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
