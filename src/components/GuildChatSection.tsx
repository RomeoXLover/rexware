import { useEffect, useMemo, useRef, useState } from "react";
import {
  Hash,
  Send,
  Loader2,
  Users,
  Wifi,
  WifiOff,
  Crown,
  ChevronRight,
  Plus,
  Settings,
  RefreshCw,
  ExternalLink,
  Mic,
  CheckCircle2,
  AlertCircle,
  Shield,
  ShieldCheck,
  Zap,
  Lock,
  Check,
  X,
  ImageIcon,
  Gift,
  Sticker,
  Paperclip,
  Smile,
  ChevronDown,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type DiscordRole = {
  id: string;
  name: string;
  color: number;
  position: number;
  permissions_new: string;
  unicode_emoji: string | null;
};

type DiscordChannel = {
  id: string;
  name: string;
  type: number; // 0 = text, 4 = category
  parent_id: string | null;
  position: number;
  permission_overwrites?: Array<{
    id: string;
    type: number; // 0 = role, 1 = member
    allow: string;
    deny: string;
  }>;
};

type DiscordGuild = {
  id: string;
  name: string;
  icon: string | null;
  owner?: boolean;
  approximate_member_count?: number;
  approximate_presence_count?: number;
};

type DiscordMessage = {
  id: string;
  author: {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    bot?: boolean;
  };
  member?: {
    nick: string | null;
    roles: string[];
  };
  content: string;
  timestamp: string;
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    content_type: string;
    size: number;
  }>;
  type: number;
};

