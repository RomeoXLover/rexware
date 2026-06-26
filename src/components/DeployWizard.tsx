"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight,
  ChevronLeft,
  Check,
  Bot,
  Server,
  KeyRound,
  Wifi,
  User,
  Shield,
  AlertCircle,
  Loader2,
  Play,
  Plus,
} from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { createBot, BOT_MC_VERSIONS, type PublicBot } from "@/lib/api/bots.functions";
import { useT } from "@/lib/preferences";

interface DeployWizardProps {
  open: boolean;
  onClose: () => void;
  onDeployed?: (bot: PublicBot) => void;
}

type AuthMode = "ssid" | "microsoft" | "offline";

const MC_VERSIONS = BOT_MC_VERSIONS;

const STEPS = [
  { id: "auth", label: "Account", icon: KeyRound },
  { id: "server", label: "Server", icon: Server },
  { id: "config", label: "Config", icon: Bot },
  { id: "review", label: "Deploy", icon: Play },
] as const;

type Step = (typeof STEPS)[number]["id"];

function AuthModeCard({
  mode,
  selected,
  onSelect,
  description,
  icon: Icon,
}: {
  mode: AuthMode;
  selected: boolean;
  onSelect: (m: AuthMode) => void;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={`group relative flex flex-col items-center gap-3 rounded-2xl border-2 p-5 text-center transition-all duration-200 cursor-pointer
        ${selected
          ? "border-primary bg-primary/10 shadow-[0_0_24px_oklch(0.55_0.15_280/0.2)]"
          : "border-border/50 bg-card/30 hover:border-border hover:bg-card/50"
        }`}
    >
      {selected && (
        <div className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
          <Check className="h-3 w-3 text-primary-foreground" />
        </div>
      )}
      <div className={`grid h-12 w-12 place-items-center rounded-xl transition-colors ${selected ? "bg-primary/20" : "bg-card/60"}`}>
        <Icon className={`h-6 w-6 ${selected ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div>
        <p className={`font-semibold text-sm ${selected ? "text-primary" : ""}`}>
          {mode === "ssid" ? "Session ID (SSID)" : mode === "microsoft" ? "Microsoft" : "Offline"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </button>
  );
}

interface FormState {
  name: string;
  authMode: AuthMode;
  // SSID
  ssid: string;
  uuid: string;
  // Microsoft
  accessToken: string;
  // Offline
  mcUsername: string;
  // Server
  serverHost: string;
  serverPort: string;
  mcVersion: string;
  // Behaviour
  message: string;
  reply: string;
  triggerKeyword: string;
  webhookUrl: string;
  messageInterval: string;
  replyDelay: string;
  afkInterval: string;
}

const emptyForm: FormState = {
  name: "",
  authMode: "ssid",
  ssid: "",
  uuid: "",
  accessToken: "",
  mcUsername: "",
  serverHost: "",
  serverPort: "25565",
  mcVersion: "1.21.1",
  message: "888 to join my server",
  reply: "",
  triggerKeyword: "",
  webhookUrl: "",
  messageInterval: "30",
  replyDelay: "5",
  afkInterval: "20",
};

function num(s: string) {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function DeployWizard({ open, onClose, onDeployed }: DeployWizardProps) {
  const t = useT();
  const [step, setStep] = useState<Step>("auth");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentIndex = STEPS.findIndex((s) => s.id === step);

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const handleClose = useCallback(() => {
    if (saving) return;
    setStep("auth");
    setForm(emptyForm);
    setError(null);
    onClose();
  }, [saving, onClose]);

  function canAdvance(): boolean {
    if (step === "auth") {
      if (form.authMode === "ssid") return form.ssid.trim().length > 0;
      if (form.authMode === "microsoft") return true; // accessToken optional
      if (form.authMode === "offline") return form.mcUsername.trim().length > 0;
    }
    if (step === "server") {
      return form.serverHost.trim().length > 0;
    }
    return true;
  }

  async function handleDeploy() {
    setSaving(true);
    setError(null);
    try {
      const bot = await createBot({
        data: {
          name: form.name.trim() || `Bot-${Date.now()}`,
          mcUsername: form.mcUsername.trim() || "",
          serverHost: form.serverHost.trim(),
          serverPort: Number(form.serverPort) || 25565,
          mcVersion: form.mcVersion as (typeof BOT_MC_VERSIONS)[number],
          authMode: form.authMode,
          accessToken: form.accessToken.trim() || undefined,
          ssid: form.ssid.trim() || undefined,
          uuid: form.uuid.trim() || undefined,
          message: form.message.trim() || undefined,
          reply: form.reply.trim() ? [form.reply.trim()] : undefined,
          triggerKeyword: form.triggerKeyword.trim() || undefined,
          webhookUrl: form.webhookUrl.trim() || undefined,
          messageInterval: num(form.messageInterval),
          replyDelay: num(form.replyDelay),
          afkInterval: num(form.afkInterval),
        },
      });
      onDeployed?.(bot as unknown as PublicBot);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deploy bot");
    } finally {
      setSaving(false);
    }
  }

  const authLabel =
    form.authMode === "ssid"
      ? "Paste your Minecraft session token"
      : form.authMode === "microsoft"
      ? "Optional: paste MSA access token"
      : "Enter a Minecraft username";

  return (
    <Drawer open={open} onOpenChange={(o) => !o && handleClose()}>
      <DrawerContent className="border-border/50 bg-card/95 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-2">
          {/* Header */}
          <DrawerHeader className="px-0 pt-0 pb-4">
            <DrawerTitle className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-xl bg-primary/20">
                <Plus className="h-4 w-4 text-primary" />
              </div>
              Deploy Bot
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              Set up a new Minecraft bot in a few steps
            </DrawerDescription>
          </DrawerHeader>

          {/* Step indicator */}
          <div className="mb-6 flex items-center gap-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isDone = i < currentIndex;
              const isActive = i === currentIndex;
              return (
                <div key={s.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => i < currentIndex && setStep(s.id)}
                    disabled={i > currentIndex}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all cursor-pointer
                      ${isDone ? "text-primary bg-primary/10 cursor-pointer" : ""}
                      ${isActive ? "text-primary-foreground bg-primary shadow-[0_0_16px_oklch(0.55_0.15_280/0.4)]" : ""}
                      ${!isDone && !isActive ? "text-muted-foreground bg-card/50 cursor-not-allowed" : ""}
                    `}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Icon className="h-3 w-3" />
                    )}
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={`h-px w-4 ${i < currentIndex ? "bg-primary/40" : "bg-border/40"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Step content */}
          <div className="space-y-4">

            {/* STEP 1: Auth Mode */}
            {step === "auth" && (
              <>
                {/* Bot name */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Bot Name</Label>
                  <Input
                    placeholder="My Awesome Bot"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    className="h-9 bg-card/50 text-sm"
                  />
                </div>

                {/* Auth mode picker */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Authentication</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <AuthModeCard
                      mode="ssid"
                      selected={form.authMode === "ssid"}
                      onSelect={(m) => set("authMode", m)}
                      description="Premium server session token — no Microsoft login needed"
                      icon={KeyRound}
                    />
                    <AuthModeCard
                      mode="microsoft"
                      selected={form.authMode === "microsoft"}
                      onSelect={(m) => set("authMode", m)}
                      description="Full Microsoft OAuth login via browser"
                      icon={Shield}
                    />
                    <AuthModeCard
                      mode="offline"
                      selected={form.authMode === "offline"}
                      onSelect={(m) => set("authMode", m)}
                      description="Cracked / offline servers only"
                      icon={User}
                    />
                  </div>
                </div>

                {/* Auth fields */}
                {form.authMode === "ssid" && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Session Token (SSID)</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground cursor-help">
                              <AlertCircle className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Open Minecraft → Edit Profile → click the session token shown in the URL. Requires a valid premium account.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        placeholder="a]Mc~..."
                        value={form.ssid}
                        onChange={(e) => set("ssid", e.target.value)}
                        className="h-9 bg-card/50 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">UUID <span className="text-muted-foreground font-normal">(optional, leave blank for random)</span></Label>
                      <Input
                        placeholder="Leave blank for random UUID"
                        value={form.uuid}
                        onChange={(e) => set("uuid", e.target.value)}
                        className="h-9 bg-card/50 font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                {form.authMode === "microsoft" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">MSA Access Token <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" className="text-muted-foreground/50 hover:text-muted-foreground cursor-help">
                            <AlertCircle className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          If you already have a Microsoft access token you can paste it here. Otherwise, the system will generate one automatically.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Input
                      placeholder="Leave blank to auto-generate via browser"
                      value={form.accessToken}
                      onChange={(e) => set("accessToken", e.target.value)}
                      className="h-9 bg-card/50 font-mono text-xs"
                    />
                  </div>
                )}

                {form.authMode === "offline" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Minecraft Username</Label>
                    <Input
                      placeholder="Steve"
                      value={form.mcUsername}
                      onChange={(e) => set("mcUsername", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      No authentication needed — use this for cracked/offline servers only.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* STEP 2: Server */}
            {step === "server" && (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Server Address</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="mc.hypixel.net"
                        value={form.serverHost}
                        onChange={(e) => set("serverHost", e.target.value)}
                        className="h-9 bg-card/50 text-sm flex-1"
                      />
                      <Input
                        placeholder="25565"
                        value={form.serverPort}
                        onChange={(e) => set("serverPort", e.target.value)}
                        className="h-9 bg-card/50 text-sm w-24 text-center font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Minecraft Version</Label>
                    <Select value={form.mcVersion} onValueChange={(v) => set("mcVersion", v)}>
                      <SelectTrigger className="h-9 bg-card/50 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MC_VERSIONS.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {/* STEP 3: Config */}
            {step === "config" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium">Spam Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      placeholder="888 to join my server"
                      value={form.message}
                      onChange={(e) => set("message", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Trigger Keyword <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      placeholder="888"
                      value={form.triggerKeyword}
                      onChange={(e) => set("triggerKeyword", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Reply Message <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      placeholder="add me on discord"
                      value={form.reply}
                      onChange={(e) => set("reply", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Msg Interval (s)</Label>
                    <Input
                      placeholder="30"
                      value={form.messageInterval}
                      onChange={(e) => set("messageInterval", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Reply Delay (s)</Label>
                    <Input
                      placeholder="5"
                      value={form.replyDelay}
                      onChange={(e) => set("replyDelay", e.target.value)}
                      className="h-9 bg-card/50 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-medium">Discord Webhook <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input
                      placeholder="https://discord.com/api/webhooks/..."
                      value={form.webhookUrl}
                      onChange={(e) => set("webhookUrl", e.target.value)}
                      className="h-9 bg-card/50 text-sm font-mono"
                    />
                  </div>
                </div>
              </>
            )}

            {/* STEP 4: Review */}
            {step === "review" && (
              <>
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Review Configuration</p>
                    <ReviewRow label="Bot Name" value={form.name || `Bot-${Date.now()}`} />
                    <ReviewRow label="Auth Mode" value={form.authMode.toUpperCase()} />
                    {form.authMode === "ssid" && form.ssid && (
                      <ReviewRow label="SSID" value={form.ssid.slice(0, 12) + "..."} />
                    )}
                    {form.authMode === "offline" && (
                      <ReviewRow label="Username" value={form.mcUsername} />
                    )}
                    <ReviewRow label="Server" value={`${form.serverHost}:${form.serverPort}`} />
                    <ReviewRow label="Version" value={form.mcVersion} />
                    {form.message && <ReviewRow label="Spam Msg" value={form.message} />}
                    {form.triggerKeyword && <ReviewRow label="Trigger" value={form.triggerKeyword} />}
                    {form.reply && <ReviewRow label="Reply" value={form.reply} />}
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-400 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer navigation */}
          <DrawerFooter className="px-0 pt-4 flex-row items-center gap-2">
            {currentIndex > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs h-9"
                onClick={() => setStep(STEPS[currentIndex - 1].id)}
                disabled={saving}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            <div className="flex-1" />
            {currentIndex < STEPS.length - 1 ? (
              <Button
                size="sm"
                className="gap-1.5 text-xs h-9 shadow-[0_0_16px_oklch(0.55_0.15_280/0.3)]"
                onClick={() => setStep(STEPS[currentIndex + 1].id)}
                disabled={!canAdvance()}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5 text-xs h-9 bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_16px_oklch(0.6_0.15_145/0.3)]"
                onClick={handleDeploy}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Deploy Now
                  </>
                )}
              </Button>
            )}
          </DrawerFooter>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground/80 font-mono truncate ml-auto max-w-[200px]">{value}</span>
    </div>
  );
}
