import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Command,
  Copy,
  ExternalLink,
  Filter,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import {
  getMyBots,
  startBot,
  stopBot,
  updateBot,
  type PublicBot,
  type BotRunRow,
} from "@/lib/api/bots.client";
import { useT } from "@/lib/preferences";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BotWithRun = PublicBot;

interface BotFormState {
  name: string;
  mcUsername: string;
  serverHost: string;
  serverPort: string;
  mcVersion: string;
  authMode: "offline" | "microsoft" | "ssid";
  message: string;
  reply: string;
  replyActions: string[];
  triggerKeyword: string;
  webhookUrl: string;
  messageInterval: string;
  replyDelay: string;
  replyCooldown: string;
  afkInterval: string;
  reconnectDelay: string;
  inactivityTimeout: string;
}

interface TabInfo {
  botId: string;
  bot: BotWithRun;
}

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info" | "accent";
}

interface ActionHistoryEntry {
  id: string;
  action: string;
  timestamp: Date;
  success: boolean;
}

interface ConsoleLine {
  id: number;
  text: string;
  level: "info" | "warn" | "error" | "debug" | "system";
}

type BotTabSection = "overview" | "config" | "console" | "actions";

interface TabbedBotManagerProps {
  open: boolean;
  onClose: () => void;
  initialBots?: PublicBot[];
  maxBots?: number;
  onDeployed?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLive(bot: BotWithRun): boolean {
  return !!bot.run && ["running", "starting", "pending"].includes(bot.run.status);
}

function formatUptime(_run: BotRunRow): string {
  // Uptime tracking would require the run's started_at field
  // For now, show a placeholder based on run status
  return "—";
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function formFromBot(bot: PublicBot): BotFormState {
  const numStr = (n: number | null | undefined) =>
    n == null ? "" : String(n);
  return {
    name: bot.name,
    mcUsername: bot.mcUsername ?? "",
    serverHost: bot.server_host,
    serverPort: String(bot.server_port ?? 25565),
    mcVersion: bot.mc_version ?? "1.21.1",
    authMode: (bot.auth_mode as "offline" | "microsoft" | "ssid") ?? "offline",
    message: bot.message ?? "",
    reply: (bot.reply ?? []).join("\n"),
    replyActions: bot.reply_actions ?? [],
    triggerKeyword: bot.trigger_keyword ?? "",
    webhookUrl: bot.webhook_url ?? "",
    messageInterval: numStr(bot.message_interval),
    replyDelay: numStr(bot.reply_delay),
    replyCooldown: numStr(bot.reply_cooldown),
    afkInterval: numStr(bot.afk_interval),
    reconnectDelay: numStr(bot.reconnect_delay),
    inactivityTimeout: numStr(bot.inactivity_timeout),
  };
}

function getLogLevel(text: string): ConsoleLine["level"] {
  const lower = text.toLowerCase();
  if (text.includes("[system]")) return "system";
  if (lower.includes("error") || lower.includes("exception") || lower.includes("failed")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("debug")) return "debug";
  return "info";
}

// ---------------------------------------------------------------------------
// Status Dot Component
// ---------------------------------------------------------------------------

function StatusDot({ bot, size = 8 }: { bot: BotWithRun; size?: number }) {
  const live = isLive(bot);
  const error = bot.run?.status === "error";

  const dotColor = live
    ? "var(--nex-aqua)"
    : error
      ? "#f87171"
      : "rgba(161,161,170,0.4)";

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: dotColor,
        display: "inline-block",
        animation: live ? "pulse 2s ease-in-out infinite" : undefined,
        boxShadow: live ? `0 0 6px ${dotColor}` : undefined,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Toast Component
// ---------------------------------------------------------------------------

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const bgMap = {
    success: "rgba(34,197,94,0.15)",
    error: "rgba(239,68,68,0.15)",
    info: "var(--nex-surface)",
    accent: "var(--nex-aqua-dim)",
  };

  const borderMap = {
    success: "rgba(34,197,94,0.3)",
    error: "rgba(239,68,68,0.3)",
    info: "var(--nex-border-soft)",
    accent: "var(--nex-aqua)",
  };

  const colorMap = {
    success: "#86efac",
    error: "#fca5a5",
    info: "var(--nex-text)",
    accent: "var(--nex-aqua)",
  };

  return (
    <div
      className="toast"
      style={{
        background: bgMap[toast.type],
        border: `1px solid ${borderMap[toast.type]}`,
        color: colorMap[toast.type],
      }}
    >
      {toast.type === "success" && <CheckCircle2 size={16} />}
      {toast.type === "error" && <AlertCircle size={16} />}
      {toast.type === "info" && <Bot size={16} />}
      {toast.type === "accent" && <Zap size={16} />}
      <span>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        style={{
          marginLeft: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          opacity: 0.7,
          color: "inherit",
          padding: 2,
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Console Component
// ---------------------------------------------------------------------------

function LiveConsoleView({
  runId,
  filter,
  autoScroll,
  onAutoScrollChange,
}: {
  runId: string | null;
  filter: string;
  autoScroll: boolean;
  onAutoScrollChange: (v: boolean) => void;
}) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [logLevels, setLogLevels] = useState<Set<string>>(new Set(["info", "warn", "error", "debug", "system"]));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    if (!runId) {
      setLines([]);
      setConnected(false);
      return;
    }
    setLines([]);
    setConnected(false);
    lineIdRef.current = 0;

    const es = new EventSource(
      `/api/runner/stream?runId=${encodeURIComponent(runId)}`,
    );

    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("log", (e) => {
      try {
        const { line } = JSON.parse((e as MessageEvent).data);
        if (typeof line === "string") {
          const clean = stripAnsi(line);
          setLines((prev) => [
            ...prev.slice(-999),
            { id: lineIdRef.current++, text: clean, level: getLogLevel(clean) },
          ]);
        }
      } catch {
        // ignore malformed
      }
    });
    es.addEventListener("info", (e) => {
      try {
        const { message } = JSON.parse((e as MessageEvent).data);
        if (message) {
          setLines((prev) => [
            ...prev.slice(-999),
            { id: lineIdRef.current++, text: `[system] ${message}`, level: "system" },
          ]);
        }
      } catch {
        // ignore
      }
    });
    es.addEventListener("end", () => {
      setConnected(false);
      es.close();
    });
    es.onerror = () => {
      setConnected(false);
    };

    return () => es.close();
  }, [runId]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const filteredLines = useMemo(() => {
    return lines.filter((line) => {
      if (!logLevels.has(line.level)) return false;
      if (filter && !line.text.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });
  }, [lines, filter, logLevels]);

  const toggleLevel = (level: string) => {
    setLogLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const copyAll = () => {
    const text = filteredLines.map((l) => l.text).join("\n");
    void navigator.clipboard.writeText(text);
  };

  const clearConsole = () => {
    setLines([]);
    lineIdRef.current = 0;
  };

  const levelColors: Record<string, string> = {
    info: "var(--nex-text)",
    warn: "#fbbf24",
    error: "#f87171",
    debug: "var(--nex-muted)",
    system: "var(--nex-aqua)",
  };

  return (
    <div className="r-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          borderBottom: "1px solid var(--nex-border-soft)",
          padding: "10px 16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Terminal className="h-3.5 w-3.5" style={{ color: "var(--nex-muted)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--nex-text)" }}>
            Console Output
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: connected ? "var(--nex-aqua)" : "var(--nex-muted)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: connected ? "var(--nex-aqua)" : "rgba(161,161,170,0.4)",
              }}
            />
            {connected ? "Streaming" : runId ? "Connecting..." : "Offline"}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(["info", "warn", "error", "debug"] as const).map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${levelColors[level]}`,
                background: logLevels.has(level) ? `${levelColors[level]}22` : "transparent",
                color: levelColors[level],
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--nex-border-soft)",
          background: "var(--nex-bg)",
        }}
      >
        <Filter size={14} style={{ color: "var(--nex-muted)" }} />
        <input
          type="text"
          placeholder="Filter logs..."
          value={filter}
          onChange={(e) => {/* handled by parent */}}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            color: "var(--nex-text)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={() => onAutoScrollChange(!autoScroll)}
          style={{
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 4,
            border: "1px solid var(--nex-border-soft)",
            background: autoScroll ? "var(--nex-aqua-dim)" : "transparent",
            color: autoScroll ? "var(--nex-aqua)" : "var(--nex-muted)",
            cursor: "pointer",
          }}
        >
          Auto-scroll
        </button>
        <button
          onClick={copyAll}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--nex-muted)",
            padding: 4,
          }}
          title="Copy all"
        >
          <Copy size={14} />
        </button>
        <button
          onClick={clearConsole}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--nex-muted)",
            padding: 4,
          }}
          title="Clear"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div
        ref={scrollRef}
        style={{
          height: 400,
          overflowY: "auto",
          background: "var(--nex-bg)",
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          lineHeight: 1.6,
        }}
      >
        {filteredLines.length === 0 ? (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--nex-muted)",
              fontSize: 12,
            }}
          >
            {runId ? "Waiting for output..." : "Bot is not running"}
          </div>
        ) : (
          filteredLines.map((line) => (
            <div
              key={line.id}
              style={{
                padding: "2px 16px",
                color: levelColors[line.level],
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bot Card Component
// ---------------------------------------------------------------------------

function BotCard({
  bot,
  onOpenTab,
  onStart,
  onStop,
  busy,
}: {
  bot: BotWithRun;
  onOpenTab: () => void;
  onStart: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const live = isLive(bot);

  return (
    <div
      className="r-card"
      style={{
        cursor: "pointer",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onClick={onOpenTab}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "var(--nex-aqua-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Bot size={20} style={{ color: "var(--nex-aqua)" }} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--nex-text)" }}>
              {bot.name}
            </h4>
            <span style={{ fontSize: 12, color: "var(--nex-muted)" }}>
              {bot.mcUsername || "—"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot run={bot.run} />
          <span style={{ fontSize: 11, color: "var(--nex-muted)", textTransform: "capitalize" }}>
            {bot.run?.status || "idle"}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: "var(--nex-muted)", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <Activity size={12} />
          <span>{bot.server_host}:{bot.server_port}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Command size={12} />
          <span>v{bot.mc_version || "?"}</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {live ? (
          <button
            className="r-btn r-btn-outline"
            style={{ flex: 1, fontSize: 12, padding: "6px 12px" }}
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            disabled={busy}
          >
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button
            className="r-btn r-btn-primary"
            style={{ flex: 1, fontSize: 12, padding: "6px 12px" }}
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
            disabled={busy}
          >
            <Play size={14} />
            Start
          </button>
        )}
        <button
          className="r-btn r-btn-ghost"
          style={{ fontSize: 12, padding: "6px 10px" }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenTab();
          }}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab Content
// ---------------------------------------------------------------------------

function OverviewTab({
  bot,
  onStart,
  onStop,
  busy,
}: {
  bot: BotWithRun;
  onStart: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const [uptime, setUptime] = useState(formatUptime(bot.run));

  useEffect(() => {
    if (!isLive(bot)) return;
    // Update uptime display periodically
    const interval = setInterval(() => {
      setUptime(bot.run);
    }, 1000);
    return () => clearInterval(interval);
  }, [bot.run]);

  const live = isLive(bot);
  const hasError = bot.run?.status === "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div
        className="r-card"
        style={{
          background: live ? "var(--nex-aqua-dim)" : hasError ? "rgba(239,68,68,0.1)" : "var(--nex-surface-2)",
          borderColor: live ? "var(--nex-aqua)" : hasError ? "#f87171" : "var(--nex-border-soft)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: live ? "var(--nex-aqua)" : "var(--nex-surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: live ? "0 0 20px var(--nex-aqua-glow)" : undefined,
            }}
          >
            <Bot size={28} style={{ color: live ? "var(--nex-bg)" : "var(--nex-muted)" }} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--nex-text)" }}>
              {bot.name}
            </h3>
            <span style={{ fontSize: 14, color: "var(--nex-muted)" }}>
              {bot.mcUsername || "Offline Mode"}
            </span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <StatusDot run={bot.run} size={12} />
            <span style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize", color: "var(--nex-text)" }}>
              {bot.run?.status || "idle"}
            </span>
          </div>
        </div>

        {hasError && bot.run?.error && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.15)",
              borderRadius: 8,
              marginBottom: 16,
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <AlertCircle size={16} style={{ color: "#f87171" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#f87171" }}>Error</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "#fca5a5" }}>{bot.run.error}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--nex-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Server
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--nex-text)" }}>
              {bot.server_host}:{bot.server_port}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--nex-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Version
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--nex-text)" }}>
              {bot.mc_version || "?"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--nex-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Uptime
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--nex-aqua)" }}>
              {uptime}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {live ? (
            <>
              <button
                className="r-btn r-btn-outline"
                style={{ flex: 1 }}
                onClick={onStop}
                disabled={busy}
              >
                <Square size={16} />
                Stop Bot
              </button>
              <button
                className="r-btn r-btn-ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  onStop();
                  setTimeout(onStart, 500);
                }}
                disabled={busy}
              >
                <RotateCcw size={16} />
                Restart
              </button>
            </>
          ) : (
            <button
              className="r-btn r-btn-primary"
              style={{ flex: 1 }}
              onClick={onStart}
              disabled={busy}
            >
              <Play size={16} />
              Start Bot
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        <div className="r-card" style={{ textAlign: "center" }}>
          <MessageSquare size={20} style={{ color: "var(--nex-aqua)", marginBottom: 8 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--nex-text)" }}>0</div>
          <div style={{ fontSize: 11, color: "var(--nex-muted)" }}>Messages</div>
        </div>
        <div className="r-card" style={{ textAlign: "center" }}>
          <Zap size={20} style={{ color: "var(--nex-aqua)", marginBottom: 8 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--nex-text)" }}>0</div>
          <div style={{ fontSize: 11, color: "var(--nex-muted)" }}>Replies</div>
        </div>
        <div className="r-card" style={{ textAlign: "center" }}>
          <AlertCircle size={20} style={{ color: hasError ? "#f87171" : "var(--nex-muted)", marginBottom: 8 }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: hasError ? "#f87171" : "var(--nex-text)" }}>0</div>
          <div style={{ fontSize: 11, color: "var(--nex-muted)" }}>Errors</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config Tab Content
// ---------------------------------------------------------------------------

function ConfigTab({
  bot,
  onSave,
  saving,
}: {
  bot: BotWithRun;
  onSave: (config: Partial<PublicBot>) => Promise<void>;
  saving: boolean;
}) {
  const [form, setForm] = useState<BotFormState>(() => formFromBot(bot));
  const [hasChanges, setHasChanges] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const handleChange = (field: keyof BotFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    await onSave({
      name: form.name,
      server_host: form.serverHost,
      server_port: parseInt(form.serverPort) || 25565,
      mc_version: form.mcVersion,
      auth_mode: form.authMode,
      message: form.message || undefined,
      reply: form.reply ? form.reply.split("\n").filter(Boolean) : [],
      reply_actions: form.replyActions,
      trigger_keyword: form.triggerKeyword || undefined,
      webhook_url: form.webhookUrl || undefined,
      message_interval: form.messageInterval ? parseInt(form.messageInterval) : undefined,
      reply_delay: form.replyDelay ? parseInt(form.replyDelay) : undefined,
      reply_cooldown: form.replyCooldown ? parseInt(form.replyCooldown) : undefined,
      afk_interval: form.afkInterval ? parseInt(form.afkInterval) : undefined,
      reconnect_delay: form.reconnectDelay ? parseInt(form.reconnectDelay) : undefined,
      inactivity_timeout: form.inactivityTimeout ? parseInt(form.inactivityTimeout) : undefined,
    });
    setHasChanges(false);
    setLastSaved(new Date());
  };

  const resetToDefaults = () => {
    setForm(formFromBot({
      ...bot,
      message: "888 to join unstableSMP",
      reply: ["add me on dc to join - untualab"],
      trigger_keyword: "888",
      message_interval: 30,
      reply_delay: 5,
      reply_cooldown: 30,
      afk_interval: 20,
      reconnect_delay: 60,
      inactivity_timeout: 300,
    }));
    setHasChanges(true);
  };

  const exportConfig = () => {
    const config = {
      name: form.name,
      serverHost: form.serverHost,
      serverPort: form.serverPort,
      mcVersion: form.mcVersion,
      authMode: form.authMode,
      message: form.message,
      reply: form.reply.split("\n").filter(Boolean),
      triggerKeyword: form.triggerKeyword,
      webhookUrl: form.webhookUrl,
      messageInterval: form.messageInterval,
      replyDelay: form.replyDelay,
      replyCooldown: form.replyCooldown,
      afkInterval: form.afkInterval,
      reconnectDelay: form.reconnectDelay,
      inactivityTimeout: form.inactivityTimeout,
    };
    void navigator.clipboard.writeText(JSON.stringify(config, null, 2));
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "var(--nex-bg)",
    border: "1px solid var(--nex-border-soft)",
    borderRadius: 8,
    color: "var(--nex-text)",
    fontSize: 13,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--nex-muted)",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Settings2 size={16} style={{ color: "var(--nex-muted)" }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Bot Configuration</span>
          {lastSaved && (
            <span style={{ fontSize: 11, color: "var(--nex-muted)" }}>
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="r-btn r-btn-ghost" onClick={exportConfig}>
            <Copy size={14} />
            Export
          </button>
          <button className="r-btn r-btn-ghost" onClick={resetToDefaults}>
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </div>

      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Server Settings
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          <div>
            <label style={labelStyle}>Bot Name</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Minecraft Username</label>
            <input
              style={inputStyle}
              value={form.mcUsername}
              onChange={(e) => handleChange("mcUsername", e.target.value)}
              placeholder="For offline mode"
            />
          </div>
          <div>
            <label style={labelStyle}>Server Host</label>
            <input
              style={inputStyle}
              value={form.serverHost}
              onChange={(e) => handleChange("serverHost", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Server Port</label>
            <input
              style={inputStyle}
              type="number"
              value={form.serverPort}
              onChange={(e) => handleChange("serverPort", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>MC Version</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={form.mcVersion}
              onChange={(e) => handleChange("mcVersion", e.target.value)}
            >
              <option value="1.21.4">1.21.4</option>
              <option value="1.21.1">1.21.1</option>
              <option value="1.20.6">1.20.6</option>
              <option value="1.20.4">1.20.4</option>
              <option value="1.20.1">1.20.1</option>
              <option value="1.19.4">1.19.4</option>
              <option value="1.18.2">1.18.2</option>
              <option value="1.16.5">1.16.5</option>
              <option value="1.12.2">1.12.2</option>
              <option value="1.8.9">1.8.9</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Auth Mode</label>
            <select
              style={{ ...inputStyle, cursor: "pointer" }}
              value={form.authMode}
              onChange={(e) => handleChange("authMode", e.target.value as "offline" | "microsoft" | "ssid")}
            >
              <option value="offline">Offline (Cracked)</option>
              <option value="microsoft">Microsoft</option>
              <option value="ssid">SSID</option>
            </select>
          </div>
        </div>
      </div>

      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Messaging
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Message (sent periodically)</label>
            <input
              style={inputStyle}
              value={form.message}
              onChange={(e) => handleChange("message", e.target.value)}
              placeholder="e.g. 888 to join"
            />
          </div>
          <div>
            <label style={labelStyle}>Reply Messages (one per line)</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={form.reply}
              onChange={(e) => handleChange("reply", e.target.value)}
              placeholder="One reply per line"
            />
          </div>
          <div>
            <label style={labelStyle}>Trigger Keyword</label>
            <input
              style={inputStyle}
              value={form.triggerKeyword}
              onChange={(e) => handleChange("triggerKeyword", e.target.value)}
              placeholder="e.g. 888"
            />
          </div>
          <div>
            <label style={labelStyle}>Webhook URL</label>
            <input
              style={inputStyle}
              value={form.webhookUrl}
              onChange={(e) => handleChange("webhookUrl", e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
            />
          </div>
        </div>
      </div>

      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Timing
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          <div>
            <label style={labelStyle}>Message Interval (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.messageInterval}
              onChange={(e) => handleChange("messageInterval", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Reply Delay (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.replyDelay}
              onChange={(e) => handleChange("replyDelay", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Reply Cooldown (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.replyCooldown}
              onChange={(e) => handleChange("replyCooldown", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>AFK Interval (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.afkInterval}
              onChange={(e) => handleChange("afkInterval", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Reconnect Delay (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.reconnectDelay}
              onChange={(e) => handleChange("reconnectDelay", e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle}>Inactivity Timeout (s)</label>
            <input
              style={inputStyle}
              type="number"
              value={form.inactivityTimeout}
              onChange={(e) => handleChange("inactivityTimeout", e.target.value)}
            />
          </div>
        </div>
      </div>

      <button
        className="r-btn r-btn-primary"
        disabled={!hasChanges || saving}
        onClick={handleSave}
        style={{ alignSelf: "flex-end" }}
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
        Save Changes
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions Tab Content
// ---------------------------------------------------------------------------

function ActionsTab({
  bot,
}: {
  bot: BotWithRun;
}) {
  const [actionHistory, setActionHistory] = useState<ActionHistoryEntry[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const [testMessage, setTestMessage] = useState("");

  const replyActions = bot.reply_actions ?? [];

  const executeAction = async (action: string) => {
    setExecuting(action);
    const entry: ActionHistoryEntry = {
      id: generateId(),
      action,
      timestamp: new Date(),
      success: true,
    };
    setActionHistory((prev) => [entry, ...prev.slice(0, 9)]);
    setTimeout(() => setExecuting(null), 500);
  };

  const testWebhook = async () => {
    if (!bot.webhook_url) return;
    setExecuting("webhook");
    try {
      await fetch(bot.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Test message from RexWare Bot" }),
      });
      const entry: ActionHistoryEntry = {
        id: generateId(),
        action: "Webhook Test",
        timestamp: new Date(),
        success: true,
      };
      setActionHistory((prev) => [entry, ...prev.slice(0, 9)]);
    } catch {
      const entry: ActionHistoryEntry = {
        id: generateId(),
        action: "Webhook Test",
        timestamp: new Date(),
        success: false,
      };
      setActionHistory((prev) => [entry, ...prev.slice(0, 9)]);
    }
    setExecuting(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Available Actions
        </h4>
        {replyActions.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--nex-muted)" }}>
            No reply actions configured for this bot.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {replyActions.map((action, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  background: "var(--nex-bg)",
                  borderRadius: 8,
                  border: "1px solid var(--nex-border-soft)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Zap size={16} style={{ color: "var(--nex-aqua)" }} />
                  <span style={{ fontSize: 13, color: "var(--nex-text)" }}>{action}</span>
                </div>
                <button
                  className="r-btn r-btn-outline"
                  style={{ fontSize: 12 }}
                  onClick={() => executeAction(action)}
                  disabled={executing === action}
                >
                  {executing === action ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Execute
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Webhook Test
        </h4>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            style={{
              flex: 1,
              padding: "10px 12px",
              background: "var(--nex-bg)",
              border: "1px solid var(--nex-border-soft)",
              borderRadius: 8,
              color: "var(--nex-text)",
              fontSize: 13,
              outline: "none",
            }}
            value={bot.webhook_url || ""}
            disabled
            placeholder="No webhook configured"
          />
          <button
            className="r-btn r-btn-outline"
            onClick={testWebhook}
            disabled={!bot.webhook_url || executing === "webhook"}
          >
            <Send size={14} />
            Test
          </button>
        </div>
      </div>

      <div className="r-card">
        <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
          Test Reply
        </h4>
        <div style={{ display: "flex", gap: 12 }}>
          <input
            style={{
              flex: 1,
              padding: "10px 12px",
              background: "var(--nex-bg)",
              border: "1px solid var(--nex-border-soft)",
              borderRadius: 8,
              color: "var(--nex-text)",
              fontSize: 13,
              outline: "none",
            }}
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
            placeholder="Simulate a trigger message..."
          />
          <button className="r-btn r-btn-outline" disabled={!testMessage}>
            <MessageSquare size={14} />
            Simulate
          </button>
        </div>
      </div>

      {actionHistory.length > 0 && (
        <div className="r-card">
          <h4 style={{ margin: "0 0 16px 0", fontSize: 13, fontWeight: 600, color: "var(--nex-text)" }}>
            Action History
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {actionHistory.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "var(--nex-bg)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {entry.success ? (
                    <CheckCircle2 size={14} style={{ color: "#86efac" }} />
                  ) : (
                    <AlertCircle size={14} style={{ color: "#f87171" }} />
                  )}
                  <span style={{ color: "var(--nex-text)" }}>{entry.action}</span>
                </div>
                <span style={{ color: "var(--nex-muted)" }}>
                  {entry.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TabbedBotManager Component
// ---------------------------------------------------------------------------

export function TabbedBotManager({
  open,
  onClose,
  maxBots = 8,
  onDeployed,
}: TabbedBotManagerProps) {
  const t = useT();
  const [bots, setBots] = useState<BotWithRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTabs, setOpenTabs] = useState<TabInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string>("grid");
  const [toastQueue, setToastQueue] = useState<Toast[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [consoleFilter, setConsoleFilter] = useState("");
  const [consoleAutoScroll, setConsoleAutoScroll] = useState(true);
  const [botSections, setBotSections] = useState<Record<string, BotTabSection>>({});

  const activeBot = useMemo(() => {
    if (activeTab === "grid") return null;
    return openTabs.find((tab) => tab.botId === activeTab)?.bot ?? null;
  }, [activeTab, openTabs]);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const toast: Toast = { id: generateId(), message, type };
    setToastQueue((prev) => [...prev.slice(-2), toast]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToastQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  async function refresh() {
    try {
      const res = await getMyBots();
      setBots(res.bots as BotWithRun[]);
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const pollId = setInterval(() => {
      if (bots.some((b) => isLive(b))) {
        void refresh();
      }
    }, 5000);
    return () => clearInterval(pollId);
  }, [open, bots]);

  const openBotTab = (bot: BotWithRun) => {
    if (openTabs.some((tab) => tab.botId === bot.id)) {
      setActiveTab(bot.id);
      return;
    }
    if (openTabs.length >= maxBots) {
      addToast(`Maximum ${maxBots} tabs allowed`, "error");
      return;
    }
    setOpenTabs((prev) => [...prev, { botId: bot.id, bot }]);
    setActiveTab(bot.id);
    setBotSections((prev) => ({ ...prev, [bot.id]: "overview" }));
  };

  const closeBotTab = (botId: string) => {
    setOpenTabs((prev) => prev.filter((tab) => tab.botId !== botId));
    if (activeTab === botId) {
      const remaining = openTabs.filter((tab) => tab.botId !== botId);
      setActiveTab(remaining.length > 0 ? remaining[remaining.length - 1].botId : "grid");
    }
  };

  const handleStart = async (bot: BotWithRun) => {
    setBusyId(bot.id);
    try {
      await startBot({ data: { id: bot.id } });
      await refresh();
      addToast(`${bot.name} started`, "success");
      if (activeTab === bot.id) {
        setOpenTabs((prev) =>
          prev.map((tab) =>
            tab.botId === bot.id ? { ...tab, bot: bots.find((b) => b.id === bot.id) ?? tab.bot } : tab
          )
        );
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to start bot", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleStop = async (bot: BotWithRun) => {
    setBusyId(bot.id);
    try {
      await stopBot({ data: { id: bot.id } });
      await refresh();
      addToast(`${bot.name} stopped`, "info");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to stop bot", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveConfig = async (botId: string, config: Partial<PublicBot>) => {
    setSavingId(botId);
    try {
      await updateBot({ data: { ...config, id: botId } });
      await refresh();
      addToast("Configuration saved", "accent");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to save config", "error");
    } finally {
      setSavingId(null);
    }
  };

  const startAll = async () => {
    const stopped = bots.filter((b) => !isLive(b));
    for (const bot of stopped) {
      await handleStart(bot);
    }
    if (stopped.length === 0) {
      addToast("All bots are already running", "info");
    }
  };

  const stopAll = async () => {
    const running = bots.filter((b) => isLive(b));
    for (const bot of running) {
      await handleStop(bot);
    }
    if (running.length === 0) {
      addToast("No bots are currently running", "info");
    }
  };

  const runningCount = useMemo(() => bots.filter((b) => isLive(b)).length, [bots]);

  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="bot-manager-overlay" onClick={onClose}>
        <div className="bot-manager-modal" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="bot-manager-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Bot size={20} style={{ color: "var(--nex-aqua)" }} />
              <span style={{ fontSize: 16, fontWeight: 600, color: "var(--nex-text)" }}>
                Bot Manager
              </span>
            </div>

            <div className="bot-manager-tabs">
              <button
                className={`bot-tab ${activeTab === "grid" ? "bot-tab-active" : ""}`}
                onClick={() => setActiveTab("grid")}
              >
                <span>All Bots</span>
                <span
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    borderRadius: 10,
                    background: "var(--nex-aqua-dim)",
                    color: "var(--nex-aqua)",
                  }}
                >
                  {bots.length}
                </span>
              </button>

              {openTabs.map((tab) => (
                <button
                  key={tab.botId}
                  className={`bot-tab ${activeTab === tab.botId ? "bot-tab-active" : ""}`}
                  onClick={() => setActiveTab(tab.botId)}
                >
                  <StatusDot run={tab.bot.run} size={6} />
                  <span>{tab.bot.name}</span>
                  <span
                    className="bot-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeBotTab(tab.botId);
                    }}
                  >
                    <X size={12} />
                  </span>
                </button>
              ))}

              {openTabs.length < maxBots && (
                <button
                  className="bot-tab"
                  style={{ color: "var(--nex-aqua)" }}
                  onClick={() => {
                    onClose();
                    onDeployed?.();
                  }}
                >
                  <Plus size={14} />
                  <span>Deploy</span>
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--nex-muted)",
                padding: 8,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="bot-manager-content">
            {loading ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 300,
                  gap: 12,
                  color: "var(--nex-muted)",
                }}
              >
                <Loader2 size={20} className="animate-spin" />
                <span>Loading bots...</span>
              </div>
            ) : activeTab === "grid" ? (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 16,
                    marginBottom: 24,
                  }}
                >
                  {bots.map((bot) => (
                    <BotCard
                      key={bot.id}
                      bot={bot}
                      onOpenTab={() => openBotTab(bot)}
                      onStart={() => handleStart(bot)}
                      onStop={() => handleStop(bot)}
                      busy={busyId === bot.id}
                    />
                  ))}

                  {bots.length < maxBots && (
                    <div
                      className="r-card"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 180,
                        cursor: "pointer",
                        border: "2px dashed var(--nex-border-soft)",
                        background: "transparent",
                        gap: 12,
                      }}
                      onClick={() => {
                        onClose();
                        onDeployed?.();
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          background: "var(--nex-aqua-dim)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Plus size={24} style={{ color: "var(--nex-aqua)" }} />
                      </div>
                      <span style={{ fontSize: 14, color: "var(--nex-muted)" }}>
                        Deploy New Bot
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : activeBot ? (
              <div>
                {/* Tab sections */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginBottom: 20,
                    borderBottom: "1px solid var(--nex-border-soft)",
                    paddingBottom: 12,
                  }}
                >
                  {(["overview", "config", "console", "actions"] as const).map((section) => (
                    <button
                      key={section}
                      onClick={() => setBotSections((prev) => ({ ...prev, [activeBot.id]: section }))}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 8,
                        border: "none",
                        background:
                          botSections[activeBot.id] === section
                            ? "var(--nex-aqua-dim)"
                            : "transparent",
                        color:
                          botSections[activeBot.id] === section
                            ? "var(--nex-aqua)"
                            : "var(--nex-muted)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {section === "overview" && <Activity size={14} />}
                      {section === "config" && <Settings2 size={14} />}
                      {section === "console" && <Terminal size={14} />}
                      {section === "actions" && <Zap size={14} />}
                      {section.charAt(0).toUpperCase() + section.slice(1)}
                    </button>
                  ))}
                </div>

                {botSections[activeBot.id] === "overview" && (
                  <OverviewTab
                    bot={activeBot}
                    onStart={() => handleStart(activeBot)}
                    onStop={() => handleStop(activeBot)}
                    busy={busyId === activeBot.id}
                  />
                )}

                {botSections[activeBot.id] === "config" && (
                  <ConfigTab
                    bot={activeBot}
                    onSave={(config) => handleSaveConfig(activeBot.id, config)}
                    saving={savingId === activeBot.id}
                  />
                )}

                {botSections[activeBot.id] === "console" && (
                  <LiveConsoleView
                    runId={activeBot.run?.id ?? null}
                    filter={consoleFilter}
                    autoScroll={consoleAutoScroll}
                    onAutoScrollChange={setConsoleAutoScroll}
                  />
                )}

                {botSections[activeBot.id] === "actions" && (
                  <ActionsTab bot={activeBot} />
                )}
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 300,
                  color: "var(--nex-muted)",
                }}
              >
                Bot not found
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bot-manager-footer">
            <button
              className="r-btn r-btn-primary"
              onClick={startAll}
              disabled={busyId !== null}
            >
              <Play size={14} />
              Start All
            </button>
            <button
              className="r-btn r-btn-outline"
              onClick={stopAll}
              disabled={busyId !== null}
            >
              <Square size={14} />
              Stop All
            </button>

            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 24,
                fontSize: 12,
                color: "var(--nex-muted)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <StatusDot run={{ status: runningCount > 0 ? "running" : "stopped", id: "", error: null, started_at: null }} size={8} />
                {runningCount} running
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Clock size={12} />
                Total: {bots.length} bot{bots.length !== 1 ? "s" : ""}
              </span>
            </div>

            <button
              className="r-btn r-btn-outline"
              onClick={() => {
                onClose();
                onDeployed?.();
              }}
              style={{ marginLeft: "auto" }}
            >
              <Plus size={14} />
              Deploy New
            </button>
          </div>
        </div>
      </div>

      {/* Toast container */}
      <div className="toast-container">
        {toastQueue.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </>
  );
}
