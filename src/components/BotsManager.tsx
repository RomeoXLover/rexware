import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Bot,
  BookOpen,
  Crown,
  Globe,
  HelpCircle,
  KeyRound,
  Loader2,
  MessageSquare,
  Minus,
  Play,
  Plus,
  Save,
  Server,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Timer,
  Trash2,
  UserX,
  Webhook,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SkinView } from "@/components/SkinView";
import { ServerIcon } from "@/components/ServerIcon";
import { BotGuideDialog } from "@/components/BotGuideDialog";
import { CryptoInvoiceFlow } from "@/components/CryptoInvoiceFlow";
import {
  getMyBots,
  createBot,
  updateBot,
  deleteBot,
  startBot,
  stopBot,
  BOT_MC_VERSIONS,
  type PublicBot,
} from "@/lib/api/bots.functions";
import {
  getMySlotInfo,
  initSlotPayment,
  SLOT_PRICE_USD,
} from "@/lib/api/dashboard.functions";
import {
  listPresets,
  createPreset,
  deletePreset,
  type PublicPreset,
} from "@/lib/api/presets.functions";
import { useT } from "@/lib/preferences";

// ---------------------------------------------------------------------------
// Bots manager — deploy + control Minecraft beam bots, with a true live
// console streamed via SSE straight from the container's docker logs.
// ---------------------------------------------------------------------------

type RunRow = {
  id: string;
  status: "pending" | "starting" | "running" | "stopped" | "error";
  error: string | null;
} | null;

type BotWithRun = PublicBot & { run: RunRow };

interface BotFormState {
  name: string;
  mcUsername: string;
  serverHost: string;
  serverPort: string;
  mcVersion: string;
  authMode: "offline" | "microsoft" | "ssid";
  accessToken: string;
  ssid: string;
  uuid: string;
  // Behaviour config — stored as strings for inputs; empty => Rust default.
  message: string;
  reply: string;
  // Ordered list of custom reply-action command templates ({user}/{reply}).
  replyActions: string[];
  triggerKeyword: string;
  webhookUrl: string;
  proxy: string;
  messageInterval: string;
  replyDelay: string;
  replyCooldown: string;
  afkInterval: string;
  reconnectDelay: string;
  inactivityTimeout: string;
}

const emptyForm: BotFormState = {
  name: "",
  mcUsername: "",
  serverHost: "",
  serverPort: "25565",
  mcVersion: "1.21.1",
  authMode: "microsoft",
  accessToken: "",
  ssid: "",
  uuid: "",
  message: "",
  reply: "",
  replyActions: [],
  triggerKeyword: "",
  webhookUrl: "",
  proxy: "",
  messageInterval: "",
  replyDelay: "",
  replyCooldown: "",
  afkInterval: "",
  reconnectDelay: "",
  inactivityTimeout: "",
};

// Default behaviour values mirrored from bot/src/config.rs (shown as input
// placeholders so the user knows what they get if they leave a field blank).
const CONFIG_DEFAULTS = {
  message: "888 to join unstableSMP",
  reply: "add me on dc to join - untualab",
  triggerKeyword: "888",
  messageInterval: "30",
  replyDelay: "5",
  replyCooldown: "30",
  afkInterval: "20",
  reconnectDelay: "60",
  inactivityTimeout: "300",
} as const;

/** Map a stored bot into editable form state. */
function formFromBot(bot: PublicBot): BotFormState {
  const numStr = (n: number | null | undefined) =>
    n == null ? "" : String(n);
  return {
    name: bot.name,
    mcUsername: bot.mcUsername,
    serverHost: bot.serverHost,
    serverPort: String(bot.serverPort),
    mcVersion: bot.mcVersion,
    authMode: bot.authMode,
    accessToken: "",
    ssid: "",
    uuid: bot.uuid ?? "",
    message: bot.message ?? "",
    reply: (() => {
      if (typeof bot.reply === "string") return bot.reply;
      if (Array.isArray(bot.reply)) return bot.reply[0] ?? "";
      return "";
    })(),
    replyActions: bot.replyActions ?? [],
    triggerKeyword: bot.triggerKeyword ?? "",
    webhookUrl: bot.webhookUrl ?? "",
    proxy: bot.proxy ?? "",
    messageInterval: numStr(bot.messageInterval),
    replyDelay: numStr(bot.replyDelay),
    replyCooldown: numStr(bot.replyCooldown),
    afkInterval: numStr(bot.afkInterval),
    reconnectDelay: numStr(bot.reconnectDelay),
    inactivityTimeout: numStr(bot.inactivityTimeout),
  };
}

/** Build the API payload from form state (empty strings => undefined). */
function payloadFromForm(form: BotFormState) {
  const num = (s: string) => {
    const t = s.trim();
    if (!t) return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? Math.round(n) : undefined;
  };
  return {
    name: form.name.trim(),
    mcUsername: form.mcUsername.trim(),
    serverHost: form.serverHost.trim(),
    serverPort: Number(form.serverPort) || 25565,
    mcVersion: form.mcVersion as (typeof BOT_MC_VERSIONS)[number],
    authMode: form.authMode,
    accessToken: form.accessToken.trim() || undefined,
    ssid: form.ssid.trim() || undefined,
    uuid: form.uuid.trim() || undefined,
    message: form.message.trim() || undefined,
    reply: (() => {
      const trimmed = form.reply.trim();
      return trimmed ? [trimmed] : undefined;
    })(),
    replyActions: (() => {
      const cleaned = form.replyActions
        .map((a) => a.trim())
        .filter(Boolean);
      return cleaned.length > 0 ? cleaned : undefined;
    })(),
    triggerKeyword: form.triggerKeyword.trim() || undefined,
    webhookUrl: form.webhookUrl.trim() || undefined,
    proxy: form.proxy.trim() || undefined,
    messageInterval: num(form.messageInterval),
    replyDelay: num(form.replyDelay),
    replyCooldown: num(form.replyCooldown),
    afkInterval: num(form.afkInterval),
    reconnectDelay: num(form.reconnectDelay),
    inactivityTimeout: num(form.inactivityTimeout),
  };
}

