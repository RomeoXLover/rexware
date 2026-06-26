import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  MessageSquare,
  Send,
  Zap,
  UserPlus,
  AlertCircle,
  Terminal,
  Activity,
  Filter,
  Search,
  Clock,
  Copy,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  Square,
  ExternalLink,
  Ban,
  Reply,
  CheckCircle,
  Loader2,
  Inbox,
  Server,
  Hash,
  User,
} from "lucide-react";
import { useT } from "@/lib/preferences";

type ActivityEvent = {
  id: string;
  type:
    | "dm_received"
    | "dm_sent"
    | "reply_sent"
    | "friend_request"
    | "friend_added"
    | "error"
    | "system"
    | "status_change"
    | "message_spam";
  timestamp: Date;
  userId?: string;
  username?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  status?: "success" | "error" | "pending";
};

type FilterType = "all" | "dms" | "replies" | "errors" | "system";
type TimeRange = "5m" | "15m" | "1h" | "all";
type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: string;
}

interface Stats {
  totalDms: number;
  messagesSent: number;
  repliesDelivered: number;
  errorsCount: number;
  uptime: number;
}

const AVATAR_COLORS = [
  "bg-emerald-500/20 text-emerald-300",
  "bg-blue-500/20 text-blue-300",
  "bg-purple-500/20 text-purple-300",
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-cyan-500/20 text-cyan-300",
  "bg-pink-500/20 text-pink-300",
  "bg-indigo-500/20 text-indigo-300",
];

const SIMULATED_USERNAMES = [
  "xDarkPhoenix",
  "ShadowNinja99",
  "CyberWolf_X",
  "MysticRaven",
  "NeonKnight",
  "GhostRider42",
  "DragonSlayer",
  "StarGazer_",
  "NightOwl_HD",
  "ThunderBolt7",
  "IceQueen_V",
  "FireStorm_XX",
  "CosmicRay_9",
  "PixelWarrior",
  "StealthMode",
];

const AUTOREPLY_TRIGGERS = [
  "hello",
  "hi",
  "hey",
  "help",
  "info",
  "commands",
  "price",
  "buy",
  "thanks",
  "thank you",
];

const AUTOREPLY_RESPONSES = [
  "Thanks for reaching out! Our bot is currently online and ready to help.",
  "Hey there! This is an automated response. Check our website for more info!",
  "Hello! Thanks for your message. We'll get back to you soon!",
  "Hi! Our discord bot is active 24/7. Need assistance? Just ask!",
  "Thanks for the message! Join our support server for immediate help.",
  "Hey! This account is managed by a bot. For human support, visit our website.",
  "Hello! Our automated system has received your message. Stay tuned!",
];

const BOT_LOG_MESSAGES: { level: LogLevel; messages: string[] }[] = [
  {
    level: "INFO",
    messages: [
      "Discord gateway connected successfully",
      "Bot is now online in 12 servers",
      "Successfully fetched DM channel history",
      "Auto-reply rule executed for user",
      "Heartbeat received from Discord gateway",
      "Message queue processed: 47 events",
      "Rate limiter: request quota at 72%",
      "Guild member cache refreshed",
      "Webhook endpoint configured",
      "Database connection pool: 5/20 active",
    ],
  },
  {
    level: "WARN",
    messages: [
      "Rate limit approaching for channel 8927341562",
      "Slow database query detected (>500ms)",
      "Memory usage at 78% - consider scaling",
      "Failed to fetch user avatar, using default",
      "Webhook delivery delayed by 1.2s",
      "Guild config not found, using defaults",
      "Message content flagged by filter",
      "Connection latency increased to 245ms",
    ],
  },
  {
    level: "ERROR",
    messages: [
      "Failed to send DM to user 123456789: Access Denied",
      "Discord API error 429: Rate limited",
      "Database connection timeout after 30s",
      "Invalid bot token configuration",
      "Failed to process message event",
      "Webhook delivery failed: Connection refused",
    ],
  },
  {
    level: "DEBUG",
    messages: [
      "Received dispatch: MESSAGE_CREATE",
      "Processing auto-reply for pattern: hello",
      "Checking rate limits for user 9876543210",
      "Cache hit for guild config: 2345678901",
      "Dispatching scheduled job: cleanup",
      "WebSocket frame received: 2.4KB",
      "Resolving user discriminator for username",
    ],
  },
];

function getAvatarColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getInitials(username: string): string {
  if (!username) return "?";
  return username.slice(0, 2).toUpperCase();
}

function formatTimeAgo(timestamp: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - timestamp.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatTime(timestamp: Date): string {
  return timestamp.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateRandomUser(): { userId: string; username: string } {
  const username = SIMULATED_USERNAMES[Math.floor(Math.random() * SIMULATED_USERNAMES.length)];
  const discriminator = Math.floor(Math.random() * 9999);
  const userId = `${Math.floor(Math.random() * 9000000000000000000)}`;
  return { userId, username: `${username}#${discriminator}` };
}

function generateRandomEvent(): ActivityEvent {
  const eventTypes: ActivityEvent["type"][] = [
    "dm_received",
    "dm_sent",
    "reply_sent",
    "friend_request",
    "friend_added",
    "error",
    "system",
    "status_change",
    "message_spam",
  ];

  const weights = [30, 25, 20, 10, 5, 8, 10, 15, 12];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  let eventType: ActivityEvent["type"] = "dm_received";

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      eventType = eventTypes[i];
      break;
    }
  }

  const { userId, username } = generateRandomUser();
  const event: ActivityEvent = {
    id: generateId(),
    type: eventType,
    timestamp: new Date(),
    userId,
    username,
    status: "success",
  };

  switch (eventType) {
    case "dm_received":
      event.content = AUTOREPLY_TRIGGERS[Math.floor(Math.random() * AUTOREPLY_TRIGGERS.length)];
      event.metadata = {
        channelId: `${Math.floor(Math.random() * 9000000000000000000)}`,
        hasAttachment: Math.random() > 0.7,
        replySent: Math.random() > 0.3,
      };
      break;

    case "dm_sent":
      event.content = AUTOREPLY_RESPONSES[Math.floor(Math.random() * AUTOREPLY_RESPONSES.length)];
      event.metadata = {
        channelId: `${Math.floor(Math.random() * 9000000000000000000)}`,
        deliveryStatus: "delivered",
      };
      break;

    case "reply_sent":
      event.content = `Trigger: "${AUTOREPLY_TRIGGERS[Math.floor(Math.random() * AUTOREPLY_TRIGGERS.length)]}"`;
      event.metadata = {
        replyText: AUTOREPLY_RESPONSES[Math.floor(Math.random() * AUTOREPLY_RESPONSES.length)],
        responseTime: `${(Math.random() * 2 + 0.1).toFixed(2)}s`,
      };
      break;

    case "friend_request":
      event.content = "Friend request sent";
      break;

    case "friend_added":
      event.content = "Friend added successfully";
      event.metadata = {
        mutualServers: Math.floor(Math.random() * 10) + 1,
      };
      break;

    case "error":
      event.status = "error";
      event.content = "Failed to send message";
      event.metadata = {
        errorCode: ["DISCORD_API_ERROR", "RATE_LIMITED", "ACCESS_DENIED", "TIMEOUT"][
          Math.floor(Math.random() * 4)
        ],
        errorMessage: "The user has blocked direct messages from server members",
      };
      break;

    case "system":
      event.content = [
        "Bot restarted successfully",
        "Configuration reloaded",
        "Plugin auto-save completed",
        "Scheduled maintenance check passed",
        "Cache cleared: 1,247 entries removed",
      ][Math.floor(Math.random() * 5)];
      break;

    case "status_change":
      event.content = [
        "Bot status updated to Online",
        "Auto-reply mode enabled",
        "DM logging activated",
        "Premium features unlocked",
      ][Math.floor(Math.random() * 4)];
      event.metadata = {
        oldStatus: ["Offline", "Idle", "DND"][Math.floor(Math.random() * 3)],
        newStatus: ["Online", "Idle", "DND"][Math.floor(Math.random() * 3)],
      };
      break;

    case "message_spam":
      event.content = "Bulk message campaign started";
      event.metadata = {
        serverId: `${Math.floor(Math.random() * 9000000000000000000)}`,
        serverName: ["Gaming Hub", "Tech Community", "Anime Central", "Music Lovers"][
          Math.floor(Math.random() * 4)
        ],
        channelId: `${Math.floor(Math.random() * 9000000000000000000)}`,
        targetCount: Math.floor(Math.random() * 50) + 10,
      };
      break;
  }

  return event;
}

