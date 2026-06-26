import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  Megaphone,
  CreditCard,
  User,
  Mail,
  Copy,
  CheckCircle2,
  CalendarDays,
  Layers,
  KeyRound,
  AlertCircle,
  LogOut,
  Sparkles,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Moon,
  Languages,
  Coins,
  Palette,
  Sparkle,
  MousePointer,
  Sliders,
  Grid3x3,
  Circle,
  Waves,
  LayoutGrid,
} from "lucide-react";
import {
  usePreferences,
  CURRENCIES,
  type Theme,
  type NexoraTheme,
  type BgEffect,
  type SaturationLevel,
} from "@/lib/preferences";
import { LANGUAGES, type Language } from "@/lib/i18n/dictionaries";
import { AdminOtpCard } from "@/components/AdminOtpCard";
import type { SessionUser } from "@/lib/auth.server";
import type {
  UserSettingsRow,
  SubscriptionRow,
  PlanRow,
} from "@/lib/repos.server";
import { updateSettings } from "@/lib/api/dashboard.functions";
import { redeemKey } from "@/lib/api/keys.functions";
import { logout } from "@/lib/api/auth.functions";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: SessionUser | null;
  settings: UserSettingsRow | null;
  onSettingsUpdated?: (s: UserSettingsRow) => void;
  isAdmin?: boolean;
  currentSubscription?: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
}