function isLive(run: RunRow): boolean {
  return (
    !!run &&
    (run.status === "running" ||
      run.status === "starting" ||
      run.status === "pending")
  );
}

function StatusDot({ run }: { run: RunRow }) {
  const live = isLive(run);
  const error = run?.status === "error";
  const color = live
    ? "bg-emerald-400"
    : error
      ? "bg-red-400"
      : "bg-[#6d6f78]";
  const label = run ? run.status : "idle";
  const pulse = live ? "animate-pulse" : "";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#b5bac1]">
      <span className={`relative grid h-2 w-2 place-items-center ${pulse}`}>
        {live && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full ${color} opacity-50`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      <span className="capitalize text-[#b5bac1]">{label}</span>
    </span>
  );
}

export function BotsManager({
  maxBots,
  botHours,
  planName,
  hoursUsedToday,
  hoursLimit: hoursLimitProp,
}: {
  maxBots: number;
  botHours: number;
  planName: string;
  hoursUsedToday?: number;
  hoursLimit?: number;
}) {
  const t = useT();
  const [bots, setBots] = useState<BotWithRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [dockerAvailable, setDockerAvailable] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Effective bot cap = plan cap + purchased lifetime slots. Seeded from the
  // plan prop, then kept in sync with the server (getMyBots returns the total).
  const [effectiveMax, setEffectiveMax] = useState(maxBots);
  // Extra-slot purchase state.
  const [slotEligible, setSlotEligible] = useState(false);
  const [extraSlots, setExtraSlots] = useState(0);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [slotQty, setSlotQty] = useState(1);

  // Daily bot-hours budget tracking + the "out of hours" popup.
  const [hoursLimit, setHoursLimit] = useState(hoursLimitProp ?? -1);
  const [hoursUsedTodayState, setHoursUsedTodayState] = useState(hoursUsedToday ?? 0);
  const [hoursPopupOpen, setHoursPopupOpen] = useState(false);
  // True when running bots were actually force-stopped due to the limit, so the
  // popup can say "we stopped them" instead of just "you can't start new ones".
  const [hoursStopped, setHoursStopped] = useState(false);
  // Ensures the popup only auto-opens once per exhaustion event, not on every poll.
  const hoursWarnedRef = useRef(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PublicBot | null>(null);
  const [form, setForm] = useState<BotFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PublicBot | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);

  // In-app multilingual guide popup (same content/look as /docs).
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSection, setGuideSection] = useState<string | undefined>(undefined);
  const openGuide = (section?: string) => {
    setGuideSection(section);
    setGuideOpen(true);
  };

  const atCap = effectiveMax !== -1 && bots.length >= effectiveMax;
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null;

  async function refreshSlots() {
    try {
      const info = await getMySlotInfo();
      setSlotEligible(info.eligible);
      setExtraSlots(info.extraSlots);
    } catch {
      // keep previous state
    }
  }

  async function refresh() {
    try {
      const res = await getMyBots();
      setBots(res.bots as BotWithRun[]);
      setDockerAvailable(res.dockerAvailable);
      setEffectiveMax(res.maxBots);
      setHoursLimit(res.hoursLimit);
      setHoursUsedTodayState(res.hoursUsedToday);
      // The server reports whether the daily limit is reached (and force-stops
      // any over-limit bots). Track if bots were actually stopped this request.
      setHoursStopped(res.hoursJustStopped > 0);

      // Auto-surface the popup the first time the daily limit is reached, and
      // re-arm it once the user is back under the limit (e.g. after UTC reset).
      const exhausted = res.hoursLimitReached;
      if (exhausted && !hoursWarnedRef.current) {
        hoursWarnedRef.current = true;
        setHoursPopupOpen(true);
      } else if (!exhausted) {
        hoursWarnedRef.current = false;
        setHoursStopped(false);
      }
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    refreshSlots();
    // Poll status while any bot is live.
    const pollId = setInterval(() => {
      setBots((prev) => {
        if (prev.some((b) => isLive(b.run))) void refresh();
        return prev;
      });
    }, 5000);
    return () => clearInterval(pollId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    const payload = payloadFromForm(form);
    try {
      if (editing) {
        await updateBot({ data: { ...payload, id: editing.id } });
      } else {
        await createBot({ data: payload });
      }
      setFormOpen(false);
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("bots.err.save"));
    } finally {
      setSaving(false);
    }
  }

  async function handleStart(bot: BotWithRun) {
    setBusyId(bot.id);
    try {
      const res = await startBot({ data: { id: bot.id } });
      setDockerAvailable(res.dockerAvailable);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("bots.err.start");
      // The daily bot-hours limit raises a specific error from the server —
      // surface the dedicated popup instead of a raw alert.
      if (/bot-hour/i.test(msg)) {
        await refresh();
        setHoursPopupOpen(true);
      } else {
        alert(msg);
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleStop(bot: BotWithRun) {
    setBusyId(bot.id);
    try {
      await stopBot({ data: { id: bot.id } });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("bots.err.stop"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await deleteBot({ data: { id: deleteTarget.id } });
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("bots.err.delete"));
    } finally {
      setBusyId(null);
    }
  }

  const deployedLabel = t("bots.deployedCount", {
    count: bots.length,
    max: effectiveMax === -1 ? "∞" : effectiveMax,
  });

  // Full-page detail view for a single bot (config + live console).
  if (selectedBot) {
    return (
      <>
        <BotDetailPage
          key={selectedBot.id}
          bot={selectedBot}
          busy={busyId === selectedBot.id}
          dockerAvailable={dockerAvailable}
          onBack={() => setSelectedBotId(null)}
          onStart={() => handleStart(selectedBot)}
          onStop={() => handleStop(selectedBot)}
          onDelete={() => setDeleteTarget(selectedBot)}
          onSaved={refresh}
          onOpenGuide={openGuide}
        />
        <BotGuideDialog
          open={guideOpen}
          onOpenChange={setGuideOpen}
          initialSection={guideSection}
        />
      </>
    );
  }

  return (
    <div
      className="space-y-8"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {/* Plan capacity */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 px-1 text-muted-foreground/70">
          <Activity className="h-3.5 w-3.5" />
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em]">
            {t("bots.capacity")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <CapacityTile
            icon={<Bot className="h-3.5 w-3.5" />}
            label={t("bots.maxConcurrent")}
            value={
              effectiveMax === -1
                ? t("bots.unlimited")
                : `${bots.length} / ${effectiveMax}`
            }
            sub={
              extraSlots > 0
                ? t("bots.includingSlots", { n: extraSlots })
                : t("bots.botsDeployed")
            }
          />
          <CapacityTile
            icon={<Timer className="h-3.5 w-3.5" />}
            label={t("bots.botHours")}
            value={botHours === -1 ? t("bots.unlimited") : `${botHours}h`}
            sub={t("bots.availableToday")}
          />
          <CapacityTile
            icon={<Crown className="h-3.5 w-3.5" />}
            label={t("bots.plan")}
            value={planName || "—"}
            sub={t("bots.currentTier")}
          />
        </div>

        {/* Bot-hours daily usage bar — shown when limit is finite and non-zero */}
        {botHours !== -1 && botHours > 0 && (
          <div className="space-y-2 rounded-2xl border border-border/60 bg-card/40 p-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Timer className="h-3.5 w-3.5 text-amber-400" />
                <span className="font-medium">Bot-hours today</span>
              </div>
              <span className="tabular-nums text-muted-foreground">
                {hoursUsedTodayState.toFixed(1)}h / {botHours}h
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (hoursUsedTodayState / botHours) * 100)}%`,
                  background:
                    hoursUsedTodayState >= botHours
                      ? "linear-gradient(90deg, #f87171, #ef4444)"
                      : "linear-gradient(90deg, #fbbf24, #f59e0b)",
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground/40">
              Resets at midnight UTC{" "}
              {hoursUsedTodayState >= botHours && (
                <span className="ml-1 font-medium text-red-400">— limit reached</span>
              )}
            </p>
          </div>
        )}
      </section>

      {/* Extra slots — paying subscribers can buy +1 bot per slot, lifetime. */}
      {slotEligible && effectiveMax !== -1 && (
        <section className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-border/60 bg-muted/30 text-foreground/75">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("bots.slots.title")}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t("bots.slots.desc", { price: SLOT_PRICE_USD })}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5 rounded-full text-xs"
            onClick={() => {
              setSlotQty(1);
              setSlotDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("bots.slots.buy")}
          </Button>
        </section>
      )}

      {!dockerAvailable && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {t("bots.dockerOffline")}
        </div>
      )}

      {/* Bots list */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-muted-foreground/70">
            <Bot className="h-3.5 w-3.5" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em]">
              {t("bots.yourBots")}
            </h3>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {deployedLabel}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 rounded-full border-border/60 bg-card/40 text-xs"
              onClick={() => openGuide("deploying-bots")}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {t("bots.guide")}
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1.5 rounded-full text-xs"
              onClick={openCreate}
              disabled={atCap}
              title={atCap ? t("bots.planLimit") : undefined}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("bots.deploy")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid place-items-center rounded-2xl border border-[#313338] bg-[#1e1f22] px-6 py-16">
            <Loader2 className="h-5 w-5 animate-spin text-[#6d6f78]" />
          </div>
        ) : bots.length === 0 ? (
          <div className="relative overflow-hidden rounded-2xl border border-[#313338] bg-[#1e1f22]">
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="ac-float mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#313338] bg-[#2b2d31] text-[#949ba4]">
                <Bot className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-white">
                {t("bots.noneTitle")}
              </p>
              <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[#b5bac1]">
                {t("bots.noneDesc", {
                  plan: planName,
                  limit:
                    effectiveMax === -1
                      ? t("bots.limitUnlimited")
                      : t("bots.limitN", { n: effectiveMax }),
                })}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 rounded-lg text-xs"
                  onClick={openCreate}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("bots.deploy")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 rounded-lg border-[#313338] bg-[#2b2d31] text-xs text-[#b5bac1]"
                  onClick={() => openGuide("deploying-bots")}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  {t("bots.readGuide")}
                </Button>
              </div>
              <p className="mt-4 text-[11px] text-[#6d6f78]">
                {t("bots.guideTip")}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {bots.map((bot) => {
              const live = isLive(bot.run);
              const busy = busyId === bot.id;
              return (
                <div
                  key={bot.id}
                  className="group relative overflow-hidden rounded-2xl border border-[#313338] bg-[#1e1f22] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#3f4147] hover:shadow-[0_8px_30px_rgba(0,0,0,0.45)]"
                >
                  {/* Status glow top border */}
                  <div
                    className={`absolute inset-x-0 top-0 h-px ${
                      live
                        ? "bg-gradient-to-r from-transparent via-[#3fb950] to-transparent"
                        : bot.run?.status === "error"
                          ? "bg-gradient-to-r from-transparent via-red-500/60 to-transparent"
                          : "bg-gradient-to-r from-transparent via-[#3f4147]/60 to-transparent"
                    }`}
                  />

                  <button
                    type="button"
                    onClick={() => setSelectedBotId(bot.id)}
                    className="flex w-full items-start gap-3 p-4 text-left overflow-hidden"
                  >
                    {/* Skin avatar */}
                    <div className="shrink-0 overflow-hidden rounded-xl border border-[#313338] bg-[#2b2d31]">
                      <SkinView username={bot.mcUsername} size={64} />
                    </div>

                    {/* Content — never overflow the card */}
                    <div className="min-w-0 flex-1 overflow-hidden">
                      {/* Name + status row */}
                      <div className="flex items-start justify-between gap-2 overflow-hidden">
                        <p className="min-w-0 truncate font-semibold text-white text-sm leading-tight">
                          {bot.name}
                        </p>
                        <StatusDot run={bot.run} />
                      </div>

                      {/* Username */}
                      <p className="mt-0.5 min-w-0 truncate text-xs text-[#b5bac1]">
                        {bot.mcUsername || t("bots.autoNameShort")}
                      </p>

                      {/* Server */}
                      <div className="mt-1.5 min-w-0 flex items-center gap-1.5 overflow-hidden">
                        <span className="shrink-0">
                          <ServerIcon host={bot.serverHost} port={bot.serverPort} size={14} />
                        </span>
                        <p className="min-w-0 flex-1 truncate text-xs text-[#949ba4]">
                          {bot.serverHost}:{bot.serverPort}
                        </p>
                      </div>

                      {/* Badges */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 overflow-hidden">
                        <Badge>{bot.mcVersion}</Badge>
                        <Badge>{bot.authMode}</Badge>
                        {live && (
                          <span className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                            live
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  {bot.run?.status === "error" && bot.run.error && (
                    <div className="mx-4 mb-1 overflow-hidden rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                      {bot.run.error}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 border-t border-[#313338] px-3 py-2.5">
                    {live ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 flex-1 gap-1.5 rounded-lg border-[#3f4147] bg-[#2b2d31] text-xs font-medium text-white hover:border-[#5865F2] hover:bg-[#35373d]"
                        onClick={() => handleStop(bot)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-red-400" />
                        )}
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="h-8 flex-1 gap-1.5 rounded-lg text-xs font-medium"
                        onClick={() => handleStart(bot)}
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        Start
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 rounded-lg px-2.5 text-xs text-[#b5bac1] hover:border-[#3f4147] hover:bg-[#2b2d31]"
                      onClick={() => setSelectedBotId(bot.id)}
                      title={t("bots.openConsole")}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-red-400/70 hover:border-red-500/30 hover:bg-red-500/10"
                      onClick={() => setDeleteTarget(bot)}
                      title={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Deploy / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border border-[#313338] bg-[#1e1f22] sm:max-w-lg">
          <DialogHeader className="mb-2">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#313338] bg-[#2b2d31] text-white">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-white">
                  {editing ? t("bots.editTitle") : t("bots.deployTitle")}
                </DialogTitle>
                <DialogDescription className="text-xs text-[#b5bac1]">
                  {t("bots.dialogDesc")}
                </DialogDescription>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openGuide("deploying-bots")}
              className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#313338] bg-[#2b2d31] px-3 py-1.5 text-xs text-[#b5bac1] transition-colors hover:border-[#5865F2] hover:text-white"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {t("bots.deployHelp")}
            </button>
          </DialogHeader>

          <div className="grid gap-4">
            <Field label={t("bots.field.name")}>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("bots.ph.name")}
              />
            </Field>
            {form.authMode === "offline" ? (
              <Field label={t("bots.field.usernameOffline")}>
                <Input
                  value={form.mcUsername}
                  onChange={(e) =>
                    setForm({ ...form, mcUsername: e.target.value })
                  }
                  placeholder={t("bots.ph.username")}
                />
              </Field>
            ) : (
              <p className="rounded-lg border border-[#313338] bg-[#2b2d31] px-3 py-2 text-xs leading-relaxed text-[#949ba4]">
                {t("bots.note.autoName")}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label={t("bots.field.host")}>
                  <Input
                    value={form.serverHost}
                    onChange={(e) =>
                      setForm({ ...form, serverHost: e.target.value })
                    }
                    placeholder={t("bots.ph.host")}
                  />
                </Field>
              </div>
              <Field label={t("bots.field.port")}>
                <Input
                  value={form.serverPort}
                  onChange={(e) =>
                    setForm({ ...form, serverPort: e.target.value })
                  }
                  inputMode="numeric"
                  placeholder="25565"
                />
              </Field>
            </div>
            <Field label={t("bots.field.version")}>
              <Select
                value={form.mcVersion}
                onValueChange={(v) => setForm({ ...form, mcVersion: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOT_MC_VERSIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <AuthModePicker
              value={form.authMode}
              onChange={(authMode) => setForm({ ...form, authMode })}
            />

            {form.authMode === "microsoft" && (
              <>
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-200">
                  {t("bots.note.msaLogin")}
                </p>
                <Field label={t("bots.field.accessTokenOpt")}>
                  <Input
                    value={form.accessToken}
                    onChange={(e) =>
                      setForm({ ...form, accessToken: e.target.value })
                    }
                    placeholder={t("bots.ph.accessToken")}
                    type="password"
                  />
                </Field>
              </>
            )}
            {form.authMode === "ssid" && (
              <Field label={t("bots.field.ssid")}>
                <Input
                  value={form.ssid}
                  onChange={(e) => setForm({ ...form, ssid: e.target.value })}
                  placeholder={t("bots.ph.ssid")}
                  type="password"
                />
              </Field>
            )}

            <Field label={t("bots.field.proxy")}>
              <Input
                value={form.proxy}
                onChange={(e) => setForm({ ...form, proxy: e.target.value })}
                placeholder={t("bots.ph.proxy")}
              />
              <p className="mt-1 text-[11px] text-[#6d6f78]">
                {t("bots.ph.proxyHint")}
              </p>
            </Field>

            {formError && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button
              variant="ghost"
              onClick={() => setFormOpen(false)}
              disabled={saving}
              className="rounded-lg text-xs text-[#b5bac1] hover:border hover:border-[#313338] hover:bg-[#2b2d31]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg text-xs font-medium"
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {editing ? t("bots.saveChanges") : t("bots.deployBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl border border-[#313338] bg-[#1e1f22]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">{t("bots.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-[#b5bac1]">
              {deleteTarget ? t("bots.deleteConfirmBody", { name: deleteTarget.name }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white hover:border-[#5865F2] hover:bg-[#35373d]">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="rounded-lg bg-red-600 text-xs text-white hover:bg-red-700"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Daily bot-hours exhausted popup */}
      <Dialog open={hoursPopupOpen} onOpenChange={setHoursPopupOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
              <Timer className="h-5 w-5 text-amber-400" />
            </div>
            <DialogTitle className="text-white">{t("bots.hoursUpTitle")}</DialogTitle>
            <DialogDescription className="text-xs text-[#b5bac1] leading-relaxed">
              {t(hoursStopped ? "bots.hoursUpStoppedBody" : "bots.hoursUpBody", {
                limit: hoursLimit < 0 ? "∞" : hoursLimit,
                plan: planName || "—",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setHoursPopupOpen(false)}
              className="rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white hover:border-[#5865F2] hover:bg-[#35373d]"
            >
              {t("bots.hoursUpDismiss")}
            </Button>
            <Button asChild className="rounded-lg text-xs">
              <a href="/pricing">{t("bots.hoursUpUpgrade")}</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Buy extra bot slots */}
      <Dialog
        open={slotDialogOpen}
        onOpenChange={(o) => {
          setSlotDialogOpen(o);
          if (!o) refreshSlots();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[#313338] bg-[#2b2d31]">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <DialogTitle className="text-white">{t("bots.slots.title")}</DialogTitle>
            <DialogDescription className="text-xs text-[#b5bac1] leading-relaxed">
              {t("bots.slots.dialogDesc", { price: SLOT_PRICE_USD })}
            </DialogDescription>
          </DialogHeader>

          {/* Quantity stepper */}
          <div className="flex items-center justify-between rounded-xl border border-[#313338] bg-[#2b2d31] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">{t("bots.slots.quantity")}</p>
              <p className="text-xs text-[#949ba4]">
                {t("bots.slots.total", { total: SLOT_PRICE_USD * slotQty })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-lg border border-[#313338] bg-[#1e1f22] text-white hover:border-[#5865F2]"
                onClick={() => setSlotQty((q) => Math.max(1, q - 1))}
                disabled={slotQty <= 1}
                aria-label={t("bots.slots.decrease")}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-8 text-center text-sm font-semibold text-white tabular-nums">
                {slotQty}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 rounded-lg border border-[#313338] bg-[#1e1f22] text-white hover:border-[#5865F2]"
                onClick={() => setSlotQty((q) => Math.min(25, q + 1))}
                disabled={slotQty >= 25}
                aria-label={t("bots.slots.increase")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <CryptoInvoiceFlow
            title={t("bots.slots.invoiceTitle", { n: slotQty })}
            priceUsd={SLOT_PRICE_USD * slotQty}
            initPayment={(coin) =>
              initSlotPayment({ data: { coin, quantity: slotQty } })
            }
            onClose={() => {
              setSlotDialogOpen(false);
              refreshSlots();
            }}
            onPaid={() => {
              refresh();
              refreshSlots();
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Bot-specific multilingual guide popup (docs-style) */}
      <BotGuideDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        initialSection={guideSection}
      />
    </div>
  );
}

// --- Full-page bot detail (config + live console) ---------------------------

function BotDetailPage({
  bot,
  busy,
  dockerAvailable,
  onBack,
  onStart,
  onStop,
  onDelete,
  onSaved,
  onOpenGuide,
}: {
  bot: BotWithRun;
  busy: boolean;
  dockerAvailable: boolean;
  onBack: () => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void> | void;
  onOpenGuide: (section?: string) => void;
}) {
  const t = useT();
  const [form, setForm] = useState<BotFormState>(() => formFromBot(bot));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const live = isLive(bot.run);
  const set = (patch: Partial<BotFormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateBot({ data: { ...payloadFromForm(form), id: bot.id } });
      setSavedAt(Date.now());
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("bots.err.saveSettings"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="space-y-6"
      style={{ animation: "fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("bots.backToAll")}
        </button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 rounded-full border-border/60 bg-card/40 text-xs"
          onClick={() => onOpenGuide("deploying-bots")}
        >
          <BookOpen className="h-3.5 w-3.5" />
          {t("bots.guide")}
        </Button>
      </div>

      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-[#313338] bg-[#1e1f22] p-5">
        {/* Status glow top */}
        <div
          className={`absolute inset-x-0 top-0 h-px ${
            live
              ? "bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
              : bot.run?.status === "error"
                ? "bg-gradient-to-r from-transparent via-red-500/60 to-transparent"
                : "bg-gradient-to-r from-transparent via-[#3f4147]/60 to-transparent"
          }`}
        />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="shrink-0 overflow-hidden rounded-xl border border-[#313338] bg-[#2b2d31]">
            <SkinView username={bot.mcUsername} size={96} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <h2 className="truncate text-xl font-semibold tracking-tight text-white">
                {bot.name}
              </h2>
              <StatusDot run={bot.run} />
            </div>
            <p className="mt-0.5 truncate text-sm text-[#b5bac1]">
              {bot.mcUsername || t("bots.autoNameShort")}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <ServerIcon host={bot.serverHost} port={bot.serverPort} size={18} />
              <p className="truncate text-xs text-[#949ba4]">
                {bot.serverHost}:{bot.serverPort}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge>{bot.mcVersion}</Badge>
              <Badge>{bot.authMode}</Badge>
              {live && (
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-400">
                  live
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {live ? (
              <Button
                variant="outline"
                className="gap-1.5 rounded-lg border-[#3f4147] bg-[#2b2d31] text-sm text-white hover:border-red-500/50 hover:bg-red-500/10"
                onClick={onStop}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 text-red-400" />
                )}
                Stop
              </Button>
            ) : (
              <Button className="gap-1.5 rounded-lg text-sm" onClick={onStart} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-red-400/70 hover:border-red-500/30 hover:bg-red-500/10"
              onClick={onDelete}
              title={t("bots.deleteBot")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {bot.run?.status === "error" && bot.run.error && (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {bot.run.error}
          </p>
        )}
        {!dockerAvailable && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            {t("bots.runtimeOffline")}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Config */}
        <div className="space-y-6 lg:col-span-3">
          <Section icon={<Server className="h-3.5 w-3.5" />} title={t("bots.section.accountServer")}>
            <Field label={t("bots.field.name")}>
              <Input
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            {form.authMode === "offline" ? (
              <Field label={t("bots.field.usernameOffline")}>
                <Input
                  value={form.mcUsername}
                  onChange={(e) => set({ mcUsername: e.target.value })}
                />
              </Field>
            ) : (
              <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {t("bots.note.autoName")}
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label={t("bots.field.host")}>
                  <Input
                    value={form.serverHost}
                    onChange={(e) => set({ serverHost: e.target.value })}
                  />
                </Field>
              </div>
              <Field label={t("bots.field.port")}>
                <Input
                  value={form.serverPort}
                  inputMode="numeric"
                  onChange={(e) => set({ serverPort: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t("bots.field.version")}>
              <Select
                value={form.mcVersion}
                onValueChange={(v) => set({ mcVersion: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOT_MC_VERSIONS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <AuthModePicker
              value={form.authMode}
              onChange={(authMode) => set({ authMode })}
            />
            {form.authMode === "microsoft" && (
              <>
                <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-200">
                  {t("bots.note.msaLogin")}
                </p>
                <Field label={t("bots.field.accessTokenKeep")}>
                  <Input
                    type="password"
                    value={form.accessToken}
                    onChange={(e) => set({ accessToken: e.target.value })}
                    placeholder="••••••••"
                  />
                </Field>
              </>
            )}
            {form.authMode === "ssid" && (
              <Field label={t("bots.field.ssidKeep")}>
                <Input
                  type="password"
                  value={form.ssid}
                  onChange={(e) => set({ ssid: e.target.value })}
                  placeholder="••••••••"
                />
              </Field>
            )}
            <Field label={t("bots.field.proxy")}>
              <Input
                value={form.proxy}
                onChange={(e) => set({ proxy: e.target.value })}
                placeholder={t("bots.ph.proxy")}
              />
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                {t("bots.ph.proxyHint")}
              </p>
            </Field>
          </Section>

          <Section
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            title={t("bots.section.messages")}
            hint={t("bots.section.messagesHint")}
          >
            <Field label={t("bots.field.spam")}>
              <Input
                value={form.message}
                onChange={(e) => set({ message: e.target.value })}
                placeholder={CONFIG_DEFAULTS.message}
              />
            </Field>
            <Field label={t("bots.field.replyMsg")}>
              <Input
                value={form.reply}
                onChange={(e) => set({ reply: e.target.value })}
                placeholder={CONFIG_DEFAULTS.reply}
              />
            </Field>

            <ReplyActionsEditor
              actions={form.replyActions}
              onChange={(replyActions) => set({ replyActions })}
              server={{
                host: form.serverHost,
                port: form.serverPort,
                version: form.mcVersion,
              }}
              onApplyServer={(s) =>
                set({
                  serverHost: s.host,
                  serverPort: s.port,
                  mcVersion: s.version || form.mcVersion,
                })
              }
            />

            <Field label={t("bots.field.trigger")}>
              <Input
                value={form.triggerKeyword}
                onChange={(e) => set({ triggerKeyword: e.target.value })}
                placeholder={CONFIG_DEFAULTS.triggerKeyword}
              />
            </Field>
          </Section>

          <Section
            icon={<Timer className="h-3.5 w-3.5" />}
            title={t("bots.section.timing")}
            hint={t("bots.section.timingHint")}
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("bots.field.msgInterval")}>
                <Input
                  inputMode="numeric"
                  value={form.messageInterval}
                  onChange={(e) => set({ messageInterval: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.messageInterval}
                />
              </Field>
              <Field label={t("bots.field.replyDelay")}>
                <Input
                  inputMode="numeric"
                  value={form.replyDelay}
                  onChange={(e) => set({ replyDelay: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.replyDelay}
                />
              </Field>
              <Field label={t("bots.field.replyCooldown")}>
                <Input
                  inputMode="numeric"
                  value={form.replyCooldown}
                  onChange={(e) => set({ replyCooldown: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.replyCooldown}
                />
              </Field>
              <Field label={t("bots.field.afkInterval")}>
                <Input
                  inputMode="numeric"
                  value={form.afkInterval}
                  onChange={(e) => set({ afkInterval: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.afkInterval}
                />
              </Field>
              <Field label={t("bots.field.reconnectDelay")}>
                <Input
                  inputMode="numeric"
                  value={form.reconnectDelay}
                  onChange={(e) => set({ reconnectDelay: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.reconnectDelay}
                />
              </Field>
              <Field label={t("bots.field.inactivityTimeout")}>
                <Input
                  inputMode="numeric"
                  value={form.inactivityTimeout}
                  onChange={(e) => set({ inactivityTimeout: e.target.value })}
                  placeholder={CONFIG_DEFAULTS.inactivityTimeout}
                />
              </Field>
            </div>
          </Section>

          <Section
            icon={<Webhook className="h-3.5 w-3.5" />}
            title={t("bots.section.webhook")}
            hint={t("bots.section.webhookHint")}
          >
            <Field label={t("bots.field.webhookUrl")}>
              <Input
                value={form.webhookUrl}
                onChange={(e) => set({ webhookUrl: e.target.value })}
                placeholder="https://discord.com/api/webhooks/…"
              />
            </Field>
          </Section>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("bots.saveSettings")}
            </Button>
            {savedAt && !saving && (
              <span className="text-xs text-emerald-400">{t("bots.saved")}</span>
            )}
            {live && (
              <span className="text-xs text-muted-foreground">
                {t("bots.restartApply")}
              </span>
            )}
          </div>
        </div>

        {/* Live console */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4">
            <LiveConsole runId={bot.run?.id ?? null} />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Live console (inline streaming box) ------------------------------------

function LiveConsole({ runId }: { runId: string | null }) {
  const t = useT();
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!runId) {
      setLines([]);
      setConnected(false);
      return;
    }
    setLines([]);
    setConnected(false);

    const es = new EventSource(
      `/api/runner/stream?runId=${encodeURIComponent(runId)}`,
    );

    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("log", (e) => {
      try {
        const { line } = JSON.parse((e as MessageEvent).data);
        if (typeof line === "string") {
          setLines((prev) => [...prev.slice(-499), stripAnsi(line)]);
        }
      } catch {
        // ignore malformed
      }
    });
    es.addEventListener("info", (e) => {
      try {
        const { message } = JSON.parse((e as MessageEvent).data);
        if (message) setLines((prev) => [...prev, `[system] ${message}`]);
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
      es.close();
    };

    return () => es.close();
  }, [runId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#313338] bg-[#1e1f22]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#313338] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-[#949ba4]" />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">
            {t("bots.liveConsole")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              streaming
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 text-xs ${
              connected ? "text-emerald-400" : "text-[#6d6f78]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-[#6d6f78]"
              }`}
            />
            {connected ? t("bots.streaming") : runId ? t("bots.connecting") : t("bots.offline")}
          </span>
        </div>
      </div>

      {/* Log area */}
      <div
        ref={scrollRef}
        className="h-[520px] overflow-y-auto bg-[#0d0d12] p-3 font-mono text-xs leading-relaxed text-[#e3e5e8]"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#3f4147 transparent" }}
      >
        {!runId ? (
          <p className="flex h-full items-center justify-center text-[#6d6f78]">
            {t("bots.startToSee")}
          </p>
        ) : lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2b2d31]">
              <Terminal className="h-5 w-5 text-[#6d6f78]" />
            </div>
            <p className="text-[#6d6f78]">{t("bots.waitingOutput")}</p>
          </div>
        ) : (
          lines.map((l, i) => {
            const ts = new Date().toLocaleTimeString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            const isError = l.toLowerCase().includes("error") || l.toLowerCase().includes("panic");
            const isWarn = l.toLowerCase().includes("warn");
            const isSystem = l.startsWith("[system]");
            const lineColor = isError
              ? "text-red-400"
              : isWarn
                ? "text-amber-400"
                : isSystem
                  ? "text-sky-400"
                  : "text-[#e3e5e8]";
            return (
              <div key={i} className={`whitespace-pre-wrap break-words ${lineColor}`}>
                <span className="mr-3 select-none text-[#6d6f78]">[{ts}]</span>
                {l}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- Section wrapper --------------------------------------------------------

// Common command templates offered as one-tap quick-adds.
const REPLY_ACTION_EXAMPLES = [
  "/msg {user} {reply}",
  "/party invite {user}",
  "/party chat {reply}",
  "/w {user} add me on discord",
  "/r {reply}",
] as const;

function ReplyActionsEditor({
  actions,
  onChange,
  server,
  onApplyServer,
}: {
  actions: string[];
  onChange: (next: string[]) => void;
  server?: { host: string; port: string; version: string };
  onApplyServer?: (s: { host: string; port: string; version: string }) => void;
}) {
  const t = useT();
  const [presets, setPresets] = useState<PublicPreset[]>([]);
  const [savingPreset, setSavingPreset] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [includeServer, setIncludeServer] = useState(false);

  const loadPresets = () => {
    listPresets()
      .then((r) => setPresets(r.presets))
      .catch(() => setPresets([]));
  };
  useEffect(() => {
    loadPresets();
  }, []);

  const update = (i: number, value: string) =>
    onChange(actions.map((a, idx) => (idx === i ? value : a)));
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const add = (value = "") => onChange([...actions, value]);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= actions.length) return;
    const next = [...actions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    onChange([...preset.actions]);
    if (preset.serverHost && onApplyServer) {
      onApplyServer({
        host: preset.serverHost,
        port: String(preset.serverPort ?? 25565),
        version: preset.mcVersion ?? (server?.version ?? ""),
      });
    }
  };

  const cleaned = actions.map((a) => a.trim()).filter(Boolean);

  const handleSavePreset = async () => {
    if (!presetName.trim() || cleaned.length === 0 || savingPreset) return;
    setSavingPreset(true);
    try {
      const host = server?.host.trim();
      await createPreset({
        data: {
          name: presetName.trim(),
          actions: cleaned,
          ...(includeServer && host
            ? {
                serverHost: host,
                serverPort: Number(server?.port) || 25565,
                ...(server?.version ? { mcVersion: server.version } : {}),
              }
            : {}),
        },
      });
      setPresetName("");
      setShowSave(false);
      setIncludeServer(false);
      loadPresets();
    } catch {
      /* surfaced via disabled state; keep silent to avoid blocking the form */
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (id: string) => {
    try {
      await deletePreset({ data: { id } });
      loadPresets();
    } catch {
      /* ignore — global presets can't be deleted by users */
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-[#313338] bg-[#1e1f22] p-4">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-white">
          {t("bots.replyActions")}
        </Label>
        <p className="text-[11px] leading-relaxed text-[#949ba4]">
          {t("bots.ra.p1")}{" "}
          <code className="rounded bg-[#2b2d31] px-1 font-mono text-[#e3e5e8]">{"{user}"}</code>{" "}
          {t("bots.ra.p2")}{" "}
          <code className="rounded bg-[#2b2d31] px-1 font-mono text-[#e3e5e8]">{"{reply}"}</code>{" "}
          {t("bots.ra.p3")}{" "}
          <code className="rounded bg-[#2b2d31] px-1 font-mono text-[#e3e5e8]">
            {"/msg {user} {reply}"}
          </code>
          .
        </p>
      </div>

      {actions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#313338] px-3 py-2 text-[11px] text-[#6d6f78]">
          {t("bots.ra.none")}{" "}
          <span className="font-mono">/msg {"{user} {reply}"}</span>.
        </p>
      ) : (
        <div className="space-y-2">
          {actions.map((action, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#313338] bg-[#2b2d31] font-mono text-[11px] text-[#949ba4]">
                {i + 1}
              </span>
              <Input
                value={action}
                onChange={(e) => update(i, e.target.value)}
                placeholder="/party invite {user}"
                className="font-mono text-xs"
                aria-label={t("bots.ra.actionAria", { n: i + 1 })}
              />
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="px-1 text-[#6d6f78] transition-colors hover:text-white disabled:opacity-30"
                  aria-label={t("bots.ra.moveUp")}
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === actions.length - 1}
                  className="px-1 text-[#6d6f78] transition-colors hover:text-white disabled:opacity-30"
                  aria-label={t("bots.ra.moveDown")}
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#313338] text-[#6d6f78] transition-colors hover:border-red-500/50 hover:text-red-400"
                aria-label={t("bots.ra.removeAria", { n: i + 1 })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => add()}
          className="h-8 gap-1.5 rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white hover:border-[#5865F2] hover:bg-[#35373d]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("bots.ra.add")}
        </Button>
        <span className="text-[10px] uppercase tracking-wide text-[#6d6f78]">
          {t("bots.ra.quickAdd")}
        </span>
        {REPLY_ACTION_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => add(ex)}
            className="rounded-md border border-[#313338] bg-[#1e1f22] px-2 py-1 font-mono text-[10px] text-[#949ba4] transition-colors hover:border-[#5865F2] hover:text-white"
          >
            {ex}
          </button>
        ))}
      </div>

      {/* Presets */}
      <div className="space-y-2 border-t border-[#313338] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {presets.length > 0 && (
            <Select onValueChange={applyPreset}>
              <SelectTrigger className="h-8 w-auto min-w-[160px] rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white">
                <SelectValue placeholder={t("bots.ra.applyPreset")} />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.isGlobal ? "🌐 " : ""}
                    {p.name} ({p.actions.length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cleaned.length === 0}
            onClick={() => setShowSave((s) => !s)}
            className="h-8 gap-1.5 rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white hover:border-[#5865F2] hover:bg-[#35373d]"
          >
            <Save className="h-3.5 w-3.5" />
            {t("bots.ra.saveAsPreset")}
          </Button>
        </div>

        {showSave && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
                placeholder={t("bots.ra.presetName")}
                className="h-8 rounded-lg border border-[#313338] bg-[#2b2d31] text-xs text-white placeholder:text-[#6d6f78]"
                aria-label={t("bots.ra.presetName")}
              />
              <Button
                type="button"
                size="sm"
                disabled={!presetName.trim() || savingPreset}
                onClick={handleSavePreset}
                className="h-8 shrink-0 rounded-lg text-xs"
              >
                {savingPreset ? t("common.saving") : t("common.save")}
              </Button>
            </div>
            {server?.host.trim() && (
              <label className="flex items-center gap-2 text-[11px] text-[#949ba4]">
                <input
                  type="checkbox"
                  checked={includeServer}
                  onChange={(e) => setIncludeServer(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[#313338] accent-[#5865F2]"
                />
                {t("bots.ra.includeServer", {
                  server: `${server.host.trim()}:${server.port || "25565"}`,
                })}
              </label>
            )}
          </div>
        )}

        {presets.some((p) => !p.isGlobal) && (
          <div className="flex flex-wrap gap-1.5">
            {presets
              .filter((p) => !p.isGlobal)
              .map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-md border border-[#313338] bg-[#2b2d31] px-2 py-1 text-[10px] text-[#949ba4]"
                >
                  {p.name}
                  <button
                    type="button"
                    onClick={() => handleDeletePreset(p.id)}
                    className="text-[#6d6f78] transition-colors hover:text-red-400"
                    aria-label={t("bots.ra.deletePresetAria", { name: p.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border border-[#313338] bg-[#1e1f22] p-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-white">
          <span className="grid h-6 w-6 place-items-center rounded-lg border border-[#313338] bg-[#2b2d31] text-[#949ba4]">
            {icon}
          </span>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
        </div>
        {hint && <p className="text-xs text-[#949ba4]">{hint}</p>}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  );
}

// --- Small primitives -------------------------------------------------------

const AUTH_MODES: {
  value: BotFormState["authMode"];
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "microsoft",
    labelKey: "bots.auth.microsoft",
    descKey: "bots.auth.microsoftDesc",
    icon: <KeyRound className="h-4 w-4" />,
  },
  {
    value: "offline",
    labelKey: "bots.auth.offline",
    descKey: "bots.auth.offlineDesc",
    icon: <UserX className="h-4 w-4" />,
  },
  {
    value: "ssid",
    labelKey: "bots.auth.ssid",
    descKey: "bots.auth.ssidDesc",
    icon: <Globe className="h-4 w-4" />,
  },
];

/** Visual segmented picker for the auth mode — Discord dark cards. */
function AuthModePicker({
  value,
  onChange,
}: {
  value: BotFormState["authMode"];
  onChange: (v: BotFormState["authMode"]) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label className="text-xs text-[#949ba4]">
        {t("bots.field.authMode")}
      </Label>
      <div className="grid gap-2 sm:grid-cols-3">
        {AUTH_MODES.map((m) => {
          const active = value === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => onChange(m.value)}
              aria-pressed={active}
              className={[
                "flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all duration-150",
                active
                  ? "border-[#5865F2] bg-[#5865F2]/10 shadow-[0_0_0_1px_#5865F2,0_4px_16px_rgba(88,101,242,0.25)]"
                  : "border-[#313338] bg-[#2b2d31] hover:border-[#4f4147] hover:bg-[#35373d]",
              ].join(" ")}
            >
              <span
                className={[
                  "grid h-8 w-8 place-items-center rounded-lg border",
                  active
                    ? "border-[#5865F2]/50 bg-[#5865F2]/15 text-white"
                    : "border-[#313338] bg-[#1e1f22] text-[#949ba4]",
                ].join(" ")}
              >
                {m.icon}
              </span>
              <span className={`text-xs font-semibold ${active ? "text-white" : "text-[#e3e5e8]"}`}>
                {t(m.labelKey)}
              </span>
              <span className="text-[11px] leading-snug text-[#949ba4]">
                {t(m.descKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[#949ba4]">{label}</Label>
      {children}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-[#313338] bg-[#2b2d31] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#b5bac1]">
      {children}
    </span>
  );
}

function CapacityTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#313338] bg-[#1e1f22] px-5 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-[#949ba4]">
        <span className="grid h-6 w-6 place-items-center rounded-lg border border-[#313338] bg-[#2b2d31] text-[#949ba4]">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight text-white tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-[#6d6f78]">{sub}</p>}
    </div>
  );
}

/** Strip ANSI color codes the Rust bot emits so the web console stays clean. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
