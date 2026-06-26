import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Bell,
  Bot,
  ChevronRight,
  Clock,
  Copy,
  CornerDownLeft,
  CreditCard,
  Globe,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Moon,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  Square,
  Star,
  Sun,
  Ticket,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useT } from "@/lib/preferences";
import type { PublicBot } from "@/lib/api/bots.functions";
import { startBot, stopBot } from "@/lib/api/bots.functions";

// ============================================================================
// Types
// ============================================================================

interface Command {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: React.ReactNode;
  iconColor?: string;
  shortcut?: string[];
  action: () => void;
  botId?: string;
}

type CommandCategory =
  | "Navigation"
  | "Bot Actions"
  | "Quick Actions"
  | "Plugin Actions"
  | "Recent";

interface CommandPaletteProps {
  bots?: (PublicBot & { run?: { status: string } | null })[];
  onRefresh?: () => void;
  isAdmin?: boolean;
  onNavigate?: (section: string) => void;
  onClose?: () => void;
  open?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const CATEGORY_ORDER: CommandCategory[] = [
  "Recent",
  "Navigation",
  "Bot Actions",
  "Quick Actions",
  "Plugin Actions",
];

const CATEGORY_ICONS: Record<CommandCategory, React.ReactNode> = {
  Navigation: <LayoutDashboard className="h-3.5 w-3.5" />,
  "Bot Actions": <Bot className="h-3.5 w-3.5" />,
  "Quick Actions": <Zap className="h-3.5 w-3.5" />,
  "Plugin Actions": <Settings className="h-3.5 w-3.5" />,
  Recent: <Clock className="h-3.5 w-3.5" />,
};

const RECENT_COMMANDS_KEY = "skyutils_recent_commands";
const MAX_RECENT = 5;

// ============================================================================
// Utility Functions
// ============================================================================

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="cmd-highlight">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function fuzzyMatch(text: string, query: string): boolean {
  if (!query.trim()) return true;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  return lowerText.includes(lowerQuery);
}

function getRecentCommands(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_COMMANDS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentCommand(commandId: string): void {
  if (typeof window === "undefined") return;
  try {
    const recent = getRecentCommands().filter((id) => id !== commandId);
    recent.unshift(commandId);
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {
    // Silently fail
  }
}

function clearRecentCommands(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RECENT_COMMANDS_KEY);
}

// ============================================================================
// Bot Status Widget Component
// ============================================================================

interface BotStatusWidgetProps {
  bots: (PublicBot & { run?: { status: string } | null })[];
  onStartBot: (id: string) => void;
  onStopBot: (id: string) => void;
}

function BotStatusWidget({ bots, onStartBot, onStopBot }: BotStatusWidgetProps) {
  const runningBots = bots.filter((b) => b.run?.status === "running" || b.run?.status === "starting");
  const displayBots = runningBots.slice(0, 3);

  if (bots.length === 0) {
    return (
      <div className="cmd-bot-widget">
        <div className="cmd-bot-widget-header">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">No bots deployed</span>
        </div>
      </div>
    );
  }

  return (
    <div className="cmd-bot-widget">
      <div className="cmd-bot-widget-header">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-foreground">
            {runningBots.length} bot{runningBots.length !== 1 ? "s" : ""} running
          </span>
        </div>
        <div className="flex items-center gap-1">
          {displayBots.map((bot) => (
            <button
              key={bot.id}
              onClick={() =>
                bot.run?.status === "running" ? onStopBot(bot.id) : onStartBot(bot.id)
              }
              className="cmd-bot-dot group"
              title={`${bot.name} - ${bot.run?.status || "stopped"}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  bot.run?.status === "running" || bot.run?.status === "starting"
                    ? "bg-emerald-400 group-hover:bg-red-400"
                    : "bg-muted-foreground/40 group-hover:bg-emerald-400"
                }`}
              />
            </button>
          ))}
          {runningBots.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{runningBots.length - 3}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Command Item Component
// ============================================================================

interface CommandItemProps {
  command: Command;
  isActive: boolean;
  searchQuery: string;
  onSelect: () => void;
  onHover: () => void;
}

function CommandItemComponent({
  command,
  isActive,
  searchQuery,
  onSelect,
  onHover,
}: CommandItemProps) {
  return (
    <button
      className={`cmd-item ${isActive ? "cmd-active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      type="button"
    >
      <div
        className="cmd-item-icon"
        style={command.iconColor ? { color: command.iconColor } : undefined}
      >
        {command.icon}
      </div>
      <div className="cmd-item-content">
        <span className="cmd-item-label">
          {highlightMatch(command.label, searchQuery)}
        </span>
        {command.description && (
          <span className="cmd-item-description">
            {highlightMatch(command.description, searchQuery)}
          </span>
        )}
      </div>
      <div className="cmd-item-meta">
        {command.shortcut && command.shortcut.length > 0 && (
          <div className="cmd-item-shortcut">
            {command.shortcut.map((key, i) => (
              <kbd key={i} className="cmd-kbd">
                {key}
              </kbd>
            ))}
          </div>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 cmd-item-arrow" />
      </div>
    </button>
  );
}

// ============================================================================
// Category Header Component
// ============================================================================

interface CategoryHeaderProps {
  category: CommandCategory;
  count?: number;
}

function CategoryHeader({ category, count }: CategoryHeaderProps) {
  return (
    <div className="cmd-section-header">
      <div className="cmd-section-icon">{CATEGORY_ICONS[category]}</div>
      <span className="cmd-section-label">{category}</span>
      {count !== undefined && (
        <span className="cmd-section-count">{count}</span>
      )}
    </div>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

interface EmptyStateProps {
  query: string;
}

function EmptyState({ query }: EmptyStateProps) {
  return (
    <div className="cmd-empty">
      <Search className="h-10 w-10 text-muted-foreground/30" />
      <div className="cmd-empty-text">
        <p className="cmd-empty-title">No results found</p>
        <p className="cmd-empty-subtitle">
          No commands match "<span className="font-medium">{query}</span>"
        </p>
      </div>
      <div className="cmd-empty-hint">
        <span>Try searching for</span>
        <button className="cmd-empty-suggestion">navigation</button>
        <span>or</span>
        <button className="cmd-empty-suggestion">bot actions</button>
      </div>
    </div>
  );
}

// ============================================================================
// Footer Component
// ============================================================================

interface FooterProps {
  activeIndex: number;
  totalCount: number;
}

function Footer({ activeIndex, totalCount }: FooterProps) {
  return (
    <div className="cmd-footer">
      <div className="cmd-footer-item">
        <kbd className="cmd-kbd cmd-kbd-sm">↑</kbd>
        <kbd className="cmd-kbd cmd-kbd-sm">↓</kbd>
        <span>Navigate</span>
      </div>
      <div className="cmd-footer-item">
        <kbd className="cmd-kbd cmd-kbd-sm">↵</kbd>
        <span>Select</span>
      </div>
      <div className="cmd-footer-item">
        <kbd className="cmd-kbd cmd-kbd-sm">esc</kbd>
        <span>Close</span>
      </div>
      <div className="cmd-footer-spacer" />
      <span className="cmd-footer-count">
        {activeIndex + 1} / {totalCount}
      </span>
    </div>
  );
}

// ============================================================================
// Main CommandPalette Component
// ============================================================================

export function CommandPalette({ bots = [], onRefresh, isAdmin = false, onNavigate, onClose, open: controlledOpen }: CommandPaletteProps) {
  const t = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isPaletteOpen = isControlled ? controlledOpen : isOpen;

  function closePalette() {
    if (isControlled) {
      onClose?.();
    } else {
      setIsOpen(false);
    }
  }
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const [loadingBotId, setLoadingBotId] = useState<string | null>(null);

  // Load recent commands from localStorage
  useEffect(() => {
    setRecentCommands(getRecentCommands());
  }, []);

  // Global keyboard listener for Ctrl+K / Cmd+K
  useEffect(() => {
    if (isControlled) return; // Don't add duplicate listener in controlled mode
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isControlled]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isPaletteOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
      setActiveIndex(0);
    }
  }, [isPaletteOpen]);

  // Close on route change
  useEffect(() => {
    const unsubscribe = router.history.subscribe(() => {
      closePalette();
    });
    return unsubscribe;
  }, [router]);

  // ============================================================================
  // Bot Actions
  // ============================================================================

  const handleStartBot = useCallback(
    async (botId: string) => {
      setLoadingBotId(botId);
      setIsOpen(false);
      try {
        await startBot({ data: { id: botId } });
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to start bot");
      } finally {
        setLoadingBotId(null);
      }
    },
    [onRefresh]
  );

  const handleStopBot = useCallback(
    async (botId: string) => {
      setLoadingBotId(botId);
      setIsOpen(false);
      try {
        await stopBot({ data: { id: botId } });
        onRefresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Failed to stop bot");
      } finally {
        setLoadingBotId(null);
      }
    },
    [onRefresh]
  );

  // ============================================================================
  // Navigation Functions
  // ============================================================================

  const navigateTo = useCallback(
    (section: string) => {
      if (onNavigate) {
        onNavigate(section);
      } else {
        router.navigate({ to: "/dash", search: { section } });
      }
      closePalette();
    },
    [onNavigate, router]
  );

  const executeCommand = useCallback(
    (command: Command) => {
      saveRecentCommand(command.id);
      setRecentCommands(getRecentCommands());
      command.action();
    },
    []
  );

  // ============================================================================
  // Command Definitions
  // ============================================================================

  const allCommands = useMemo<Command[]>(() => {
    const navCommands: Command[] = [
      {
        id: "nav-dashboard",
        label: "Go to Dashboard",
        category: "Navigation",
        icon: <LayoutDashboard className="h-4 w-4" />,
        iconColor: "#8b5cf6",
        shortcut: ["G", "D"],
        action: () => navigateTo("dashboard"),
      },
      {
        id: "nav-bots",
        label: "Go to Bots",
        category: "Navigation",
        icon: <Bot className="h-4 w-4" />,
        iconColor: "#10b981",
        shortcut: ["G", "B"],
        action: () => navigateTo("bots"),
      },
      {
        id: "nav-purchase",
        label: "Go to Purchase",
        category: "Navigation",
        icon: <CreditCard className="h-4 w-4" />,
        iconColor: "#f59e0b",
        action: () => navigateTo("purchase"),
      },
      {
        id: "nav-billing",
        label: "Go to Billing",
        category: "Navigation",
        icon: <CreditCard className="h-4 w-4" />,
        iconColor: "#6366f1",
        action: () => navigateTo("billing"),
      },
      {
        id: "nav-proxies",
        label: "Go to Proxies",
        category: "Navigation",
        icon: <Globe className="h-4 w-4" />,
        iconColor: "#06b6d4",
        action: () => navigateTo("proxies"),
      },
      {
        id: "nav-tickets",
        label: "Go to Tickets",
        category: "Navigation",
        icon: <Ticket className="h-4 w-4" />,
        iconColor: "#ec4899",
        action: () => navigateTo("tickets"),
      },
      {
        id: "nav-referrals",
        label: "Go to Referrals",
        category: "Navigation",
        icon: <Users className="h-4 w-4" />,
        iconColor: "#8b5cf6",
        action: () => navigateTo("referrals"),
      },
      {
        id: "nav-chat",
        label: "Go to Chat",
        category: "Navigation",
        icon: <MessageSquare className="h-4 w-4" />,
        iconColor: "#3b82f6",
        action: () => navigateTo("chat"),
      },
      {
        id: "nav-discord-spam",
        label: "Go to Discord Spam",
        category: "Navigation",
        icon: <Send className="h-4 w-4" />,
        iconColor: "#5865f2",
        action: () => navigateTo("discord-spam"),
      },
      {
        id: "nav-discord-autoreply",
        label: "Go to Discord AutoReply",
        category: "Navigation",
        icon: <MessageSquare className="h-4 w-4" />,
        iconColor: "#22c55e",
        action: () => navigateTo("discord-autoreply"),
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        category: "Navigation",
        icon: <Settings className="h-4 w-4" />,
        iconColor: "#94a3b8",
        shortcut: ["G", "S"],
        action: () => navigateTo("settings"),
      },
    ];

    if (isAdmin) {
      navCommands.push({
        id: "nav-admin",
        label: "Go to Admin",
        category: "Navigation",
        icon: <Lock className="h-4 w-4" />,
        iconColor: "#ef4444",
        action: () => navigateTo("admin"),
      });
    }

    const botActionCommands: Command[] = [
      {
        id: "bot-deploy",
        label: "Deploy New Bot",
        description: "Create and deploy a new bot instance",
        category: "Bot Actions",
        icon: <Plus className="h-4 w-4" />,
        iconColor: "#10b981",
        shortcut: ["C", "N"],
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "bots", deploy: true } });
        },
      },
      {
        id: "bot-stop-all",
        label: "Stop All Bots",
        description: "Immediately stop all running bot instances",
        category: "Bot Actions",
        icon: <Square className="h-4 w-4" />,
        iconColor: "#ef4444",
        action: async () => {
          setIsOpen(false);
          const runningBots = bots.filter(
            (b) => b.run?.status === "running" || b.run?.status === "starting"
          );
          for (const bot of runningBots) {
            try {
              await stopBot({ data: { id: bot.id } });
            } catch {
              // Continue with other bots
            }
          }
          onRefresh();
        },
      },
      {
        id: "bot-start-all",
        label: "Start All Bots",
        description: "Resume all stopped bot instances",
        category: "Bot Actions",
        icon: <Play className="h-4 w-4" />,
        iconColor: "#22c55e",
        action: async () => {
          setIsOpen(false);
          const stoppedBots = bots.filter(
            (b) => b.run?.status !== "running" && b.run?.status !== "starting"
          );
          for (const bot of stoppedBots) {
            try {
              await startBot({ data: { id: bot.id } });
            } catch {
              // Continue with other bots
            }
          }
          onRefresh();
        },
      },
      {
        id: "bot-logs",
        label: "View Bot Logs",
        description: "View real-time logs from all bots",
        category: "Bot Actions",
        icon: <Activity className="h-4 w-4" />,
        iconColor: "#8b5cf6",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "bots", logs: true } });
        },
      },
      {
        id: "bot-presets",
        label: "Manage Bot Presets",
        description: "Save and load bot configurations",
        category: "Bot Actions",
        icon: <Star className="h-4 w-4" />,
        iconColor: "#f59e0b",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "bots", presets: true } });
        },
      },
    ];

    const quickActionCommands: Command[] = [
      {
        id: "quick-buy-hours",
        label: "Buy Bot Hours",
        description: "Purchase additional bot runtime hours",
        category: "Quick Actions",
        icon: <CreditCard className="h-4 w-4" />,
        iconColor: "#f59e0b",
        shortcut: ["C", "H"],
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "purchase" } });
        },
      },
      {
        id: "quick-ticket",
        label: "Create Support Ticket",
        description: "Open a new support request",
        category: "Quick Actions",
        icon: <Ticket className="h-4 w-4" />,
        iconColor: "#ec4899",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "tickets", new: true } });
        },
      },
      {
        id: "quick-copy-referral",
        label: "Copy Referral Code",
        description: "Copy your referral link to clipboard",
        category: "Quick Actions",
        icon: <Copy className="h-4 w-4" />,
        iconColor: "#8b5cf6",
        action: () => {
          setIsOpen(false);
          navigator.clipboard.writeText(window.location.origin + "?ref=me");
        },
      },
      {
        id: "quick-toggle-theme",
        label: "Toggle Dark/Light Theme",
        description: "Switch between dark and light modes",
        category: "Quick Actions",
        icon: <Sun className="h-4 w-4" />,
        iconColor: "#fbbf24",
        action: () => {
          const html = document.documentElement;
          const isDark = html.classList.contains("dark");
          html.classList.toggle("dark", !isDark);
          html.classList.toggle("light", isDark);
          localStorage.setItem("mf_prefs_v1", JSON.stringify({
            theme: isDark ? "light" : "dark"
          }));
        },
      },
      {
        id: "quick-notifications",
        label: "Open Notifications",
        description: "View recent notifications and alerts",
        category: "Quick Actions",
        icon: <Bell className="h-4 w-4" />,
        iconColor: "#ef4444",
        shortcut: ["N"],
        action: () => {
          setIsOpen(false);
          document.dispatchEvent(new CustomEvent("open-notifications"));
        },
      },
    ];

    const pluginActionCommands: Command[] = [
      {
        id: "plugin-discord-spam-start",
        label: "Start Discord Spam",
        description: "Activate the Discord mass messaging plugin",
        category: "Plugin Actions",
        icon: <Send className="h-4 w-4" />,
        iconColor: "#5865f2",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "discord-spam", start: true } });
        },
      },
      {
        id: "plugin-discord-spam-stop",
        label: "Stop Discord Spam",
        description: "Deactivate the Discord mass messaging plugin",
        category: "Plugin Actions",
        icon: <Square className="h-4 w-4" />,
        iconColor: "#ef4444",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "discord-spam", stop: true } });
        },
      },
      {
        id: "plugin-autoreply-start",
        label: "Start AutoReply",
        description: "Activate the Discord auto-reply plugin",
        category: "Plugin Actions",
        icon: <MessageSquare className="h-4 w-4" />,
        iconColor: "#22c55e",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "discord-autoreply", start: true } });
        },
      },
      {
        id: "plugin-autoreply-stop",
        label: "Stop AutoReply",
        description: "Deactivate the Discord auto-reply plugin",
        category: "Plugin Actions",
        icon: <Square className="h-4 w-4" />,
        iconColor: "#ef4444",
        action: () => {
          setIsOpen(false);
          router.navigate({ to: "/dash", search: { section: "discord-autoreply", stop: true } });
        },
      },
    ];

    // Add individual bot commands
    const botCommands: Command[] = bots.map((bot) => ({
      id: `bot-${bot.id}`,
      label: bot.name,
      description: `Bot instance • ${bot.run?.status || "stopped"}`,
      category: "Bot Actions" as CommandCategory,
      icon: <Bot className="h-4 w-4" />,
      iconColor: bot.run?.status === "running" || bot.run?.status === "starting" ? "#10b981" : "#94a3b8",
      shortcut: bot.name.length <= 3 ? [bot.name.toUpperCase()] : undefined,
      action: () =>
        bot.run?.status === "running" || bot.run?.status === "starting"
          ? handleStopBot(bot.id)
          : handleStartBot(bot.id),
      botId: bot.id,
    }));

    return [
      ...navCommands,
      ...botActionCommands,
      ...quickActionCommands,
      ...pluginActionCommands,
      ...botCommands,
    ];
  }, [bots, isAdmin, navigateTo, handleStartBot, handleStopBot, onRefresh, router]);

  // ============================================================================
  // Filtered Commands
  // ============================================================================

  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) {
      // When no search, show recent commands first, then all by category
      const recentCmds = allCommands.filter((cmd) => recentCommands.includes(cmd.id));
      const otherCmds = allCommands.filter((cmd) => !recentCommands.includes(cmd.id));
      return { recent: recentCmds, commands: [...recentCmds, ...otherCmds] };
    }

    const query = searchQuery.toLowerCase();
    const matched = allCommands.filter(
      (cmd) =>
        fuzzyMatch(cmd.label, query) ||
        fuzzyMatch(cmd.description || "", query) ||
        fuzzyMatch(cmd.category, query)
    );

    return { recent: [], commands: matched };
  }, [allCommands, searchQuery, recentCommands]);

  // Flatten filtered commands for navigation
  const flatCommands = useMemo(() => {
    const result: Command[] = [];

    // Add recent commands section if there are recent commands and no search
    if (filteredCommands.recent.length > 0 && !searchQuery.trim()) {
      result.push(...filteredCommands.recent);
    }

    // Add all other filtered commands
    const otherCommands = filteredCommands.commands.filter(
      (cmd) => !filteredCommands.recent.includes(cmd)
    );
    result.push(...otherCommands);

    return result;
  }, [filteredCommands, searchQuery]);

  // Group commands by category for display
  const groupedCommands = useMemo(() => {
    const groups: Record<CommandCategory, Command[]> = {
      Navigation: [],
      "Bot Actions": [],
      "Quick Actions": [],
      "Plugin Actions": [],
      Recent: [],
    };

    // If searching, don't show category groups, show flat list
    if (searchQuery.trim()) {
      return null;
    }

    for (const cmd of flatCommands) {
      if (groups[cmd.category]) {
        groups[cmd.category].push(cmd);
      }
    }

    return groups;
  }, [flatCommands, searchQuery]);

  // ============================================================================
  // Keyboard Navigation
  // ============================================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + 1, flatCommands.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (flatCommands[activeIndex]) {
            executeCommand(flatCommands[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [flatCommands, activeIndex, executeCommand]
  );

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeElement = listRef.current.querySelector(".cmd-active");
      activeElement?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // ============================================================================
  // Render
  // ============================================================================

  // When controlled (used inside dashboard), don't show the trigger button
  if (!isPaletteOpen) {
    if (isControlled) return null;
    return (
      <>
        {/* Trigger Button */}
        <button
          onClick={() => setIsOpen(true)}
          className="cmd-trigger"
          title="Command palette (Ctrl+K)"
        >
          <Search className="h-4 w-4" />
          <span className="cmd-trigger-text">Quick actions</span>
          <kbd className="cmd-trigger-kbd">
            <span>⌘</span>K
          </kbd>
        </button>
      </>
    );
  }

  const paletteContent = (
    <div className="cmd-overlay" onClick={() => setIsOpen(false)}>
      <div
        className="cmd-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search Input */}
        <div className="cmd-search">
          <Search className="h-5 w-5 text-muted-foreground cmd-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-search-input"
            placeholder="Search commands, bots, settings..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setActiveIndex(0);
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {searchQuery && (
            <button
              className="cmd-clear-btn"
              onClick={() => {
                setSearchQuery("");
                inputRef.current?.focus();
              }}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="cmd-esc-hint">esc</kbd>
        </div>

        {/* Bot Status Widget */}
        <BotStatusWidget
          bots={bots}
          onStartBot={handleStartBot}
          onStopBot={handleStopBot}
        />

        {/* Command List */}
        <div className="cmd-results" ref={listRef}>
          {flatCommands.length === 0 ? (
            <EmptyState query={searchQuery} />
          ) : searchQuery.trim() ? (
            // Flat search results
            <div className="cmd-list">
              {flatCommands.map((command, index) => (
                <CommandItemComponent
                  key={command.id}
                  command={command}
                  isActive={index === activeIndex}
                  searchQuery={searchQuery}
                  onSelect={() => executeCommand(command)}
                  onHover={() => setActiveIndex(index)}
                />
              ))}
            </div>
          ) : (
            // Grouped by category
            <div className="cmd-grouped-list">
              {CATEGORY_ORDER.filter(
                (cat) => groupedCommands && groupedCommands[cat].length > 0
              ).map((category) => (
                <div key={category} className="cmd-group">
                  <CategoryHeader
                    category={category}
                    count={groupedCommands?.[category]?.length}
                  />
                  <div className="cmd-list">
                    {groupedCommands?.[category]?.map((command, index) => {
                      const globalIndex = flatCommands.indexOf(command);
                      return (
                        <CommandItemComponent
                          key={command.id}
                          command={command}
                          isActive={globalIndex === activeIndex}
                          searchQuery={searchQuery}
                          onSelect={() => executeCommand(command)}
                          onHover={() => setActiveIndex(globalIndex)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Clear Recent Button */}
              {recentCommands.length > 0 && (
                <button
                  className="cmd-clear-recent"
                  onClick={() => {
                    clearRecentCommands();
                    setRecentCommands([]);
                  }}
                  type="button"
                >
                  <X className="h-3 w-3" />
                  Clear recent commands
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <Footer activeIndex={activeIndex} totalCount={flatCommands.length} />
      </div>
    </div>
  );

  // Use portal to render at document body level
  return createPortal(paletteContent, document.body);
}

// ============================================================================
// Styles (injected via CSS module or global styles)
// ============================================================================

const styles = `
.cmd-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--muted-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cmd-trigger:hover {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-foreground);
}

.cmd-trigger-text {
  display: none;
}

@media (min-width: 640px) {
  .cmd-trigger-text {
    display: inline;
  }
}

.cmd-trigger-kbd {
  display: none;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  background: var(--muted);
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
}

@media (min-width: 768px) {
  .cmd-trigger-kbd {
    display: flex;
  }
}

.cmd-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: oklch(0 0 0 / 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
  animation: fadeIn 0.15s ease;
}

.cmd-modal {
  width: 100%;
  max-width: 580px;
  max-height: 70vh;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px oklch(0 0 0 / 0.5), 0 0 60px oklch(0 0 0 / 0.3);
  overflow: hidden;
  animation: slideUp 0.2s cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  flex-direction: column;
}

.cmd-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.cmd-search-icon {
  flex-shrink: 0;
  color: var(--muted-foreground);
}

.cmd-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: 16px;
  color: var(--foreground);
}

.cmd-search-input::placeholder {
  color: var(--muted-foreground);
}

.cmd-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: var(--muted);
  border: none;
  border-radius: 6px;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: all 0.15s ease;
}

.cmd-clear-btn:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}

.cmd-esc-hint {
  padding: 4px 8px;
  background: var(--muted);
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}

.cmd-bot-widget {
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--muted);
}

.cmd-bot-widget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cmd-bot-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cmd-bot-dot:hover {
  background: var(--accent);
}

.cmd-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  overscroll-behavior: contain;
}

.cmd-results::-webkit-scrollbar {
  width: 6px;
}

.cmd-results::-webkit-scrollbar-track {
  background: transparent;
}

.cmd-results::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

.cmd-results::-webkit-scrollbar-thumb:hover {
  background: var(--muted-foreground);
}

.cmd-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 6px;
}

.cmd-section-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted-foreground);
}