function generateRandomLog(): LogEntry {
  const levelIndex = Math.floor(Math.random() * 100);
  let level: LogLevel;
  let messages: string[];

  if (levelIndex < 55) {
    level = "INFO";
    messages = BOT_LOG_MESSAGES[0].messages;
  } else if (levelIndex < 75) {
    level = "DEBUG";
    messages = BOT_LOG_MESSAGES[3].messages;
  } else if (levelIndex < 90) {
    level = "WARN";
    messages = BOT_LOG_MESSAGES[1].messages;
  } else {
    level = "ERROR";
    messages = BOT_LOG_MESSAGES[2].messages;
  }

  return {
    id: generateId(),
    timestamp: new Date(),
    level,
    message: messages[Math.floor(Math.random() * messages.length)],
    source: ["gateway", "api", "plugin", "scheduler", "cache"][Math.floor(Math.random() * 5)],
  };
}

interface EventIconProps {
  type: ActivityEvent["type"];
  className?: string;
}

function EventIcon({ type, className = "" }: EventIconProps) {
  const iconClass = `w-4 h-4 shrink-0 ${className}`;

  switch (type) {
    case "dm_received":
      return <MessageSquare className={iconClass} />;
    case "dm_sent":
      return <Send className={iconClass} />;
    case "reply_sent":
      return <Zap className={iconClass} />;
    case "friend_request":
      return <UserPlus className={iconClass} />;
    case "friend_added":
      return <User className={iconClass} />;
    case "error":
      return <AlertCircle className={iconClass} />;
    case "system":
      return <Terminal className={iconClass} />;
    case "status_change":
      return <Activity className={iconClass} />;
    case "message_spam":
      return <Send className={iconClass} />;
    default:
      return <MessageSquare className={iconClass} />;
  }
}

