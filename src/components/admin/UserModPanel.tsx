import { useState, useEffect, type ReactNode } from "react";
import {
  Shield,
  ShieldOff,
  Sparkles,
  Ban,
  CheckCircle2,
  Gift,
  Container,
  Bot,
  Globe,
  Clock,
  Copy,
  Check,
  CreditCard,
  Activity,
  AlertTriangle,
  StickyNote,
  Plus,
  Trash2,
  XCircle,
  RefreshCw,
  Loader2,
  Network,
  Fingerprint,
  Users,
  ChevronDown,
  ExternalLink,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  adminGetUserDetail,
  adminSetAdmin,
  adminSetBanned,
  adminSetBeta,
  adminAddWarn,
  adminRemoveWarn,
  adminAddNote,
  adminRemoveNote,
  adminCancelSubscription,
  adminActivateSubscription,
  adminGetUserIps,
  adminGetUserAlts,
  adminGetBannedIps,
  adminBanIp,
  adminUnbanIp,
  adminDeleteUserData,
  type AdminUserDetail,
  type AdminUserAlt,
} from "@/lib/api/admin.functions";
import type { UserRow, UserIpRow } from "@/lib/repos.server";

// ---------------------------------------------------------------------------
// Confirmation popup used for destructive / privileged actions.
// ---------------------------------------------------------------------------

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void> | void;
}

function limitLabel(n: number): string {
  if (n < 0) return "∞";
  return String(n);
}

