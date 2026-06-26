"use client";

import { useState } from "react";
import {
  Play,
  Square,
  Trash2,
  Settings2,
  Loader2,
  Wifi,
  KeyRound,
  Server,
  Activity,
  AlertCircle,
  ChevronRight,
  Shield,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SkinView } from "@/components/SkinView";
import { startBot, stopBot, deleteBot, type PublicBot } from "@/lib/api/bots.functions";
import { useT } from "@/lib/preferences";

type RunRow = {
  id: string;
  status: "pending" | "starting" | "running" | "stopped" | "error";
  error: string | null;
} | null;

interface BotCardProps {
  bot: PublicBot & { run: RunRow };
  onEdit: (bot: PublicBot) => void;
  onDeleted: () => void;
  onRefresh: () => void;
  compact?: boolean;
}

const AUTH_ICONS = {
  ssid: KeyRound,
  microsoft: Shield,
  offline: User,
} as const;

const AUTH_COLORS = {
  ssid: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  microsoft: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  offline: "text-muted-foreground bg-muted/10 border-muted/30",
} as const;

function StatusBadge({ run }: { run: RunRow }) {
  if (!run) return null;

  if (run.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        LIVE
      </span>
    );
  }
  if (run.status === "starting" || run.status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/40 bg-blue-400/10 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        STARTING
      </span>
    );
  }
  if (run.status === "error") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 rounded-full border border-red-400/40 bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold text-red-400 cursor-help">
            <AlertCircle className="h-2.5 w-2.5" />
            ERROR
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p className="font-mono text-red-300">{run.error ?? "Unknown error"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/60">
      STOPPED
    </span>
  );
}

export function BotCard({ bot, onEdit, onDeleted, onRefresh, compact }: BotCardProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const AuthIcon = AUTH_ICONS[bot.authMode] ?? KeyRound;
  const authColor = AUTH_COLORS[bot.authMode] ?? AUTH_COLORS.offline;

  const isLive = bot.run?.status === "running" || bot.run?.status === "starting" || bot.run?.status === "pending";

  async function handleStart() {
    setBusy(true);
    try {
      await startBot({ data: { id: bot.id } });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to start bot");
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    try {
      await stopBot({ data: { id: bot.id } });
      onRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to stop bot");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await deleteBot({ data: { id: bot.id } });
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete bot");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div
      className={`group relative flex flex-col gap-3 rounded-2xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm transition-all duration-300
        ${isLive ? "hover:border-primary/30 hover:bg-card/60 hover:shadow-[0_0_32px_oklch(0.55_0.15_280/0.1)]" : "hover:border-border hover:bg-card/60"}
        ${bot.run?.status === "error" ? "border-red-500/20" : ""}
      `}
    >
      {/* Glow effect for live bots */}
      {isLive && (
        <div className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, oklch(0.55 0.15 280 / 0.08), transparent 70%)" }}
        />
      )}

      {/* Top row: avatar + name + status */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <SkinView username={bot.mcUsername || bot.name} size={compact ? 40 : 48} />
          {isLive && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-semibold text-sm truncate ${isLive ? "text-emerald-400" : ""}`}>
              {bot.name}
            </p>
            <StatusBadge run={bot.run} />
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${authColor}`}>
              <AuthIcon className="h-2.5 w-2.5" />
              {bot.authMode.toUpperCase()}
            </span>
            {bot.mcUsername && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[100px]">
                {bot.mcUsername}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Server info */}
      <div className="flex items-center gap-2 rounded-xl bg-card/60 px-3 py-2 border border-border/30">
        <Server className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        <span className="text-xs text-muted-foreground font-mono truncate flex-1">
          {bot.serverHost}:{bot.serverPort}
        </span>
        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
          {bot.mcVersion}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5">
        {isLive ? (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 h-8 text-xs gap-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
            onClick={handleStop}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 h-8 text-xs gap-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10"
            onClick={handleStart}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Start
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground hover:text-foreground hover:bg-card/80"
          onClick={() => onEdit(bot)}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`h-8 px-2 ${confirmDelete ? "text-red-400 bg-red-400/10" : "text-muted-foreground hover:text-red-400 hover:bg-red-400/5"}`}
          onClick={handleDelete}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