interface EventCardProps {
  event: ActivityEvent;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

function EventCard({ event, isExpanded, onToggle, onSelect }: EventCardProps) {
  const t = useT();
  const colorClass = getAvatarColor(event.userId || event.id);

  const typeLabels: Record<ActivityEvent["type"], string> = {
    dm_received: "DM Received",
    dm_sent: "DM Sent",
    reply_sent: "Auto-Reply",
    friend_request: "Friend Request",
    friend_added: "Friend Added",
    error: "Error",
    system: "System",
    status_change: "Status",
    message_spam: "Spam Campaign",
  };

  const typeColors: Record<ActivityEvent["type"], string> = {
    dm_received: "text-emerald-400",
    dm_sent: "text-blue-400",
    reply_sent: "text-cyan-400",
    friend_request: "text-amber-400",
    friend_added: "text-green-400",
    error: "text-red-400",
    system: "text-gray-400",
    status_change: "text-violet-400",
    message_spam: "text-purple-400",
  };

  return (
    <div
      className={`activity-event ${event.type}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${colorClass}`}
        >
          {getInitials(event.username || "UN")}
        </div>
        <EventIcon type={event.type} className={typeColors[event.type]} />
      </div>

      <div className="activity-content">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="activity-username">{event.username || "Unknown User"}</span>
          <span className={`r-badge r-badge-gray text-[10px] py-0 px-1.5`}>
            {typeLabels[event.type]}
          </span>
          {event.status === "error" && (
            <span className="r-badge r-badge-red text-[10px] py-0 px-1.5">Failed</span>
          )}
          {event.status === "pending" && (
            <span className="r-badge r-badge-yellow text-[10px] py-0 px-1.5">Pending</span>
          )}
        </div>

        <p className="activity-message">
          {event.content || "No message content"}
          {event.metadata?.responseTime && (
            <span className="ml-2 text-[10px] text-gray-500">
              Response: {String(event.metadata.responseTime)}
            </span>
          )}
        </p>

        {isExpanded && (
          <div className="mt-3 p-3 bg-[var(--nex-surface-2)] rounded-lg text-xs space-y-2">
            {event.userId && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--nex-muted)]">User ID:</span>
                <code className="text-[var(--nex-aqua)]">{event.userId}</code>
                <button
                  className="r-btn r-btn-ghost p-1 h-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(event.userId!);
                  }}
                  title="Copy user ID"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
            {event.metadata?.errorCode && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--nex-muted)]">Error Code:</span>
                <code className="text-red-400">{event.metadata.errorCode as string}</code>
              </div>
            )}
            {event.metadata?.errorMessage && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--nex-muted)]">Error Message:</span>
                <span className="text-red-300">{event.metadata.errorMessage as string}</span>
              </div>
            )}
            {event.metadata?.replyText && (
              <div className="mt-2 p-2 bg-[var(--nex-surface)] rounded border-l-2 border-cyan-500">
                <div className="text-[var(--nex-muted)] mb-1">Auto-Reply Sent:</div>
                <div className="text-[var(--nex-text)]">{event.metadata.replyText as string}</div>
              </div>
            )}
            {event.metadata?.mutualServers && (
              <div className="flex items-center gap-2">
                <Server className="w-3 h-3 text-[var(--nex-muted)]" />
                <span className="text-[var(--nex-muted)]">
                  {event.metadata.mutualServers as number} mutual servers
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-[var(--nex-muted)]">
              <Clock className="w-3 h-3" />
              <span>{event.timestamp.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <span className="activity-time">{formatTimeAgo(event.timestamp)}</span>
        {(event.content || event.metadata?.replyText) && (
          <button
            className="r-btn r-btn-ghost p-1 h-auto opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

interface StatsBarProps {
  stats: Stats;
  sparklineData: number[][];
}

function StatsBar({ stats, sparklineData }: StatsBarProps) {
  const t = useT();

  const statItems = [
    {
      label: "DMs Today",
      value: stats.totalDms,
      data: sparklineData[0],
      color: "bg-emerald-400",
    },
    {
      label: "Sent",
      value: stats.messagesSent,
      data: sparklineData[1],
      color: "bg-blue-400",
    },
    {
      label: "Replies",
      value: stats.repliesDelivered,
      data: sparklineData[2],
      color: "bg-cyan-400",
    },
    {
      label: "Errors",
      value: stats.errorsCount,
      data: sparklineData[3],
      color: "bg-red-400",
    },
  ];

  return (
    <div className="activity-stats">
      {statItems.map((item, index) => (
        <div key={index} className="activity-stat">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="activity-stat-value">{item.value.toLocaleString()}</span>
            <div className="activity-pulse" />
          </div>
          <div className="activity-stat-label">{item.label}</div>
          <div className="flex items-end justify-center gap-[2px] h-6 mt-1">
            {item.data.slice(-8).map((value, i) => (
              <div
                key={i}
                className={`w-2 rounded-sm ${item.color} transition-all`}
                style={{ height: `${Math.max(4, value * 3)}px`, opacity: 0.6 + i * 0.05 }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SearchFilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
}

function SearchFilterBar({
  searchQuery,
  onSearchChange,
  activeFilter,
  onFilterChange,
  timeRange,
  onTimeRangeChange,
}: SearchFilterBarProps) {
  const t = useT();

  const filters: { id: FilterType; label: string }[] = [
    { id: "all", label: "All" },
    { id: "dms", label: "DMs" },
    { id: "replies", label: "Replies" },
    { id: "errors", label: "Errors" },
    { id: "system", label: "System" },
  ];

  const timeRanges: { id: TimeRange; label: string }[] = [
    { id: "5m", label: "5m" },
    { id: "15m", label: "15m" },
    { id: "1h", label: "1h" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 p-3 border-b border-[var(--nex-border-soft)]">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--nex-muted)]" />
        <input
          type="text"
          placeholder="Search messages, users..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-[var(--nex-surface-2)] border border-[var(--nex-border-soft)] rounded-lg text-sm text-[var(--nex-text)] placeholder:text-[var(--nex-muted)] focus:outline-none focus:border-[var(--nex-aqua)] transition-colors"
        />
        {searchQuery && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2"
            onClick={() => onSearchChange("")}
          >
            <X className="w-4 h-4 text-[var(--nex-muted)] hover:text-[var(--nex-text)]" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 p-1 bg-[var(--nex-surface-2)] rounded-lg">
        {filters.map((filter) => (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeFilter === filter.id
                ? "bg-[var(--nex-aqua)] text-[#04181b]"
                : "text-[var(--nex-muted)] hover:text-[var(--nex-text)] hover:bg-[var(--nex-surface)]"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 p-1 bg-[var(--nex-surface-2)] rounded-lg">
        <Clock className="w-4 h-4 text-[var(--nex-muted)] ml-2 mr-1" />
        {timeRanges.map((range) => (
          <button
            key={range.id}
            onClick={() => onTimeRangeChange(range.id)}
            className={`px-2 py-1 rounded text-xs font-medium transition-all ${
              timeRange === range.id
                ? "bg-[var(--nex-aqua)] text-[#04181b]"
                : "text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
            }`}
          >
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface LogStreamProps {
  logs: LogEntry[];
  autoScroll: boolean;
  onAutoScrollToggle: () => void;
  onClear: () => void;
  onCopy: () => void;
  levelFilter: LogLevel | "all";
  onLevelFilterChange: (level: LogLevel | "all") => void;
}

function LogStream({
  logs,
  autoScroll,
  onAutoScrollToggle,
  onClear,
  onCopy,
  levelFilter,
  onLevelFilterChange,
}: LogStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const levels: (LogLevel | "all")[] = ["all", "INFO", "WARN", "ERROR", "DEBUG"];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b border-[var(--nex-border-soft)] bg-[var(--nex-surface)]">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--nex-muted)]" />
          <span className="text-sm font-medium text-[var(--nex-text)]">Log Stream</span>
          <span className="text-xs text-[var(--nex-muted)]">({logs.length} entries)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[var(--nex-surface-2)] rounded">
            {levels.map((level) => (
              <button
                key={level}
                onClick={() => onLevelFilterChange(level)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  levelFilter === level
                    ? level === "ERROR"
                      ? "bg-red-500/30 text-red-400"
                      : level === "WARN"
                        ? "bg-amber-500/30 text-amber-400"
                        : level === "INFO"
                          ? "bg-emerald-500/30 text-emerald-400"
                          : level === "DEBUG"
                            ? "bg-gray-500/30 text-gray-400"
                            : "bg-[var(--nex-aqua)] text-[#04181b]"
                    : "text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
                }`}
              >
                {level}
              </button>
            ))}
          </div>

          <button
            onClick={onAutoScrollToggle}
            className={`r-btn r-btn-ghost p-1.5 h-auto ${
              autoScroll ? "text-emerald-400" : "text-[var(--nex-muted)]"
            }`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            {autoScroll ? <Play className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          </button>

          <button
            onClick={onCopy}
            className="r-btn r-btn-ghost p-1.5 h-auto text-[var(--nex-muted)]"
            title="Copy logs"
          >
            <Copy className="w-4 h-4" />
          </button>

          <button
            onClick={onClear}
            className="r-btn r-btn-ghost p-1.5 h-auto text-[var(--nex-muted)]"
            title="Clear logs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3 bg-[var(--nex-bg)] font-mono text-[11px]"
      >
        {logs
          .filter((log) => levelFilter === "all" || log.level === levelFilter)
          .map((log) => (
            <div key={log.id} className={`log-line ${log.level}`}>
              <span className="log-timestamp">{formatTime(log.timestamp)}</span>
              <span className="log-level">[{log.level}]</span>
              {log.source && <span className="text-[var(--nex-muted)]">[{log.source}] </span>}
              <span>{log.message}</span>
            </div>
          ))}
        {logs.filter((log) => levelFilter === "all" || log.level === levelFilter).length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--nex-muted)]">
            <Terminal className="w-12 h-12 mb-3 opacity-30" />
            <p>No logs to display</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface MessageDetailModalProps {
  event: ActivityEvent | null;
  onClose: () => void;
  onReply?: (event: ActivityEvent) => void;
  onBlock?: (event: ActivityEvent) => void;
}

function MessageDetailModal({ event, onClose, onReply, onBlock }: MessageDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!event) return null;

  const handleCopyMessage = () => {
    if (event.content) {
      navigator.clipboard.writeText(event.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyUserId = () => {
    if (event.userId) {
      navigator.clipboard.writeText(event.userId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
        style={{ animation: "fadeIn 0.2s ease" }}
      />
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--nex-surface)] border-l border-[var(--nex-border-soft)] z-50 overflow-y-auto"
        style={{ animation: "slideInRight 0.3s ease" }}
      >
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-[var(--nex-border-soft)] bg-[var(--nex-surface)]">
          <h2 className="text-lg font-semibold text-[var(--nex-text)]">Message Details</h2>
          <button
            onClick={onClose}
            className="r-btn r-btn-ghost p-2 h-auto text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold ${getAvatarColor(
                event.userId || event.id
              )}`}
            >
              {getInitials(event.username || "UN")}
            </div>
            <div>
              <h3 className="text-xl font-bold text-[var(--nex-text)]">
                {event.username || "Unknown User"}
              </h3>
              <p className="text-sm text-[var(--nex-muted)]">Discord User</p>
              {event.userId && (
                <div className="flex items-center gap-1 mt-1">
                  <code className="text-xs text-[var(--nex-aqua)]">{event.userId}</code>
                  <button
                    onClick={handleCopyUserId}
                    className="text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="r-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-[var(--nex-text)]">Message Content</span>
              <button
                onClick={handleCopyMessage}
                className="r-btn r-btn-ghost p-1 h-auto text-[var(--nex-muted)]"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-sm text-[var(--nex-text)] whitespace-pre-wrap">
              {event.content || "No message content"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="r-card p-3">
              <div className="text-xs text-[var(--nex-muted)] mb-1">Type</div>
              <div className="text-sm font-medium text-[var(--nex-text)] capitalize">
                {event.type.replace(/_/g, " ")}
              </div>
            </div>
            <div className="r-card p-3">
              <div className="text-xs text-[var(--nex-muted)] mb-1">Status</div>
              <div
                className={`text-sm font-medium ${
                  event.status === "error"
                    ? "text-red-400"
                    : event.status === "pending"
                      ? "text-amber-400"
                      : "text-emerald-400"
                }`}
              >
                {event.status || "Success"}
              </div>
            </div>
            <div className="r-card p-3">
              <div className="text-xs text-[var(--nex-muted)] mb-1">Date</div>
              <div className="text-sm font-medium text-[var(--nex-text)]">
                {event.timestamp.toLocaleDateString()}
              </div>
            </div>
            <div className="r-card p-3">
              <div className="text-xs text-[var(--nex-muted)] mb-1">Time</div>
              <div className="text-sm font-medium text-[var(--nex-text)]">
                {event.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>

          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="r-card p-4">
              <h4 className="text-sm font-medium text-[var(--nex-text)] mb-3">Metadata</h4>
              <div className="space-y-2">
                {Object.entries(event.metadata).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs text-[var(--nex-muted)] capitalize">
                      {key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase())}:
                    </span>
                    <span className="text-xs text-[var(--nex-text)]">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {event.type === "dm_received" && onReply && (
              <button
                onClick={() => onReply(event)}
                className="r-btn r-btn-primary flex items-center justify-center gap-2"
              >
                <Reply className="w-4 h-4" />
                Send Reply
              </button>
            )}
            {onBlock && (
              <button
                onClick={() => onBlock(event)}
                className="r-btn r-btn-outline flex items-center justify-center gap-2 text-red-400 border-red-400/50 hover:bg-red-500/10"
              >
                <Ban className="w-4 h-4" />
                Block User
              </button>
            )}
            <button className="r-btn r-btn-ghost flex items-center justify-center gap-2">
              <ExternalLink className="w-4 h-4" />
              View Profile
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

interface EmptyStateProps {
  filter: FilterType;
  searchQuery: string;
}

function EmptyState({ filter, searchQuery }: EmptyStateProps) {
  const t = useT();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <div className="w-24 h-24 rounded-full bg-[var(--nex-surface-2)] flex items-center justify-center mb-6">
        <Inbox className="w-12 h-12 text-[var(--nex-muted)] opacity-50" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--nex-text)] mb-2">No activity yet</h3>
      <p className="text-sm text-[var(--nex-muted)] max-w-xs">
        {searchQuery
          ? `No results found for "${searchQuery}". Try adjusting your search.`
          : filter !== "all"
            ? `No ${filter} events recorded. Events will appear here as they happen.`
            : "Waiting for Discord activity. Events will appear here in real-time."}
      </p>
      <div className="flex items-center gap-2 mt-6">
        <div className="w-2 h-2 rounded-full bg-[var(--nex-aqua)] animate-pulse" />
        <span className="text-xs text-[var(--nex-muted)]">Listening for events...</span>
      </div>
    </div>
  );
}

export function LiveActivityFeed({
  pluginId = "discord-spam",
  runId = null,
  token,
}: {
  pluginId?: "discord-spam" | "discord-autoreply";
  runId?: string | null;
  token?: string;
}) {
  const t = useT();

  const [messages, setMessages] = useState<ActivityEvent[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalDms: 0,
    messagesSent: 0,
    repliesDelivered: 0,
    errorsCount: 0,
    uptime: 0,
  });
  const [sparklineData, setSparklineData] = useState<number[][]>([
    [5, 8, 3, 12, 7, 15, 10, 18, 14, 22],
    [3, 6, 9, 5, 11, 8, 14, 12, 19, 16],
    [2, 5, 8, 4, 9, 7, 12, 10, 15, 13],
    [0, 1, 0, 2, 1, 3, 1, 2, 4, 3],
  ]);

  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevel | "all">("all");
  const [activeTab, setActiveTab] = useState<"activity" | "logs">("activity");

  const containerRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef(Date.now());
  const eventIdCounterRef = useRef(0);
  const logIdCounterRef = useRef(0);

  const filteredMessages = useMemo(() => {
    let filtered = [...messages];

    if (filter !== "all") {
      switch (filter) {
        case "dms":
          filtered = filtered.filter(
            (m) => m.type === "dm_received" || m.type === "dm_sent" || m.type === "friend_request"
          );
          break;
        case "replies":
          filtered = filtered.filter(
            (m) => m.type === "reply_sent" || m.type === "message_spam"
          );
          break;
        case "errors":
          filtered = filtered.filter((m) => m.type === "error");
          break;
        case "system":
          filtered = filtered.filter(
            (m) => m.type === "system" || m.type === "status_change"
          );
          break;
      }
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.username?.toLowerCase().includes(query) ||
          m.content?.toLowerCase().includes(query) ||
          m.userId?.toLowerCase().includes(query)
      );
    }

    if (timeRange !== "all") {
      const now = Date.now();
      const ranges: Record<TimeRange, number> = {
        "5m": 5 * 60 * 1000,
        "15m": 15 * 60 * 1000,
        "1h": 60 * 60 * 1000,
        all: Infinity,
      };
      const cutoff = now - ranges[timeRange];
      filtered = filtered.filter((m) => m.timestamp.getTime() >= cutoff);
    }

    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [messages, filter, searchQuery, timeRange]);

  const groupedMessages = useMemo(() => {
    const groups: { label: string; messages: ActivityEvent[] }[] = [];
    const now = Date.now();

    const ranges = [
      { label: "Just now", maxAge: 60 * 1000 },
      { label: "1 min ago", maxAge: 2 * 60 * 1000 },
      { label: "5 min ago", maxAge: 10 * 60 * 1000 },
      { label: "15 min ago", maxAge: 30 * 60 * 1000 },
      { label: "1 hour ago", maxAge: 90 * 60 * 1000 },
      { label: "Earlier", maxAge: Infinity },
    ];

    for (const range of ranges) {
      const groupMessages = filteredMessages.filter((m) => {
        const age = now - m.timestamp.getTime();
        return age <= range.maxAge;
      });
      if (groupMessages.length > 0) {
        groups.push({ label: range.label, messages: groupMessages });
      }
    }

    return groups;
  }, [filteredMessages]);

  useEffect(() => {
    const initialMessages: ActivityEvent[] = [];
    for (let i = 0; i < 15; i++) {
      const event = generateRandomEvent();
      event.timestamp = new Date(Date.now() - Math.random() * 3600000);
      initialMessages.push(event);
      eventIdCounterRef.current++;
    }
    setMessages(initialMessages);

    const initialLogs: LogEntry[] = [];
    for (let i = 0; i < 50; i++) {
      const log = generateRandomLog();
      log.timestamp = new Date(Date.now() - Math.random() * 3600000);
      initialLogs.push(log);
      logIdCounterRef.current++;
    }
    setLogs(initialLogs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()));

    setStats({
      totalDms: Math.floor(Math.random() * 500) + 200,
      messagesSent: Math.floor(Math.random() * 300) + 100,
      repliesDelivered: Math.floor(Math.random() * 200) + 50,
      errorsCount: Math.floor(Math.random() * 10),
      uptime: Math.floor(Math.random() * 86400),
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const event = generateRandomEvent();
      eventIdCounterRef.current++;
      setMessages((prev) => [event, ...prev].slice(0, 500));

      setStats((prev) => {
        const newStats = { ...prev };
        switch (event.type) {
          case "dm_received":
            newStats.totalDms++;
            break;
          case "dm_sent":
          case "message_spam":
            newStats.messagesSent++;
            break;
          case "reply_sent":
            newStats.repliesDelivered++;
            break;
          case "error":
            newStats.errorsCount++;
            break;
        }
        newStats.uptime = Math.floor((Date.now() - startTimeRef.current) / 1000);
        return newStats;
      });

      setSparklineData((prev) =>
        prev.map((data, i) => {
          const newData = [...data.slice(1), Math.random() * 30];
          return newData;
        })
      );
    }, 2000 + Math.random() * 3000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const logInterval = setInterval(() => {
      const log = generateRandomLog();
      logIdCounterRef.current++;
      setLogs((prev) => [...prev, log].slice(-1000));
    }, 500 + Math.random() * 1500);

    return () => clearInterval(logInterval);
  }, []);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCopyLogs = useCallback(() => {
    const logText = logs
      .map((log) => `[${formatTime(log.timestamp)}] [${log.level}] ${log.message}`)
      .join("\n");
    navigator.clipboard.writeText(logText);
  }, [logs]);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const formatUptime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--nex-bg)]">
      <div className="activity-feed">
        <div className="flex items-center justify-between p-4 border-b border-[var(--nex-border-soft)] bg-[var(--nex-surface)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--nex-aqua)]" />
              <h2 className="text-lg font-semibold text-[var(--nex-text)]">Live Activity</h2>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-emerald-400 font-medium">Live</span>
              </div>
            </div>
            {pluginId && (
              <span className="r-badge r-badge-gray">
                {pluginId === "discord-autoreply" ? "Auto-Reply" : "Spam Filter"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-[var(--nex-muted)]">
              <Clock className="w-4 h-4" />
              <span>Uptime: {formatUptime(stats.uptime)}</span>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[var(--nex-surface-2)] rounded-lg">
              <button
                onClick={() => setActiveTab("activity")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === "activity"
                    ? "bg-[var(--nex-aqua)] text-[#04181b]"
                    : "text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Activity
              </button>
              <button
                onClick={() => setActiveTab("logs")}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeTab === "logs"
                    ? "bg-[var(--nex-aqua)] text-[#04181b]"
                    : "text-[var(--nex-muted)] hover:text-[var(--nex-text)]"
                }`}
              >
                <Terminal className="w-3.5 h-3.5" />
                Logs
              </button>
            </div>
          </div>
        </div>

        {activeTab === "activity" && <StatsBar stats={stats} sparklineData={sparklineData} />}

        {activeTab === "activity" && (
          <SearchFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            activeFilter={filter}
            onFilterChange={setFilter}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        )}

        {activeTab === "activity" ? (
          <div
            ref={containerRef}
            className="flex-1 overflow-y-auto"
            style={{ scrollBehavior: "smooth" }}
          >
            {groupedMessages.length > 0 ? (
              groupedMessages.map((group, groupIndex) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-[var(--nex-surface)] border-b border-[var(--nex-border-soft)]">
                    <span className="text-xs font-medium text-[var(--nex-muted)]">
                      {group.label}
                    </span>
                    <span className="text-xs text-[var(--nex-muted)]">
                      ({group.messages.length})
                    </span>
                  </div>
                  {group.messages.map((event, index) => (
                    <div
                      key={event.id}
                      style={{
                        animationDelay: `${(groupIndex * group.messages.length + index) * 50}ms`,
                      }}
                      className="group"
                    >
                      <EventCard
                        event={event}
                        isExpanded={expandedIds.has(event.id)}
                        onToggle={() => handleToggleExpand(event.id)}
                        onSelect={() => setSelectedEvent(event)}
                      />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <EmptyState filter={filter} searchQuery={searchQuery} />
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden">
            <LogStream
              logs={logs}
              autoScroll={autoScroll}
              onAutoScrollToggle={() => setAutoScroll(!autoScroll)}
              onClear={handleClearLogs}
              onCopy={handleCopyLogs}
              levelFilter={logLevelFilter}
              onLevelFilterChange={setLogLevelFilter}
            />
          </div>
        )}
      </div>

      <MessageDetailModal
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onReply={(event) => {
          console.log("Reply to:", event);
        }}
        onBlock={(event) => {
          console.log("Block user:", event.userId);
        }}
      />
    </div>
  );
}