export function UserModPanel({
  user,
  currentUserId,
  onClose,
  onUserChange,
  onGift,
}: {
  user: UserRow;
  currentUserId: string;
  onClose: () => void;
  onUserChange: (patch: Partial<UserRow>) => void;
  onGift: (user: UserRow) => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [warnReason, setWarnReason] = useState("");
  const [noteContent, setNoteContent] = useState("");

  // IP history + alt accounts (loaded together, lazily on first open)
  const [ips, setIps] = useState<UserIpRow[] | null>(null);
  const [alts, setAlts] = useState<AdminUserAlt[] | null>(null);
  const [bannedIps, setBannedIps] = useState<Set<string>>(new Set());
  const [networkLoading, setNetworkLoading] = useState(false);
  const [showIps, setShowIps] = useState(false);

  const isSelf = user.id === currentUserId;
  // Track live status locally so badges/buttons update without a full reload.
  const [isAdmin, setIsAdmin] = useState(user.is_admin === 1);
  const [isBanned, setIsBanned] = useState(user.is_banned === 1);
  const [isBeta, setIsBeta] = useState(user.is_beta === 1);

  async function reload() {
    setLoading(true);
    try {
      const res = await adminGetUserDetail({ data: { userId: user.id } });
      setDetail(res);
    } finally {
      setLoading(false);
    }
  }

  async function loadNetwork() {
    setNetworkLoading(true);
    try {
      const [ipRows, altRows, bannedRows] = await Promise.all([
        adminGetUserIps({ data: { userId: user.id } }),
        adminGetUserAlts({ data: { userId: user.id } }),
        adminGetBannedIps(),
      ]);
      setIps(ipRows as UserIpRow[]);
      setAlts(altRows as AdminUserAlt[]);
      setBannedIps(new Set((bannedRows as { ip: string }[]).map((b) => b.ip)));
    } finally {
      setNetworkLoading(false);
    }
  }

  async function toggleIpBan(ip: string) {
    setFlag("ip:" + ip, true);
    try {
      if (bannedIps.has(ip)) {
        await adminUnbanIp({ data: { ip } });
      } else {
        await adminBanIp({ data: { ip, reason: `Banned via ${user.username}'s IP list` } });
      }
      await loadNetwork();
    } finally {
      setFlag("ip:" + ip, false);
    }
  }

  useEffect(() => {
    reload();
    loadNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function setFlag(key: string, v: boolean) {
    setBusy((m) => ({ ...m, [key]: v }));
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmRunning(true);
    try {
      await confirm.run();
      setConfirm(null);
    } finally {
      setConfirmRunning(false);
    }
  }

  // --- Mod actions ----------------------------------------------------------

  async function toggleAdmin() {
    setFlag("admin", true);
    try {
      await adminSetAdmin({ data: { userId: user.id, isAdmin: !isAdmin } });
      setIsAdmin(!isAdmin);
      onUserChange({ is_admin: isAdmin ? 0 : 1 });
    } finally {
      setFlag("admin", false);
    }
  }

  async function toggleBan() {
    setFlag("ban", true);
    try {
      await adminSetBanned({ data: { userId: user.id, banned: !isBanned } });
      setIsBanned(!isBanned);
      onUserChange({ is_banned: isBanned ? 0 : 1 });
    } finally {
      setFlag("ban", false);
    }
  }

  async function toggleBeta() {
    setFlag("beta", true);
    try {
      await adminSetBeta({ data: { userId: user.id, beta: !isBeta } });
      setIsBeta(!isBeta);
      onUserChange({ is_beta: isBeta ? 0 : 1 });
    } finally {
      setFlag("beta", false);
    }
  }

  async function addWarn() {
    if (!warnReason.trim()) return;
    setFlag("warn", true);
    try {
      await adminAddWarn({ data: { userId: user.id, reason: warnReason.trim() } });
      setWarnReason("");
      await reload();
    } finally {
      setFlag("warn", false);
    }
  }

  async function removeWarn(warnId: string) {
    setFlag("warn:" + warnId, true);
    try {
      await adminRemoveWarn({ data: { warnId, userId: user.id } });
      await reload();
    } finally {
      setFlag("warn:" + warnId, false);
    }
  }

  async function addNote() {
    if (!noteContent.trim()) return;
    setFlag("note", true);
    try {
      await adminAddNote({ data: { userId: user.id, content: noteContent.trim() } });
      setNoteContent("");
      await reload();
    } finally {
      setFlag("note", false);
    }
  }

  async function removeNote(noteId: string) {
    setFlag("note:" + noteId, true);
    try {
      await adminRemoveNote({ data: { noteId, userId: user.id } });
      await reload();
    } finally {
      setFlag("note:" + noteId, false);
    }
  }

  async function deleteUserData() {
    setFlag("deleteData", true);
    try {
      await adminDeleteUserData({ data: { userId: user.id } });
      onUserChange({ is_banned: 1, is_admin: 0 });
      onClose();
    } finally {
      setFlag("deleteData", false);
    }
  }

  async function cancelSub(subId: string) {
    setFlag("sub:" + subId, true);
    try {
      await adminCancelSubscription({ data: { subscriptionId: subId, userId: user.id } });
      await reload();
    } finally {
      setFlag("sub:" + subId, false);
    }
  }

  async function activateSub(subId: string) {
    setFlag("sub:" + subId, true);
    try {
      await adminActivateSubscription({ data: { subscriptionId: subId, userId: user.id, durationDays: 30 } });
      await reload();
    } finally {
      setFlag("sub:" + subId, false);
    }
  }

  const usage = detail?.usage;
  const hoursPct =
    usage && usage.maxHoursPerDay > 0
      ? Math.min(100, (usage.hoursUsedToday / usage.maxHoursPerDay) * 100)
      : 0;
  const botsPct =
    usage && usage.maxBots > 0
      ? Math.min(100, (usage.botsActive / usage.maxBots) * 100)
      : 0;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl border-border/60 bg-card/95 backdrop-blur-sm p-0 overflow-hidden">
          {/* Header */}
          <DialogHeader className="border-b border-border/50 bg-muted/20 px-8 pt-7 pb-6">
            <DialogTitle className="flex items-center gap-4">
              <Avatar className="h-14 w-14 ring-2 ring-border/60">
                {user.avatar_url && (
                  <AvatarImage src={user.avatar_url} crossOrigin="anonymous" alt={user.username} />
                )}
                <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-semibold">
                    {user.global_name ?? user.username}
                  </span>
                  {isAdmin && (
                    <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400 text-[10px]">
                      Admin
                    </Badge>
                  )}
                  {isBeta && (
                    <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-400 text-[10px]">
                      Beta
                    </Badge>
                  )}
                  {isBanned && (
                    <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400 text-[10px]">
                      Banned
                    </Badge>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(user.id);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="mt-0.5 flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy user ID"
                >
                  @{user.username} · {user.id}
                  {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[72vh] overflow-y-auto px-8 pb-8 pt-6 space-y-7">
            {loading || !detail ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading user…
              </div>
            ) : (
              <>
                {/* Subscription + usage cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Subscription */}
                  <ModCard
                    icon={<CreditCard className="h-4 w-4 text-emerald-400" />}
                    title="Subscription"
                  >
                    {detail.subscription ? (
                      <div className="space-y-1">
                        <p className="text-lg font-semibold">
                          {detail.subscription.plan?.name ?? detail.subscription.plan_id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {detail.subscription.expires_at
                            ? `Renews / expires ${new Date(detail.subscription.expires_at).toLocaleDateString()}`
                            : "No expiry"}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No active subscription</p>
                    )}
                  </ModCard>

                  {/* Daily bot-hours usage */}
                  <ModCard
                    icon={<Clock className="h-4 w-4 text-amber-400" />}
                    title="Daily bot-hours"
                  >
                    <div className="space-y-1.5">
                      <p className="text-lg font-semibold tabular-nums">
                        {usage!.hoursUsedToday}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}/ {limitLabel(usage!.maxHoursPerDay)} h
                        </span>
                      </p>
                      {usage!.maxHoursPerDay > 0 && (
                        <Progress value={hoursPct} className="h-1.5" />
                      )}
                    </div>
                  </ModCard>

                  {/* Bots */}
                  <ModCard icon={<Bot className="h-4 w-4 text-sky-400" />} title="Bots">
                    <div className="space-y-1.5">
                      <p className="text-lg font-semibold tabular-nums">
                        {usage!.botsActive} active
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}/ {limitLabel(usage!.maxBots)} max
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {usage!.botsTotal} configured · {usage!.proxiesUsed}/{limitLabel(usage!.maxProxies)} proxies
                      </p>
                      {usage!.maxBots > 0 && <Progress value={botsPct} className="h-1.5" />}
                    </div>
                  </ModCard>

                  {/* Active dockers */}
                  <ModCard
                    icon={<Container className="h-4 w-4 text-violet-400" />}
                    title="Active dockers"
                  >
                    {detail.containers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No running containers</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-lg font-semibold tabular-nums">
                          {detail.containers.filter((c) => c.state === "running").length} running
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}/ {detail.containers.length} total
                          </span>
                        </p>
                        <div className="space-y-0.5">
                          {detail.containers.slice(0, 3).map((c) => (
                            <div key={c.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <span
                                className={[
                                  "h-1.5 w-1.5 rounded-full",
                                  c.state === "running" ? "bg-emerald-400" : "bg-muted-foreground/40",
                                ].join(" ")}
                              />
                              <span className="truncate font-mono">{c.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </ModCard>
                </div>

                {/* Mod actions */}
                <section className="space-y-2">
                  <SectionLabel icon={<Shield className="h-3.5 w-3.5" />} text="Mod actions" />
                  {isSelf ? (
                    <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      You can&apos;t run moderation actions on yourself.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy["admin"]}
                        onClick={() =>
                          setConfirm({
                            title: isAdmin ? "Revoke admin access?" : "Grant admin access?",
                            description: isAdmin
                              ? `Remove admin permissions from ${user.global_name ?? user.username}. They will lose access to this panel.`
                              : `Give ${user.global_name ?? user.username} full admin permissions, including this control panel.`,
                            confirmLabel: isAdmin ? "Revoke admin" : "Grant admin",
                            danger: !isAdmin,
                            run: toggleAdmin,
                          })
                        }
                      >
                        {isAdmin ? (
                          <ShieldOff className="h-3.5 w-3.5 text-yellow-400" />
                        ) : (
                          <Shield className="h-3.5 w-3.5" />
                        )}
                        {isAdmin ? "Revoke admin" : "Grant admin"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busy["beta"]}
                        onClick={toggleBeta}
                      >
                        <Sparkles className={isBeta ? "h-3.5 w-3.5 text-sky-400" : "h-3.5 w-3.5"} />
                        {isBeta ? "Remove beta" : "Grant beta"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className={[
                          "gap-1.5",
                          isBanned
                            ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                            : "border-red-500/30 text-red-400 hover:bg-red-500/10",
                        ].join(" ")}
                        disabled={busy["ban"]}
                        onClick={() =>
                          setConfirm({
                            title: isBanned ? "Unban this user?" : "Ban this user?",
                            description: isBanned
                              ? `Restore access for ${user.global_name ?? user.username}.`
                              : `Ban ${user.global_name ?? user.username}. They will be blocked from using the service.`,
                            confirmLabel: isBanned ? "Unban" : "Ban user",
                            danger: !isBanned,
                            run: toggleBan,
                          })
                        }
                      >
                        {isBanned ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        {isBanned ? "Unban" : "Ban"}
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                        onClick={() => onGift(user)}
                      >
                        <Gift className="h-3.5 w-3.5" />
                        Gift sub
                      </Button>
                    </div>
                  )}
                </section>

                {/* Subscriptions list */}
                {detail.subscriptions.length > 0 && (
                  <section className="space-y-2">
                    <SectionLabel icon={<Activity className="h-3.5 w-3.5" />} text="Subscriptions" />
                    <div className="space-y-2">
                      {detail.subscriptions.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{s.plan?.name ?? s.plan_id}</p>
                            <p className="text-xs text-muted-foreground">
                              {s.status}
                              {s.expires_at ? ` · exp ${new Date(s.expires_at).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                          {s.status === "active" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10"
                              disabled={busy["sub:" + s.id]}
                              onClick={() => cancelSub(s.id)}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-green-400 hover:bg-green-500/10"
                              disabled={busy["sub:" + s.id]}
                              onClick={() => activateSub(s.id)}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Activate 30d
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Warns */}
                <section className="space-y-2">
                  <SectionLabel
                    icon={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                    text={`Warns (${detail.warns.length})`}
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Reason for warning…"
                      value={warnReason}
                      onChange={(e) => setWarnReason(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addWarn()}
                      className="h-8 text-sm"
                    />
                    <Button size="sm" className="h-8 gap-1.5 shrink-0" disabled={!warnReason.trim() || busy["warn"]} onClick={addWarn}>
                      <Plus className="h-3.5 w-3.5" />
                      Warn
                    </Button>
                  </div>
                  {detail.warns.length > 0 && (
                    <div className="space-y-1.5">
                      {detail.warns.map((w) => (
                        <div
                          key={w.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs">{w.reason}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(w.created_at).toLocaleString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-400"
                            disabled={busy["warn:" + w.id]}
                            onClick={() => removeWarn(w.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Notes */}
                <section className="space-y-2">
                  <SectionLabel
                    icon={<StickyNote className="h-3.5 w-3.5 text-sky-400" />}
                    text={`Notes (${detail.notes.length})`}
                  />
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add an internal note…"
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addNote()}
                      className="h-8 text-sm"
                    />
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" disabled={!noteContent.trim() || busy["note"]} onClick={addNote}>
                      <Plus className="h-3.5 w-3.5" />
                      Note
                    </Button>
                  </div>
                  {detail.notes.length > 0 && (
                    <div className="space-y-1.5">
                      {detail.notes.map((n) => (
                        <div
                          key={n.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs">{n.content}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(n.created_at).toLocaleString()}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-400"
                            disabled={busy["note:" + n.id]}
                            onClick={() => removeNote(n.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Connection IPs */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <SectionLabel
                      icon={<Fingerprint className="h-3.5 w-3.5 text-emerald-400" />}
                      text={`Connection IPs (${ips?.length ?? detail.ipCount})`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={networkLoading || (ips?.length ?? 0) === 0}
                      onClick={() => setShowIps((v) => !v)}
                    >
                      {networkLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ChevronDown
                          className={[
                            "h-3.5 w-3.5 transition-transform",
                            showIps ? "rotate-180" : "",
                          ].join(" ")}
                        />
                      )}
                      {showIps ? "Hide IPs" : "View IPs"}
                    </Button>
                  </div>

                  {networkLoading && !ips ? (
                    <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      Loading connection history…
                    </p>
                  ) : !ips || ips.length === 0 ? (
                    <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      No IPs recorded yet. They are captured on the user&apos;s next login.
                    </p>
                  ) : (
                    showIps && (
                      <div className="space-y-2">
                        {ips.map((row) => {
                          const isIpBanned = bannedIps.has(row.ip);
                          return (
                            <div
                              key={row.ip}
                              className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/15 px-4 py-3"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="font-mono text-sm">{row.ip}</p>
                                  {isIpBanned && (
                                    <Badge
                                      variant="outline"
                                      className="border-red-500/40 bg-red-500/10 text-red-400 text-[10px]"
                                    >
                                      Banned
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                  {row.hits} login{row.hits === 1 ? "" : "s"} · last{" "}
                                  {new Date(row.last_seen).toLocaleString()}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className={[
                                  "h-8 gap-1.5 text-xs shrink-0",
                                  isIpBanned
                                    ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                                    : "border-red-500/30 text-red-400 hover:bg-red-500/10",
                                ].join(" ")}
                                disabled={busy["ip:" + row.ip]}
                                onClick={() => toggleIpBan(row.ip)}
                              >
                                {isIpBanned ? (
                                  <><CheckCircle2 className="h-3.5 w-3.5" /> Unban IP</>
                                ) : (
                                  <><Ban className="h-3.5 w-3.5" /> Ban IP</>
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </section>

                {/* Alt accounts */}
                <section className="space-y-3">
                  <SectionLabel
                    icon={<Users className="h-3.5 w-3.5 text-orange-400" />}
                    text={`Alt accounts (${alts?.length ?? 0})`}
                  />
                  {networkLoading && !alts ? (
                    <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      Scanning shared IPs…
                    </p>
                  ) : !alts || alts.length === 0 ? (
                    <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
                      No alt accounts detected. No other users share an IP with this account.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {alts.map((alt) => (
                        <div
                          key={alt.id}
                          className="flex items-center gap-3 rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3"
                        >
                          <Avatar className="h-9 w-9 ring-1 ring-border/60">
                            {alt.avatar_url && (
                              <AvatarImage src={alt.avatar_url} crossOrigin="anonymous" alt={alt.username} />
                            )}
                            <AvatarFallback className="text-xs">
                              {alt.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">
                                {alt.global_name ?? alt.username}
                              </span>
                              {alt.is_owner === 1 && (
                                <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-[10px]">
                                  Owner
                                </Badge>
                              )}
                              {alt.is_admin === 1 && (
                                <Badge variant="outline" className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400 text-[10px]">
                                  Admin
                                </Badge>
                              )}
                              {alt.is_banned === 1 && (
                                <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400 text-[10px]">
                                  Banned
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              @{alt.username} · {alt.sharedIps.length} shared IP
                              {alt.sharedIps.length === 1 ? "" : "s"}
                            </p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground/80">
                              {alt.sharedIps.slice(0, 2).join(", ")}
                              {alt.sharedIps.length > 2 ? ` +${alt.sharedIps.length - 2}` : ""}
                            </p>
                          </div>
                          <button
                            type="button"
                            title="Copy account ID"
                            onClick={() => navigator.clipboard?.writeText(alt.id)}
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Recent audit targeting this user */}
                <section className="space-y-2">
                  <SectionLabel
                    icon={<Network className="h-3.5 w-3.5" />}
                    text="Recent actions"
                  />
                  {detail.audit.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No moderation history.</p>
                  ) : (
                    <div className="space-y-1">
                      {detail.audit.slice(0, 8).map((a) => (
                        <div key={a.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span className="font-medium text-foreground/80">{a.action}</span>
                          {a.detail && <span className="truncate">· {a.detail}</span>}
                          <span className="ml-auto shrink-0 tabular-nums">
                            {new Date(a.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Danger zone — hard delete */}
                {!isSelf && (
                  <section className="space-y-2 pt-2">
                    <SectionLabel
                      icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
                      text="Danger zone"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50"
                      disabled={busy["deleteData"]}
                      onClick={() =>
                        setConfirm({
                          title: "Delete all user data?",
                          description: `This will permanently delete ALL data for ${user.global_name ?? user.username}. This cannot be undone.`,
                          confirmLabel: "Delete everything",
                          danger: true,
                          run: deleteUserData,
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete all data
                    </Button>
                  </section>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation popup for privileged / destructive actions */}
      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && !confirmRunning && setConfirm(null)}>
        <AlertDialogContent className="border-border/60 bg-card/95 backdrop-blur-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runConfirm();
              }}
              disabled={confirmRunning}
              className={
                confirm?.danger
                  ? "bg-red-500/90 text-white hover:bg-red-500"
                  : undefined
              }
            >
              {confirmRunning ? "Working…" : confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function ModCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/15 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-border/50 bg-muted/30">
          {icon}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {icon}
      {text}
    </div>
  );
}