.cmd-section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted-foreground);
}

.cmd-section-count {
  font-size: 10px;
  font-weight: 500;
  padding: 2px 6px;
  background: var(--muted);
  border-radius: 10px;
  color: var(--muted-foreground);
}

.cmd-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cmd-grouped-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cmd-group {
  display: flex;
  flex-direction: column;
}

.cmd-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.1s ease;
  border-left: 3px solid transparent;
  background: transparent;
  width: 100%;
  text-align: left;
}

.cmd-item:hover,
.cmd-item.cmd-active {
  background: var(--accent);
  border-left-color: var(--primary);
}

.cmd-item-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--muted-foreground);
}

.cmd-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cmd-item-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-item-description {
  font-size: 12px;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmd-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.cmd-item-shortcut {
  display: flex;
  align-items: center;
  gap: 3px;
}

.cmd-kbd {
  padding: 3px 6px;
  background: var(--muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--muted-foreground);
}

.cmd-kbd-sm {
  padding: 2px 5px;
  font-size: 10px;
}

.cmd-item-arrow {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.cmd-item:hover .cmd-item-arrow,
.cmd-item.cmd-active .cmd-item-arrow {
  opacity: 1;
}

.cmd-highlight {
  background: var(--primary);
  color: var(--primary-foreground);
  border-radius: 2px;
  padding: 0 2px;
}

.cmd-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.cmd-empty-text {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cmd-empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--foreground);
}

.cmd-empty-subtitle {
  font-size: 13px;
  color: var(--muted-foreground);
}

.cmd-empty-hint {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted-foreground);
}

.cmd-empty-suggestion {
  padding: 3px 8px;
  background: var(--muted);
  border-radius: 6px;
  color: var(--foreground);
  cursor: pointer;
  transition: all 0.15s ease;
}

.cmd-empty-suggestion:hover {
  background: var(--accent);
}

.cmd-clear-recent {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px;
  margin-top: 8px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--muted-foreground);
  cursor: pointer;
  transition: all 0.15s ease;
}

.cmd-clear-recent:hover {
  background: var(--muted);
  border-color: var(--muted-foreground);
  color: var(--foreground);
}

.cmd-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted-foreground);
}

.cmd-footer-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cmd-footer-spacer {
  flex: 1;
}

.cmd-footer-count {
  font-family: var(--font-mono);
  font-size: 11px;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
`;

// Inject styles on mount
if (typeof document !== "undefined") {
  const styleId = "cmd-palette-styles";
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = styles;
    document.head.appendChild(styleEl);
  }
}