export function SettingsDialog({
  open,
  onOpenChange,
  user,
  settings,
  onSettingsUpdated,
  isAdmin = false,
  currentSubscription,
}: SettingsDialogProps) {
  const router = useRouter();
  const {
    theme,
    language,
    currency,
    nexoraTheme,
    bgEffect,
    saturation,
    hoverEnabled,
    setTheme,
    setLanguage,
    setCurrency,
    setNexoraTheme,
    setBgEffect,
    setSaturation,
    setHoverEnabled,
    t,
  } = usePreferences();
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<"id" | "email" | null>(null);
  const [keyCode, setKeyCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [redeemMsg, setRedeemMsg] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);
  const [local, setLocal] = useState({
    notify_payments: true,
    notify_bots: true,
    notify_announcements: true,
  });

  useEffect(() => {
    if (settings) {
      setLocal({
        notify_payments: settings.notify_payments === 1,
        notify_bots: settings.notify_bots === 1,
        notify_announcements: settings.notify_announcements === 1,
      });
    }
  }, [settings]);

  async function handleToggle(
    key: "notify_payments" | "notify_bots" | "notify_announcements",
  ) {
    const next = !local[key];
    setLocal((p) => ({ ...p, [key]: next }));
    setSaving(true);
    try {
      const updated = await updateSettings({ data: { [key]: next ? 1 : 0 } });
      onSettingsUpdated?.(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleRedeem() {
    if (!keyCode.trim() || redeeming) return;
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      const res = await redeemKey({ data: { code: keyCode.trim() } });
      setRedeemMsg({
        kind: "ok",
        text:
          res.kind === "subscription"
            ? `Unlocked the ${res.label} subscription.`
            : `Unlocked the ${res.label} plugin.`,
      });
      setKeyCode("");
      router.invalidate();
    } catch (err) {
      setRedeemMsg({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to redeem key",
      });
    } finally {
      setRedeeming(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      onOpenChange(false);
      await router.navigate({ to: "/" });
      router.invalidate();
    } finally {
      setLoggingOut(false);
    }
  }

  async function copyValue(value: string, which: "id" | "email") {
    await navigator.clipboard.writeText(value);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  if (!user) return null;

  const sub = currentSubscription;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" style={{overflow: 'hidden'}}>
        {/* Hero header */}
        <div className="space-y-0 border-b px-8 py-6" style={{borderColor: 'oklch(0.80 0.09 264 / 0.15)'}}>
          <h2 className="text-2xl font-semibold tracking-tight" style={{color: 'rgba(255,255,255,0.95)'}}>
            {t("settings.title")}
          </h2>
          <p className="mt-1 text-sm" style={{color: 'rgba(255,255,255,0.45)'}}>
            {t("settings.subtitle")}
          </p>

          {/* Account summary */}
          <div className="mt-5 flex items-center gap-4 rounded-2xl border border-[oklch(0.80_0.09_264/0.15)] bg-[oklch(0.22_0.02_264/0.4)] p-4">
            <Avatar className="h-14 w-14 shrink-0 ring-1 ring-white/10">
              <AvatarImage
                src={user.avatarUrl}
                alt={user.username}
                crossOrigin="anonymous"
              />
              <AvatarFallback>
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">
                {user.globalName ?? user.username}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                @{user.username}
              </p>
            </div>
            {sub?.plan ? (
              <Badge className="shrink-0 gap-1 border-green-500/30 bg-green-500/10 text-green-400">
                <Sparkles className="h-3 w-3" />
                {sub.plan.name}
              </Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 gap-1 text-xs">
                <User className="h-3 w-3" />
                Free
              </Badge>
            )}
          </div>
        </div>

        {/* Tabbed body */}
        <Tabs defaultValue="account" className="px-8 pb-8">
          <TabsList
            className={`grid h-auto w-full gap-1 ${isAdmin ? "grid-cols-6" : "grid-cols-5"}`}
          >
            <TabsTrigger value="account" className="gap-1.5 py-2 text-xs">
              <User className="h-3.5 w-3.5" />
              Account
            </TabsTrigger>
            <TabsTrigger value="subscription" className="gap-1.5 py-2 text-xs">
              <CreditCard className="h-3.5 w-3.5" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5 py-2 text-xs">
              <Bell className="h-3.5 w-3.5" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="preferences" className="gap-1.5 py-2 text-xs">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Prefs
            </TabsTrigger>
            <TabsTrigger value="themes" className="gap-1.5 py-2 text-xs">
              <Palette className="h-3.5 w-3.5" />
              Themes
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin-otp" className="gap-1.5 py-2 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" />
                Admin
              </TabsTrigger>
            )}
          </TabsList>

          {/* ---------------- ACCOUNT ---------------- */}
          <TabsContent value="account" className="space-y-6 pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailCard
                icon={<User className="h-4 w-4" />}
                label="Discord ID"
                value={user.id}
                mono
                onCopy={() => copyValue(user.id, "id")}
                copied={copied === "id"}
              />
              {user.email && (
                <DetailCard
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  value={user.email}
                  onCopy={() => copyValue(user.email!, "email")}
                  copied={copied === "email"}
                />
              )}
            </div>

            {/* Sign out */}
            <div style={{borderRadius: '1.25rem', background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)', padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem'}}>
              <div style={{minWidth: 0}}>
                <p className="text-sm font-medium" style={{color: 'rgba(255,255,255,0.85)'}}>{t("settings.signOut")}</p>
                <p className="text-xs" style={{color: 'rgba(255,255,255,0.35)'}}>
                  {t("settings.signOutDesc")}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={handleLogout}
                disabled={loggingOut}
                style={{borderRadius: '0.75rem', border: '1px solid rgba(239,68,68,0.3)', color: 'rgba(252,165,165,1)', background: 'transparent', gap: '0.375rem', flexShrink: 0}}
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? t("settings.signingOut") : t("settings.signOut")}
              </Button>
            </div>
          </TabsContent>

          {/* ---------------- SUBSCRIPTION ---------------- */}
          <TabsContent value="subscription" className="space-y-6 pt-6">
            {sub?.plan ? (
              <div style={{borderRadius: '1.25rem', border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.06)', padding: '1.5rem'}}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" style={{color: 'rgba(134,239,172,1)'}} />
                  <span className="text-lg font-semibold" style={{color: 'rgba(255,255,255,0.9)'}}>{sub.plan.name}</span>
                  <span style={{display: 'inline-flex', alignItems: 'center', gap: '0.25rem', borderRadius: '0.5rem', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.1)', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'rgba(134,239,172,1)', textTransform: 'capitalize', marginLeft: 'auto'}}>
                    {sub.subscription.status}
                  </span>
                </div>
                <div className="mt-5 grid gap-4 sm:grid-cols-3">
                  <Stat
                    icon={<CreditCard className="h-4 w-4" />}
                    label="Price"
                    value={`$${sub.plan.price_usd}/${sub.plan.interval}`}
                  />
                  <Stat
                    icon={<Layers className="h-4 w-4" />}
                    label="Limits"
                    value={`${sub.plan.max_bots} bots · ${sub.plan.max_proxies} proxies`}
                  />
                  {sub.subscription.expires_at && (
                    <Stat
                      icon={<CalendarDays className="h-4 w-4" />}
                      label="Expires"
                      value={new Date(
                        sub.subscription.expires_at,
                      ).toLocaleDateString()}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div style={{borderRadius: '1.25rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '2rem 1.5rem', textAlign: 'center'}}>
                <CreditCard className="mx-auto h-8 w-8" style={{color: 'rgba(255,255,255,0.2)'}} />
                <p className="mt-3 text-sm font-medium" style={{color: 'rgba(255,255,255,0.7)'}}>
                  No active subscription
                </p>
                <p className="mt-1 text-xs" style={{color: 'rgba(255,255,255,0.3)'}}>
                  Redeem a key below to unlock a plan or plugin.
                </p>
              </div>
            )}

            {/* Redeem key */}
            <div style={{borderRadius: '1.25rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '1.5rem'}}>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" style={{color: 'rgba(255,255,255,0.4)'}} />
                <p className="text-sm font-semibold" style={{color: 'rgba(255,255,255,0.85)'}}>{t("settings.redeem.title")}</p>
              </div>
              <p className="mt-1 text-xs" style={{color: 'rgba(255,255,255,0.35)'}}>
                {t("settings.redeem.hint")}
              </p>
              <div className="mt-4 flex gap-2">
                <Input
                  value={keyCode}
                  onChange={(e) => {
                    setKeyCode(e.target.value.toUpperCase());
                    setRedeemMsg(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="font-mono uppercase tracking-wider"
                  aria-label="Redeem key code"
                />
                <Button
                  onClick={handleRedeem}
                  disabled={redeeming || !keyCode.trim()}
                  className="shrink-0 gap-1.5"
                >
                  <KeyRound className="h-4 w-4" />
                  {redeeming ? "Redeeming…" : "Redeem"}
                </Button>
              </div>
              {redeemMsg && (
                <div
                  style={{
                    marginTop: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    borderRadius: '0.5rem',
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.75rem',
                    ...(redeemMsg.kind === "ok"
                      ? { background: 'rgba(34,197,94,0.1)', color: 'rgba(134,239,172,1)', border: '1px solid rgba(34,197,94,0.25)' }
                      : { background: 'rgba(239,68,68,0.1)', color: 'rgba(252,165,165,1)', border: '1px solid rgba(239,68,68,0.25)' }),
                  }}
                >
                  {redeemMsg.kind === "ok" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>{redeemMsg.text}</span>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ---------------- NOTIFICATIONS ---------------- */}
          <TabsContent value="notifications" className="space-y-3 pt-6">
            <ToggleRow
              icon={<CreditCard className="h-4 w-4 text-muted-foreground" />}
              label={t("settings.notify.payments")}
              description={t("settings.notify.paymentsDesc")}
              checked={local.notify_payments}
              onCheckedChange={() => handleToggle("notify_payments")}
              disabled={saving}
            />
            <ToggleRow
              icon={<Bot className="h-4 w-4 text-muted-foreground" />}
              label={t("settings.notify.bots")}
              description={t("settings.notify.botsDesc")}
              checked={local.notify_bots}
              onCheckedChange={() => handleToggle("notify_bots")}
              disabled={saving}
            />
            <ToggleRow
              icon={<Megaphone className="h-4 w-4 text-muted-foreground" />}
              label={t("settings.notify.announcements")}
              description={t("settings.notify.announcementsDesc")}
              checked={local.notify_announcements}
              onCheckedChange={() => handleToggle("notify_announcements")}
              disabled={saving}
            />
            <p className="pt-2 text-xs text-muted-foreground">
              {t("settings.notify.autosave")}
            </p>
          </TabsContent>

          {/* ---------------- PREFERENCES ---------------- */}
          <TabsContent value="preferences" className="space-y-6 pt-6">
            <div>
              <h3 className="text-sm font-semibold">
                {t("settings.prefs.title")}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settings.prefs.subtitle")}
              </p>
            </div>

            {/* Theme */}
            <div className="rounded-2xl bg-muted/20 p-5">
              <div className="flex items-center gap-2">
                {theme === "dark" ? (
                  <Moon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Sun className="h-4 w-4 text-muted-foreground" />
                )}
                <p className="text-sm font-medium">
                  {t("settings.prefs.theme")}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.prefs.themeHint")}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {(["dark", "light"] as Theme[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setTheme(opt)}
                    className={[
                      "flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                      theme === opt
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/50 bg-background/40 text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                    aria-pressed={theme === opt}
                  >
                    {opt === "dark" ? (
                      <Moon className="h-4 w-4" />
                    ) : (
                      <Sun className="h-4 w-4" />
                    )}
                    {t(`settings.prefs.theme.${opt}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Language */}
            <div className="rounded-2xl bg-muted/20 p-5">
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {t("settings.prefs.language")}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.prefs.languageHint")}
              </p>
              <Select
                value={language}
                onValueChange={(v) => setLanguage(v as Language)}
              >
                <SelectTrigger className="mt-4">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      <span className="mr-2">{l.flag}</span>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Currency */}
            <div className="rounded-2xl bg-muted/20 p-5">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {t("settings.prefs.currency")}
                </p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.prefs.currencyHint")}
              </p>
              <Select
                value={currency}
                onValueChange={(v) =>
                  setCurrency(v as (typeof CURRENCIES)[number]["code"])
                }
              >
                <SelectTrigger className="mt-4">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      <span className="mr-2 font-mono">{c.symbol}</span>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          {/* ---------------- THEMES ---------------- */}
          <TabsContent value="themes" className="space-y-6 pt-6">
            {/* Colour Themes */}
            <div style={{borderRadius: '1.25rem', background: 'oklch(0.22 0.02 264 / 0.4)', border: '1px solid oklch(0.80 0.09 264 / 0.12)', padding: '1.5rem'}}>
              <div className="flex items-center gap-2 mb-4">
                <Palette className="h-4 w-4 text-white/50" />
                <div>
                  <p className="text-sm font-semibold text-white/90">Colour Themes</p>
                  <p className="text-xs text-white/40">
                    Pick a palette that matches your vibe.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <ThemeSwatch
                  label="Nexora"
                  value="nexora"
                  swatchA="#8250F0"
                  swatchB="#7C5CFF"
                  current={nexoraTheme}
                  onSelect={setNexoraTheme}
                />
                <ThemeSwatch
                  label="Dark"
                  value="dark"
                  swatchA="#2A2A3A"
                  swatchB="#3D3D52"
                  current={nexoraTheme}
                  onSelect={setNexoraTheme}
                />
                <ThemeSwatch
                  label="Neon"
                  value="neon"
                  swatchA="#E040FB"
                  swatchB="#00E5FF"
                  current={nexoraTheme}
                  onSelect={setNexoraTheme}
                />
                <ThemeSwatch
                  label="Forest"
                  value="forest"
                  swatchA="#2D6A4F"
                  swatchB="#52B788"
                  current={nexoraTheme}
                  onSelect={setNexoraTheme}
                />
                <ThemeSwatch
                  label="Sunset"
                  value="sunset"
                  swatchA="#FF8C42"
                  swatchB="#FF6B6B"
                  current={nexoraTheme}
                  onSelect={setNexoraTheme}
                />
              </div>
            </div>

            {/* Background Effects */}
            <div style={{borderRadius: '1.25rem', background: 'oklch(0.22 0.02 264 / 0.4)', border: '1px solid oklch(0.80 0.09 264 / 0.12)', padding: '1.5rem'}}>
              <div className="flex items-center gap-2 mb-4">
                <Sparkle className="h-4 w-4 text-white/50" />
                <div>
                  <p className="text-sm font-semibold text-white/90">Background Effects</p>
                  <p className="text-xs text-white/40">
                    Choose the ambience behind your dashboard.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <BgEffectCard
                  label="Mesh"
                  value="mesh"
                  current={bgEffect}
                  onSelect={setBgEffect}
                  icon={<LayoutGrid className="h-5 w-5 text-white/50" />}
                  desc="Floating colour orbs"
                />
                <BgEffectCard
                  label="Stars"
                  value="stars"
                  current={bgEffect}
                  onSelect={setBgEffect}
                  icon={<Circle className="h-5 w-5 text-white/50" style={{fontSize: 8}} />}
                  desc="Starry night sky"
                />
                <BgEffectCard
                  label="Waves"
                  value="waves"
                  current={bgEffect}
                  onSelect={setBgEffect}
                  icon={<Waves className="h-5 w-5 text-white/50" />}
                  desc="Calm wave motion"
                />
                <BgEffectCard
                  label="Dots"
                  value="dots"
                  current={bgEffect}
                  onSelect={setBgEffect}
                  icon={<Grid3x3 className="h-5 w-5 text-white/50" />}
                  desc="Dot grid pattern"
                />
                <BgEffectCard
                  label="Minimal"
                  value="minimal"
                  current={bgEffect}
                  onSelect={setBgEffect}
                  icon={<Sliders className="h-5 w-5 text-white/50" />}
                  desc="Clean, no effects"
                />
              </div>
            </div>

            {/* Saturation */}
            <div style={{borderRadius: '1.25rem', background: 'oklch(0.22 0.02 264 / 0.4)', border: '1px solid oklch(0.80 0.09 264 / 0.12)', padding: '1.5rem'}}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-white/50" />
                  <div>
                    <p className="text-sm font-semibold text-white/90">Saturation</p>
                    <p className="text-xs text-white/40">
                      Adjust colour intensity of the background.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-medium text-white/40 capitalize">
                  {saturation}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="3"
                step="1"
                className="nex-slider"
                value={
                  saturation === "low"
                    ? 0
                    : saturation === "mid"
                      ? 1
                      : saturation === "high"
                        ? 2
                        : 3
                }
                onChange={(e) => {
                  const map = ["low", "mid", "high", "max"] as SaturationLevel[];
                  setSaturation(map[Number(e.target.value)]);
                }}
                aria-label="Saturation level"
              />
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-white/40">Muted</span>
                <span className="text-[10px] text-white/40">Vivid</span>
              </div>
            </div>

            {/* Hover Effects */}
            <div style={{borderRadius: '1.25rem', background: 'oklch(0.22 0.02 264 / 0.4)', border: '1px solid oklch(0.80 0.09 264 / 0.12)', padding: '1.5rem'}}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MousePointer className="h-4 w-4 text-white/50" />
                  <div>
                    <p className="text-sm font-semibold text-white/90">Hover Effects</p>
                    <p className="text-xs text-white/40">
                      Card lifts, sheen sweeps, and tilt animations.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hoverEnabled}
                  onClick={() => setHoverEnabled(!hoverEnabled)}
                  className={`nex-toggle ${hoverEnabled ? "on" : ""}`}
                >
                  <span className="nex-toggle-knob" />
                </button>
              </div>
            </div>
          </TabsContent>

          {/* ---------------- ADMIN OTP ---------------- */}
          {isAdmin && (
            <TabsContent value="admin-otp" className="space-y-4 pt-6">
              <AdminOtpCard />
              <p className="px-1 text-xs text-muted-foreground">
                This rotating code is your second factor for protected bot
                actions (bans, key generation, and other destructive commands).
                The bot will ask for it before running them.
              </p>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DetailCard({
  icon,
  label,
  value,
  mono,
  onCopy,
  copied,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div style={{borderRadius: '1.25rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '1.25rem'}}>
      <div className="flex items-center gap-2" style={{color: 'rgba(255,255,255,0.45)'}}>
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-widest">
          {label}
        </span>
        <button
          type="button"
          className="ml-auto transition-colors duration-200 cursor-pointer"
          style={{color: 'rgba(255,255,255,0.35)'}}
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
        >
          {copied ? (
            <CheckCircle2 className="h-4 w-4" style={{color: 'rgba(134,239,172,1)'}} />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
      <p
        className={`mt-2 truncate text-sm font-medium ${mono ? "font-mono" : ""}`}
        style={{color: 'rgba(255,255,255,0.85)'}}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div style={{borderRadius: '1rem', background: 'rgba(255,255,255,0.04)', padding: '1rem', border: '1px solid rgba(255,255,255,0.07)'}}>
      <div className="flex items-center gap-1.5" style={{color: 'rgba(255,255,255,0.4)'}}>
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold" style={{color: 'rgba(255,255,255,0.88)'}}>{value}</p>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
}) {
  const id = `toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{borderRadius: '1.25rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem'}}>
      <div className="flex items-center gap-3" style={{minWidth: 0}}>
        {icon}
        <div style={{minWidth: 0}}>
          <label htmlFor={id} className="cursor-pointer text-sm font-medium" style={{color: 'rgba(255,255,255,0.85)'}}>
            {label}
          </label>
          <p className="text-xs" style={{color: 'rgba(255,255,255,0.38)'}}>{description}</p>
        </div>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  );
}

function ThemeSwatch({
  label,
  value,
  swatchA,
  swatchB,
  current,
  onSelect,
}: {
  label: string;
  value: NexoraTheme;
  swatchA: string;
  swatchB: string;
  current: NexoraTheme;
  onSelect: (v: NexoraTheme) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(value)}
        className={`nex-swatch ${current === value ? "active" : ""}`}
        aria-pressed={current === value}
        aria-label={`${label} theme`}
        title={label}
      >
        <span
          className="nex-swatch-inner"
          style={
            {
              "--swatch-a": swatchA,
              "--swatch-b": swatchB,
            } as React.CSSProperties
          }
        />
      </button>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function BgEffectCard({
  label,
  value,
  current,
  onSelect,
  icon,
  desc,
}: {
  label: string;
  value: BgEffect;
  current: BgEffect;
  onSelect: (v: BgEffect) => void;
  icon: React.ReactNode;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`nex-effect-card ${current === value ? "active" : ""} flex flex-col items-center gap-2 text-center`}
      aria-pressed={current === value}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-xs font-semibold leading-tight">{label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{desc}</p>
      </div>
    </button>
  );
}