type InitEvent = { type: "init"; messages: DiscordMessage[]; guild: DiscordGuild | null; channelName: string | null };
type MessagesEvent = { type: "messages"; messages: DiscordMessage[] };
type SSEEvent = InitEvent | MessagesEvent;

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexFromDec(dec: number): string {
  if (!dec || dec === 0) return "#99aab5";
  return `#${((dec >> 16) & 0xff).toString(16).padStart(2, "0")}${((dec >> 8) & 0xff).toString(16).padStart(2, "0")}${(dec & 0xff).toString(16).padStart(2, "0")}`;
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function msgTime(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

const AVATAR_COLORS = ["#5865F2","#3BA55C","#FAA61A","#ED4245","#9B59B6","#E91E63","#1ABC9C","#E74C3C"];
function avatarBg(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function avatarUrl(userId: string, avatar: string | null): string | null {
  if (!avatar) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png`;
}

// ── Step 1: Guild Picker ──────────────────────────────────────────────────────

function GuildPicker({
  onSelect,
  error,
  loading,
}: {
  onSelect: (g: DiscordGuild) => void;
  error: string | null;
  loading: boolean;
}) {
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/guild/chat/guilds")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setGuilds(d.guilds ?? []);
      })
      .catch((e) => setFetchError(e.message))
      .finally(() => setLoadingGuilds(false));
  }, []);

  return (
    <div className="flex h-full items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "#5865F2" }}>
            <MessageSquare className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-[22px] font-bold text-white">Select Your Discord Guild</h2>
          <p className="text-[14px] text-[#b5bac1]">
            Choose which server you want to bridge to SkyUtils. Only servers where SkyUtils's bot has admin permissions are shown.
          </p>
        </div>

        {(fetchError || error) && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
            <p className="text-[12px] text-red-300">{fetchError ?? error}</p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {loadingGuilds ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-20 items-center gap-3 rounded-xl border border-[#313338] bg-[#1e1f22] px-4 animate-pulse">
                <div className="h-12 w-12 rounded-full bg-[#313338]" />
                <div className="h-4 w-24 rounded bg-[#313338]" />
              </div>
            ))
          ) : guilds.length === 0 ? (
            <div className="col-span-2 rounded-xl border border-[#313338] bg-[#1e1f22] p-8 text-center">
              <p className="text-[14px] text-[#b5bac1]">No guilds found. Make sure the SkyUtils bot is in your server with admin permissions.</p>
            </div>
          ) : (
            guilds.map((g) => (
              <button
                key={g.id}
                onClick={() => onSelect(g)}
                className="flex h-20 items-center gap-3 rounded-xl border border-[#313338] bg-[#1e1f22] px-4 text-left transition-all hover:border-[#5865F2] hover:bg-[#26262e] disabled:opacity-50"
              >
                {g.icon ? (
                  <img src={g.icon} alt={g.name} className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#5865F2] text-[16px] font-bold text-white">
                    {initials(g.name)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold text-white">{g.name}</span>
                    {g.owner && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  </div>
                  {g.approximate_member_count != null && (
                    <span className="text-[12px] text-[#6d6f78]">{g.approximate_member_count.toLocaleString()} members</span>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#6d6f78]" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Channel Picker ────────────────────────────────────────────────────

type CategoryGroup = { category: DiscordChannel; channels: DiscordChannel[] };
type TopChannels = { channels: DiscordChannel[] };

function ChannelPicker({
  guild,
  onBack,
  onSelect,
  loading,
  error,
}: {
  guild: DiscordGuild;
  onBack: () => void;
  onSelect: (ch: DiscordChannel) => void;
  loading: boolean;
  error: string | null;
}) {
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/guild/chat/channels?guildId=${guild.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setChannels([...(d.categories ?? []), ...(d.textChannels ?? []), ...(d.topChannels ?? [])]);
        setRoles(d.roles ?? []);
      })
      .catch((e) => setFetchError(e.message))
      .finally(() => setLoadingChannels(false));
  }, [guild.id]);

  // Group text channels under categories
  const categoryGroups = useMemo((): CategoryGroup[] => {
    const categories = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
    return categories.map((cat) => ({
      category: cat,
      channels: channels
        .filter((c) => c.type === 0 && c.parent_id === cat.id)
        .sort((a, b) => a.position - b.position),
    }));
  }, [channels]);

  const topChannels = useMemo((): DiscordChannel[] => {
    return channels.filter((c) => c.type === 0 && !c.parent_id).sort((a, b) => a.position - b.position);
  }, [channels]);

  const handleSelect = async (ch: DiscordChannel) => {
    setConnecting(ch.id);
    setConnectError(null);
    try {
      const res = await fetch("/api/guild/chat/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId: guild.id, channelId: ch.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Connection failed");
      onSelect(ch);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(null);
    }
  };

  const roleMap = useMemo(() => {
    const m = new Map<string, DiscordRole>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md text-[#949ba4] transition-colors hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-3">
          {guild.icon ? (
            <img src={guild.icon} alt={guild.name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#5865F2] text-[14px] font-bold text-white">
              {initials(guild.name)}
            </div>
          )}
          <div>
            <h2 className="text-[18px] font-bold text-white">{guild.name}</h2>
            <p className="text-[12px] text-[#6d6f78]">Choose a channel to bridge</p>
          </div>
        </div>
      </div>

      {(fetchError || connectError || error) && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <p className="text-[12px] text-red-300">{fetchError ?? connectError ?? error}</p>
        </div>
      )}

      <div className="no-scrollbar flex-1 overflow-y-auto">
        {/* Top-level channels (no category) */}
        {topChannels.length > 0 && (
          <div className="mb-4">
            <div className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#6d6f78]">Channels</div>
            {topChannels.map((ch) => (
              <ChannelRow
                key={ch.id}
                channel={ch}
                roles={roles}
                roleMap={roleMap}
                connecting={connecting}
                onSelect={handleSelect}
              />
            ))}
          </div>
        )}

        {/* Category groups */}
        {categoryGroups.map(({ category, channels: catChannels }) => (
          <div key={category.id} className="mb-4">
            <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#6d6f78]">
              <ChevronRight className="h-3 w-3" />
              {category.name}
            </div>
            {catChannels.map((ch) => (
              <ChannelRow
                key={ch.id}
                channel={ch}
                roles={roles}
                roleMap={roleMap}
                connecting={connecting}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ))}

        {loadingChannels && (
          <div className="space-y-2 px-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex h-8 items-center gap-2 rounded bg-[#1e1f22] px-2 animate-pulse">
                <div className="h-4 w-4 rounded bg-[#313338]" />
                <div className="h-3 w-24 rounded bg-[#313338]" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  roles,
  roleMap,
  connecting,
  onSelect,
}: {
  channel: DiscordChannel;
  roles: DiscordRole[];
  roleMap: Map<string, DiscordRole>;
  connecting: string | null;
  onSelect: (ch: DiscordChannel) => void;
}) {
  const isConnecting = connecting === channel.id;

  // Check if any role the bot might not have access to
  const deniedRoles = (channel.permission_overwrites ?? [])
    .filter((o) => o.type === 0 && (BigInt(o.deny) & 0x4000000000n))
    .map((o) => o.id);

  return (
    <button
      onClick={() => onSelect(channel)}
      disabled={isConnecting}
      className="group mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[#949ba4] transition-colors hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed"
    >
      <Hash className="h-5 w-5 shrink-0" />
      <span className="flex-1 text-[14px] font-medium">{channel.name}</span>
      {deniedRoles.length > 0 && (
        <Lock className="h-3.5 w-3.5 text-[#6d6f78] opacity-0 group-hover:opacity-100" title="May have restricted access" />
      )}
      {isConnecting ? (
        <Loader2 className="h-4 w-4 animate-spin text-[#5865F2]" />
      ) : (
        <Check className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

// ── Connected Chat ─────────────────────────────────────────────────────────────

type MsgGroup = {
  key: string;
  authorId: string;
  authorName: string;
  authorGlobalName: string | null;
  authorAvatar: string | null;
  authorBot: boolean | undefined;
  memberRoles: string[];
  messages: DiscordMessage[];
  showDate: string | null;
};

function buildGroups(msgs: DiscordMessage[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  for (const msg of msgs) {
    const prev = msgs[msgs.indexOf(msg) - 1];
    const showDate =
      !prev ? formatDate(msg.timestamp)
      : new Date(msg.timestamp).toDateString() !== new Date(prev.timestamp).toDateString()
      ? formatDate(msg.timestamp)
      : null;

    const sameUser =
      groups.length > 0 &&
      groups[groups.length - 1].authorId === msg.author.id &&
      (msg.timestamp && groups[groups.length - 1].messages[groups[groups.length - 1].messages.length - 1].timestamp
        ? new Date(msg.timestamp).getTime() - new Date(groups[groups.length - 1].messages[groups[groups.length - 1].messages.length - 1].timestamp).getTime()
        : 0) < 5 * 60 * 1000;

    if (sameUser) {
      groups[groups.length - 1].messages.push(msg);
    } else {
      groups.push({
        key: `${msg.author.id}-${msg.id}`,
        authorId: msg.author.id,
        authorName: msg.author.username,
        authorGlobalName: msg.author.global_name,
        authorAvatar: msg.author.avatar,
        authorBot: msg.author.bot,
        memberRoles: msg.member?.roles ?? [],
        messages: [msg],
        showDate,
      });
    }
  }
  return groups;
}

function ConnectedChat({
  guildId,
  channelId,
  channelName,
  onDisconnect,
}: {
  guildId: string;
  channelId: string;
  channelName: string | null;
  onDisconnect: () => void;
}) {
  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [guild, setGuild] = useState<DiscordGuild | null>(null);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [showMemberList, setShowMemberList] = useState(true);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const EMOJIS = ["😀","😂","😍","🔥","🥶","💀","🤯","😭","🥰","🤔","👍","👎","🎉","✅","❌","⭐","❤️","💔","🎮","⚡","☕","🍕","🌟","💯","🎯","🏆","🚀","💎","🌈","🍀","😎","🤡","💩","😈","👻","🤖","🦄","🐉","🌸","🍂"];

  // SSE connection
  useEffect(() => {
    let es: EventSource;
    let destroyed = false;

    const connect = () => {
      es = new EventSource(`/api/guild/chat/messages?guildId=${guildId}`);
      es.addEventListener("open", () => setConnected(true));
      es.addEventListener("message", (e) => {
        if (destroyed) return;
        try {
          const data: SSEEvent = JSON.parse(e.data);
          if (data.type === "init") {
            setMessages(data.messages ?? []);
            if (data.guild) setGuild(data.guild);
          } else if (data.type === "messages") {
            setMessages((prev) => {
              const merged = [...prev];
              for (const m of data.messages ?? []) {
                if (!merged.some((x) => x.id === m.id)) merged.push(m);
              }
              return merged.length > 500 ? merged.slice(-500) : merged;
            });
          }
        } catch { /* ignore */ }
      });
      es.addEventListener("error", () => {
        setConnected(false);
        es.close();
        if (!destroyed) setTimeout(connect, 4000);
      });
    };

    connect();
    return () => { destroyed = true; es?.close(); };
  }, [guildId]);

  // Load roles + my roles
  useEffect(() => {
    fetch(`/api/guild/chat/members?guildId=${guildId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.roles) setRoles(d.roles);
        if (d.myRoles) setMyRoles(d.myRoles);
        if (d.guild) setGuild(d.guild);
      })
      .catch(() => {});
    const interval = setInterval(() => {
      fetch(`/api/guild/chat/members?guildId=${guildId}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.guild) setGuild(d.guild);
          if (d.roles) setRoles(d.roles);
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [guildId]);

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
      const res = await fetch("/api/guild/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guildId, content }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "send failed");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not send");
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  const groups = useMemo(() => buildGroups(messages), [messages]);
  const roleMap = useMemo(() => { const m = new Map<string, DiscordRole>(); for (const r of roles) m.set(r.id, r); return m; }, [roles]);

  const sortedRoles = useMemo(() =>
    [...roles].sort((a, b) => b.position - a.position), [roles]);

  const guildName = guild?.name ?? channelName ?? "Guild";
  const guildIcon = guild?.icon ?? null;
  const presenceCount = guild?.approximate_presence_count ?? 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col" style={{ background: "#0d0d12" }}>
      {/* Header */}
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-black/30 px-4" style={{ background: "#0e0f12" }}>
        <div className="flex items-center gap-3">
          <Hash className="h-6 w-6 text-[#949ba4]" />
          <span className="text-[15px] font-semibold text-white">{channelName ?? "channel"}</span>
          {guildName && guildName !== channelName && (
            <>
              <span className="h-0.5 w-0.5 rounded-full bg-[#949ba4]" />
              <span className="text-[13px] text-[#949ba4]">{guildName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowMemberList((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${showMemberList ? "bg-white/10 text-white" : "text-[#949ba4] hover:bg-white/10 hover:text-white"}`}>
            <Users className="h-5 w-5" />
          </button>
          <a href={`https://discord.com/channels/${guildId}/${channelId}`} target="_blank" rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#949ba4] transition-colors hover:bg-white/10 hover:text-white">
            <ExternalLink className="h-4 w-4" />
          </a>
          <button onClick={onDisconnect}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#949ba4] transition-colors hover:bg-white/10 hover:text-red-400" title="Disconnect">
            <X className="h-4 w-4" />
          </button>
          <div className={`ml-2 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${connected ? "border-green-500/30 text-green-400" : "border-red-500/30 text-red-400"}`}
            style={{ background: connected ? "rgba(63,185,80,0.10)" : "rgba(239,68,68,0.10)" }}>
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? "Live" : "Offline"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="no-scrollbar flex-1 overflow-y-auto py-4">
        {groups.length === 0 ? (
          <div className="px-4 pt-8">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "#313338" }}>
              <Hash className="h-8 w-8 text-[#949ba4]" />
            </div>
            <h2 className="mb-1 text-[22px] font-bold text-white">Welcome to #{channelName}</h2>
            <p className="text-[14px] text-[#b5bac1]">
              This is the beginning of the channel.{presenceCount > 0 && <> <strong className="text-white">{presenceCount}</strong> members online.</>}
            </p>
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.key}>
                {group.showDate && (
                  <div className="my-4 flex items-center px-4">
                    <div className="h-px flex-1 bg-[#313338]" />
                    <div className="mx-4 flex items-center gap-2 rounded-full border border-[#313338] bg-[#1e1f22] px-4 py-1">
                      <span className="text-[12px] font-medium text-[#b5bac1]">{group.showDate}</span>
                    </div>
                    <div className="h-px flex-1 bg-[#313338]" />
                  </div>
                )}
                <div className="group flex gap-4 px-4 py-0.5 hover:bg-white/[0.02]">
                  {/* Avatar */}
                  <div className="mt-0.5 flex w-[40px] shrink-0 flex-col items-center pt-1">
                    {(() => {
                      const url = avatarUrl(group.authorId, group.authorAvatar);
                      return url ? (
                        <img src={url} alt={group.authorName} className="h-10 w-10 rounded-full object-cover" crossOrigin="anonymous" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold text-white" style={{ background: avatarBg(group.authorId) }}>
                          {initials(group.authorGlobalName ?? group.authorName)}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {/* Name row */}
                    <div className="mb-1 flex flex-wrap items-baseline gap-1.5">
                      <span className="text-[15px] font-semibold" style={{ color: hexFromDec(roleMap.get(group.memberRoles[0] ?? "")?.color ?? 0) }}>
                        {group.authorGlobalName ?? group.authorName}
                      </span>
                      {group.authorBot && <span className="rounded px-1 text-[10px] font-semibold text-[#5865F2] ring-1 ring-[#5865F2]/40">BOT</span>}
                      {group.memberRoles.slice(0, 1).map((rid) => {
                        const r = roleMap.get(rid);
                        if (!r || r.name === "@everyone") return null;
                        return (
                          <span key={rid} className="rounded px-1 text-[10px] font-semibold"
                            style={{ color: hexFromDec(r.color), background: `${hexFromDec(r.color)}22`, border: `1px solid ${hexFromDec(r.color)}44` }}>
                            {r.name}
                          </span>
                        );
                      })}
                      <span className="text-[12px] text-[#949ba4]">{msgTime(group.messages[0].timestamp)}</span>
                    </div>

                    {/* Messages */}
                    {group.messages.map((msg) => (
                      <div key={msg.id}>
                        {msg.attachments.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {msg.attachments.map((att) =>
                              att.content_type?.startsWith("image/") ? (
                                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer">
                                  <img src={att.url} alt={att.filename} className="max-w-80 rounded-lg object-cover" style={{ maxHeight: 300 }} />
                                </a>
                              ) : (
                                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg border border-[#313338] bg-[#2b2d31] px-3 py-2 text-[13px] text-[#00aff4] hover:bg-[#35373d]">
                                  <Paperclip className="h-4 w-4" />{att.filename}
                                </a>
                              )
                            )}
                          </div>
                        )}
                        {msg.content && <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.5] text-white/90">{msg.content}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Hover actions */}
                  <div className="hidden w-14 shrink-0 flex-col items-end gap-1 pt-1 group-hover:flex">
                    <button className="flex h-7 w-7 items-center justify-center rounded-md text-[#b5bac1] transition-colors hover:bg-white/10 hover:text-white">
                      <Smile className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Emoji picker */}
      {showEmojiPicker && (
        <div className="mx-4 mb-2 flex flex-wrap gap-1 rounded-xl border border-[#313338] bg-[#1e1f22] p-3 shadow-xl">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => { setDraft((d) => d + e); setShowEmojiPicker(false); textareaRef.current?.focus(); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[18px] transition-colors hover:bg-white/10 hover:scale-110">
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Scroll to bottom */}
      {userScrolledUp && (
        <button onClick={() => { setUserScrolledUp(false); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
          className="absolute bottom-24 left-1/2 z-10 flex items-center gap-2 rounded-full border border-[#313338] bg-[#1e1f22] px-4 py-2 text-[13px] text-white shadow-xl transition-colors hover:bg-[#2d2d2d]">
          <ChevronRight className="h-4 w-4 rotate-[-90deg]" />New messages
        </button>
      )}

      {/* Composer */}
      <form onSubmit={handleSend} className="px-4 pb-4 pt-1">
        <div className="rounded-xl border border-[#313338]" style={{ background: "#1e1f22" }}>
          <div className="flex items-center gap-0.5 border-b border-[#313338] px-2 py-1.5">
            {[
              { icon: Plus, title: "Add file" },
              { icon: EmojiBtn, title: "Emoji", onClick: () => setShowEmojiPicker((v) => !v) },
              { icon: Gift, title: "Gift" },
              { icon: Sticker, title: "Stickers" },
            ].map(({ icon: Icon, title, onClick }, i) => (
              <button key={i} type="button" onClick={onClick} title={title}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[#949ba4] transition-colors hover:bg-white/10 hover:text-white">
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2 px-3 py-2.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e as unknown as React.FormEvent); }
              }}
              disabled={sending}
              maxLength={2000}
              placeholder={`Message #${channelName ?? "channel"}`}
              rows={1}
              className="min-h-[20px] max-h-32 flex-1 resize-none bg-transparent py-0.5 text-[14px] leading-relaxed text-white placeholder:text-[#6d6f78] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center gap-1">
              {draft.length > 1800 && <span className="font-mono text-[11px] text-[#6d6f78]">{2000 - draft.length}</span>}
              <button type="submit" disabled={!draft.trim() || sending}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5865F2] text-white transition-all hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-40">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Emoji button (inline SVG) ─────────────────────────────────────────────────
function EmojiBtn({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

// ── Main GuildChatSection ──────────────────────────────────────────────────────

export function GuildChatSection() {
  type Step = "guilds" | "channels" | "done";

  const [step, setStep] = useState<Step>("guilds");
  const [selectedGuild, setSelectedGuild] = useState<DiscordGuild | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<DiscordChannel | null>(null);
  const [showMemberList, setShowMemberList] = useState(true);

  const handleGuildSelect = (g: DiscordGuild) => {
    setSelectedGuild(g);
    setStep("channels");
  };

  const handleChannelSelect = (ch: DiscordChannel) => {
    setSelectedChannel(ch);
    setStep("done");
  };

  const handleDisconnect = async () => {
    if (!selectedGuild) return;
    await fetch(`/api/guild/chat/config?guildId=${selectedGuild.id}`, { method: "DELETE" }).catch(() => {});
    setSelectedChannel(null);
    setStep("channels");
  };

  if (step === "guilds") {
    return (
      <div className="flex h-[calc(100vh-6rem)] overflow-hidden rounded-2xl" style={{ background: "#0d0d12" }}>
        <GuildPicker onSelect={handleGuildSelect} error={null} loading={false} />
      </div>
    );
  }

  if (step === "channels") {
    return (
      <div className="flex h-[calc(100vh-6rem)] overflow-hidden rounded-2xl" style={{ background: "#0d0d12" }}>
        {selectedGuild && (
          <ChannelPicker guild={selectedGuild} onBack={() => setStep("guilds")} onSelect={handleChannelSelect} loading={false} error={null} />
        )}
      </div>
    );
  }

  // step === "done"
  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-0 overflow-hidden rounded-2xl" style={{ background: "#0d0d12" }}>
      {/* Server sidebar */}
      <aside className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden border-r border-black/40 py-3" style={{ background: "#1e1f22" }}>
        <div className="group relative">
          {selectedGuild?.icon ? (
            <img src={selectedGuild.icon} alt={selectedGuild.name}
              className="h-12 w-12 cursor-pointer rounded-[22px] object-cover transition-all duration-200 group-hover:rounded-[16px]" />
          ) : (
            <div className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-[22px] bg-[#5865F2] text-[16px] font-bold text-white transition-all duration-200 group-hover:rounded-[16px]">
              {selectedGuild ? initials(selectedGuild.name) : "?"}
            </div>
          )}
          <div className="absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-b-full bg-white/40" />
        </div>
        <div className="h-0.5 w-8 rounded-full bg-white/10" />
        <div className="group relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[22px] bg-[#313338] transition-all duration-200 group-hover:rounded-[16px] hover:bg-green-600">
          <Plus className="h-6 w-6 text-green-400 transition-transform duration-200 group-hover:scale-110" />
        </div>
        <div className="mt-auto mb-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-[14px] bg-[#313338]">
          <Crown className="h-5 w-5 text-amber-400" />
        </div>
      </aside>

      {/* Channel sidebar */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-black/30" style={{ background: "#1e1f22" }}>
        <div className="flex items-center justify-between border-b border-black/40 px-3 py-4">
          <span className="text-[15px] font-semibold text-white">{selectedGuild?.name}</span>
          <button onClick={handleDisconnect} className="text-[#949ba4] transition-colors hover:text-red-400" title="Disconnect">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {selectedChannel && (
            <div className="mb-3 flex items-center gap-2 rounded-md bg-white/[0.07] px-2 py-1.5 text-white">
              <Hash className="h-5 w-5 text-[#949ba4]" />
              <span className="flex-1 text-[14px] font-medium">{selectedChannel.name}</span>
              <CheckCircle2 className="h-4 w-4 text-green-400" />
            </div>
          )}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6d6f78]">Channels</div>
          {selectedChannel && (
            <div className="mt-1 flex items-center gap-2 rounded-md bg-white/[0.07] px-2 py-1.5 text-[14px] font-medium text-white">
              <Hash className="h-5 w-5 text-[#949ba4]" />
              {selectedChannel.name}
              <Check className="ml-auto h-3.5 w-3.5 text-green-400" />
            </div>
          )}
        </div>
        {/* User bar */}
        <div className="flex items-center gap-2 border-t border-black/40 px-2 py-2" style={{ background: "#232428" }}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5865F2] text-[11px] font-semibold text-white">RE</div>
          <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-white truncate">SkyUtils</div><div className="text-[11px] text-[#b5bac1]">Online</div></div>
          <Settings className="h-4 w-4 text-[#b5bac1]" />
        </div>
      </aside>

      {/* Main chat + members sidebar */}
      {selectedGuild && selectedChannel && (
        <>
          <ConnectedChat
            guildId={selectedGuild.id}
            channelId={selectedChannel.id}
            channelName={selectedChannel.name}
            onDisconnect={handleDisconnect}
          />
        </>
      )}
    </div>
  );
}
