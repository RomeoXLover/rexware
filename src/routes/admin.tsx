import {
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Users,
  Shield,
  ShieldOff,
  Sparkles,
  Ban,
  CheckCircle2,
  DollarSign,
  Activity,
  LogOut,
  ArrowLeft,
  Clock,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  XCircle,
  RefreshCw,
  Gift,
  Globe,
  Plus,
  Trash2,
  Unlink,
  List,
  Ticket,
  AlertCircle,
  Loader2,
  X,
  MessageSquare,
  Send,
  Download,
  Megaphone,
  KeyRound,
  Copy,
  Wrench,
  Network,
  Eye,
  EyeOff,
  Save,
  Play,
  Square,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchSessionUser, logout } from "@/lib/api/auth.functions";
import {
  adminGetStats,
  adminGetUsers,
  adminGetUserIps,
  adminSetAdmin,
  adminSetBanned,
  adminSetBeta,
  adminBanIp,
  adminUnbanIp,
  adminGetBannedIps,
  adminGetAllPayments,
  adminGetUserSubscriptions,
  adminCancelSubscription,
  adminActivateSubscription,
  adminGiftSubscription,
  adminCancelPayment,
  adminGetAllProxies,
  adminCreateProxy,
  adminAssignProxy,
  adminDeleteProxy,
  adminGetAllSubscriptions,
  adminBulkCreateProxies,
  adminGetAllTicketsWithUser,
  adminGetTicketMessages,
  adminGetTicketTranscript,
  adminReplyTicket,
  adminUpdateTicket,
  adminBroadcastNotification,
  adminBroadcastDiscordDm,
  adminGetMaintenance,
  adminSetMaintenance,
  adminGetVpnSettings,
  adminSetVpnSettings,
  adminGetTicketStats,
} from "@/lib/api/admin.functions";
import { Textarea } from "@/components/ui/textarea";
import { getPlans } from "@/lib/api/dashboard.functions";
import {
  adminGetKeys,
  adminCreateKey,
  adminDeleteKey,
} from "@/lib/api/keys.functions";
import {
  getMyPlugins,
  savePluginConfig,
  runPlugin,
  stopPluginRun,
  getChatMessages,
  sendChatMessage,
} from "@/lib/api/plugins.functions";
import { DockerTab } from "@/components/admin/DockerTab";
import { PresetsTab } from "@/components/admin/PresetsTab";
import { UserModPanel } from "@/components/admin/UserModPanel";
import type { SessionUser } from "@/lib/auth.server";
import type { UserRow, PaymentRow, SubscriptionRow, PlanRow, ProxyRow, TicketRow, TicketMessageRow, RedeemKeyRow, UserIpRow } from "@/lib/repos.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Download a generated transcript ({ filename, content }) as a .txt file
function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type AllSubRow = SubscriptionRow & {
  username: string | null;
  global_name: string | null;
  avatar_url: string | null;
  plan_name: string | null;
};

interface AdminStats {
  totalUsers: number;
  totalRevenue: number;
  activeSubscriptions: number;
  recentPayments: PaymentRow[];
  auditLog: {
    id: string;
    actor_id: string;
    action: string;
    target_id: string | null;
    detail: string | null;
    is_owner: number;
    created_at: number;
  }[];
}

interface LoaderData {
  user: SessionUser;
  users: UserRow[];
  stats: AdminStats;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const user = await fetchSessionUser();
    if (!user) throw redirect({ to: "/" });
    return { user };
  },
  loader: async ({ context }) => {
    const user = context.user as SessionUser;
    // adminGetStats + adminGetUsers both call await requireAdmin() server-side.
    // If user is not admin they throw FORBIDDEN, which we catch here.
    let stats: AdminStats;
    let users: UserRow[];
    try {
      [stats, users] = await Promise.all([adminGetStats(), adminGetUsers()]);
    } catch {
      throw redirect({ to: "/dash" });
    }
    return { user, stats, users } satisfies LoaderData;
  },
  component: AdminDashboard,
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AdminTab = "users" | "payments" | "subscriptions" | "proxies" | "keys" | "docker" | "presets" | "tickets" | "broadcast" | "settings" | "audit";

function AdminDashboard() {
  const { user, stats, users: initialUsers } = Route.useLoaderData() as LoaderData;
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>("users");
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionMap, setActionMap] = useState<Record<string, boolean>>({});
  // Per-user mod panel (Discord-style moderation view)
  const [modUser, setModUser] = useState<UserRow | null>(null);
  // Subscriptions dialog
  const [subsUser, setSubsUser] = useState<UserRow | null>(null);
  const [ipUser, setIpUser] = useState<UserRow | null>(null);
  // Payments pagination
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentsData, setPaymentsData] = useState<{
    rows: (PaymentRow & { username: string | null; global_name: string | null; avatar_url: string | null })[];
    total: number;
    limit: number;
  } | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  // Proxies
  const [proxies, setProxies] = useState<ProxyRow[] | null>(null);
  const [proxiesLoading, setProxiesLoading] = useState(false);
  // All-subscriptions tab
  const [allSubs, setAllSubs] = useState<AllSubRow[] | null>(null);
  const [allSubsLoading, setAllSubsLoading] = useState(false);
  // Create proxy dialog
  const [createProxyOpen, setCreateProxyOpen] = useState(false);
  const [createProxyHost, setCreateProxyHost] = useState("");
  const [createProxyPort, setCreateProxyPort] = useState("");
  const [createProxyProtocol, setCreateProxyProtocol] = useState<"http" | "socks5">("http");
  const [createProxyUsername, setCreateProxyUsername] = useState("");
  const [createProxyPassword, setCreateProxyPassword] = useState("");
  const [createProxyLabel, setCreateProxyLabel] = useState("");
  const [createProxyAssignedUserId, setCreateProxyAssignedUserId] = useState("");
  const [createProxyLoading, setCreateProxyLoading] = useState(false);
  // Assign proxy dialog
  const [assignProxyRow, setAssignProxyRow] = useState<ProxyRow | null>(null);
  const [assignProxyUserId, setAssignProxyUserId] = useState("");
  const [assignProxyLoading, setAssignProxyLoading] = useState(false);
  // Standalone gift dialog (from user row)
  const [giftUser, setGiftUser] = useState<UserRow | null>(null);
  // Bulk proxy dialog
  const [bulkProxyOpen, setBulkProxyOpen] = useState(false);
  const [bulkProxyText, setBulkProxyText] = useState("");
  const [bulkProxyAssignedUserId, setBulkProxyAssignedUserId] = useState("");
  const [bulkProxyLoading, setBulkProxyLoading] = useState(false);
  const [bulkProxyResults, setBulkProxyResults] = useState<{ host: string; port: number; ok: boolean; error?: string }[] | null>(null);
  // Tickets tab
  const [allTickets, setAllTickets] = useState<TicketWithUser[] | null>(null);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatusFilter, setTicketStatusFilter] = useState<"all" | "open" | "in_progress" | "closed">("all");
  const [selectedTicket, setSelectedTicket] = useState<TicketWithUser | null>(null);
  const [ticketStats, setTicketStats] = useState<{
    open_tickets: number;
    in_progress_tickets: number;
    closed_today: number;
    avg_response_time: number;
    total_tickets: number;
    by_priority: { low: number; normal: number; high: number; urgent: number };
    by_source: { web: number; discord: number };
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  // Broadcast tab
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastOnlyActive, setBroadcastOnlyActive] = useState(false);
  const [broadcastLoading, setBroadcastLoading] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{ sent: number } | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  // Discord DM broadcast tab
  const [dmTitle, setDmTitle] = useState("");
  const [dmBody, setDmBody] = useState("");
  const [dmUrl, setDmUrl] = useState("");
  const [dmOnlyActive, setDmOnlyActive] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmResult, setDmResult] = useState<{ queued: number } | null>(null);
  const [dmError, setDmError] = useState<string | null>(null);
  // Settings tab — maintenance mode
  const [maintLoaded, setMaintLoaded] = useState(false);
  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintFull, setMaintFull] = useState(false);
  const [maintMessage, setMaintMessage] = useState("");
  const [maintSaving, setMaintSaving] = useState(false);
  const [maintSaved, setMaintSaved] = useState(false);

  async function loadMaintenance() {
    try {
      const res = await adminGetMaintenance();
      setMaintEnabled(res.enabled);
      setMaintFull(res.full);
      setMaintMessage(res.message);
    } finally {
      setMaintLoaded(true);
    }
  }

  async function saveMaintenance(nextEnabled: boolean, nextFull = maintFull) {
    setMaintSaving(true);
    setMaintSaved(false);
    try {
      await adminSetMaintenance({
        data: {
          enabled: nextEnabled,
          full: nextFull,
          message: maintMessage.trim() || undefined,
        },
      });
      setMaintEnabled(nextEnabled);
      setMaintFull(nextFull);
      setMaintSaved(true);
      setTimeout(() => setMaintSaved(false), 2500);
    } finally {
      setMaintSaving(false);
    }
  }

  // Settings tab — anti-VPN protection
  const [vpnLoaded, setVpnLoaded] = useState(false);
  const [vpnEnabled, setVpnEnabled] = useState(false);
  const [vpnBlockHosting, setVpnBlockHosting] = useState(false);
  const [vpnAllowlist, setVpnAllowlist] = useState("");
  const [vpnSaving, setVpnSaving] = useState(false);
  const [vpnSaved, setVpnSaved] = useState(false);

  async function loadVpn() {
    try {
      const res = await adminGetVpnSettings();
      setVpnEnabled(res.enabled);
      setVpnBlockHosting(res.blockHosting);
      setVpnAllowlist(res.allowlist);
    } finally {
      setVpnLoaded(true);
    }
  }

  async function saveVpn(
    nextEnabled: boolean,
    nextHosting = vpnBlockHosting,
    persistAllowlist = false,
  ) {
    setVpnSaving(true);
    setVpnSaved(false);
    try {
      await adminSetVpnSettings({
        data: {
          enabled: nextEnabled,
          blockHosting: nextHosting,
          allowlist: persistAllowlist ? vpnAllowlist.trim() : undefined,
        },
      });
      setVpnEnabled(nextEnabled);
      setVpnBlockHosting(nextHosting);
      setVpnSaved(true);
      setTimeout(() => setVpnSaved(false), 2500);
    } finally {
      setVpnSaving(false);
    }
  }

  async function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!broadcastTitle.trim() || broadcastLoading) return;
    setBroadcastLoading(true);
    setBroadcastError(null);
    setBroadcastResult(null);
    try {
      const res = await adminBroadcastNotification({
        data: {
          title: broadcastTitle.trim(),
          body: broadcastBody.trim() || undefined,
          onlyActiveSubs: broadcastOnlyActive,
        },
      });
      setBroadcastResult({ sent: res.sent });
      setBroadcastTitle("");
      setBroadcastBody("");
    } catch (err: unknown) {
      setBroadcastError(err instanceof Error ? err.message : String(err));
    } finally {
      setBroadcastLoading(false);
    }
  }

  async function handleDiscordDm(e: React.FormEvent) {
    e.preventDefault();
    if (!dmTitle.trim() || dmLoading) return;
    setDmLoading(true);
    setDmError(null);
    setDmResult(null);
    try {
      const res = await adminBroadcastDiscordDm({
        data: {
          title: dmTitle.trim(),
          body: dmBody.trim() || undefined,
          url: dmUrl.trim() || undefined,
          onlyActiveSubs: dmOnlyActive,
        },
      });
      setDmResult({ queued: res.queued });
      setDmTitle("");
      setDmBody("");
      setDmUrl("");
    } catch (err: unknown) {
      setDmError(err instanceof Error ? err.message : String(err));
    } finally {
      setDmLoading(false);
    }
  }

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.global_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.id.includes(search),
  );

  async function loadPayments(page: number) {
    setPaymentsLoading(true);
    try {
      const result = await adminGetAllPayments({ data: { page } });
      setPaymentsData(result);
      setPaymentsPage(page);
    } finally {
      setPaymentsLoading(false);
    }
  }

  async function handleCancelPayment(paymentId: string) {
    setActionMap((m) => ({ ...m, [paymentId + "cancel"]: true }));
    try {
      await adminCancelPayment({ data: { paymentId } });
      // Refresh current page
      await loadPayments(paymentsPage);
    } finally {
      setActionMap((m) => ({ ...m, [paymentId + "cancel"]: false }));
    }
  }

  async function loadProxies() {
    setProxiesLoading(true);
    try {
      const result = await adminGetAllProxies();
      setProxies(result as ProxyRow[]);
    } finally {
      setProxiesLoading(false);
    }
  }

  async function loadAllSubs() {
    setAllSubsLoading(true);
    try {
      const result = await adminGetAllSubscriptions();
      setAllSubs(result as AllSubRow[]);
    } finally {
      setAllSubsLoading(false);
    }
  }

  async function loadAllTickets() {
    setTicketsLoading(true);
    try {
      const result = await adminGetAllTicketsWithUser();
      setAllTickets(result as TicketWithUser[]);
    } catch {
      // ignore
    } finally {
      setTicketsLoading(false);
    }
  }

  async function loadTicketStats() {
    setStatsLoading(true);
    try {
      const stats = await adminGetTicketStats();
      setTicketStats(stats);
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }

  async function handleCreateProxy() {
    const port = parseInt(createProxyPort);
    if (!createProxyHost || !port) return;
    setCreateProxyLoading(true);
    try {
      await adminCreateProxy({
        data: {
          host: createProxyHost,
          port,
          protocol: createProxyProtocol,
          username: createProxyUsername || undefined,
          password: createProxyPassword || undefined,
          label: createProxyLabel || undefined,
          assignedUserId: createProxyAssignedUserId || undefined,
        },
      });
      setCreateProxyHost("");
      setCreateProxyPort("");
      setCreateProxyProtocol("http");
      setCreateProxyUsername("");
      setCreateProxyPassword("");
      setCreateProxyLabel("");
      setCreateProxyAssignedUserId("");
      setCreateProxyOpen(false);
      await loadProxies();
    } finally {
      setCreateProxyLoading(false);
    }
  }

  async function handleUnlinkProxy(proxyId: string) {
    setActionMap((m) => ({ ...m, [proxyId + "unlink"]: true }));
    try {
      await adminAssignProxy({ data: { proxyId, userId: null } });
      await loadProxies();
    } finally {
      setActionMap((m) => ({ ...m, [proxyId + "unlink"]: false }));
    }
  }

  async function handleDeleteProxy(proxyId: string) {
    setActionMap((m) => ({ ...m, [proxyId + "delete"]: true }));
    try {
      await adminDeleteProxy({ data: { proxyId } });
      await loadProxies();
    } finally {
      setActionMap((m) => ({ ...m, [proxyId + "delete"]: false }));
    }
  }

  async function handleBulkCreateProxies() {
    if (!bulkProxyText.trim()) return;
    setBulkProxyLoading(true);
    try {
      const result = await adminBulkCreateProxies({
        data: {
          lines: bulkProxyText,
          assignedUserId: bulkProxyAssignedUserId.trim() || undefined,
        },
      });
      setBulkProxyResults(result.results);
      await loadProxies();
    } finally {
      setBulkProxyLoading(false);
    }
  }

  async function handleAssignProxy() {
    if (!assignProxyRow || !assignProxyUserId.trim()) return;
    setAssignProxyLoading(true);
    try {
      await adminAssignProxy({ data: { proxyId: assignProxyRow.id, userId: assignProxyUserId.trim() } });
      setAssignProxyRow(null);
      setAssignProxyUserId("");
      await loadProxies();
    } finally {
      setAssignProxyLoading(false);
    }
  }

  function handleTabChange(t: AdminTab) {
    setTab(t);
    if (t === "payments" && !paymentsData) loadPayments(0);
    if (t === "proxies" && proxies === null) loadProxies();
    if (t === "subscriptions" && allSubs === null) loadAllSubs();
    if (t === "tickets" && allTickets === null) loadAllTickets();
    if (t === "tickets" && ticketStats === null) loadTicketStats();
    if (t === "settings" && !maintLoaded) loadMaintenance();
    if (t === "settings" && !vpnLoaded) loadVpn();
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      await router.navigate({ to: "/" });
      router.invalidate();
    } finally {
      setLoggingOut(false);
    }
  }

  async function toggleAdmin(userId: string, currentIsAdmin: boolean) {
    setActionMap((m) => ({ ...m, [userId + "admin"]: true }));
    try {
      await adminSetAdmin({ data: { userId, isAdmin: !currentIsAdmin } });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, is_admin: currentIsAdmin ? 0 : 1 } : u,
        ),
      );
    } finally {
      setActionMap((m) => ({ ...m, [userId + "admin"]: false }));
    }
  }

  async function toggleBan(userId: string, currentIsBanned: boolean) {
    setActionMap((m) => ({ ...m, [userId + "ban"]: true }));
    try {
      await adminSetBanned({ data: { userId, banned: !currentIsBanned } });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? { ...u, is_banned: currentIsBanned ? 0 : 1 }
            : u,
        ),
      );
    } finally {
      setActionMap((m) => ({ ...m, [userId + "ban"]: false }));
    }
  }

  async function toggleBeta(userId: string, currentIsBeta: boolean) {
    setActionMap((m) => ({ ...m, [userId + "beta"]: true }));
    try {
      await adminSetBeta({ data: { userId, beta: !currentIsBeta } });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, is_beta: currentIsBeta ? 0 : 1 } : u,
        ),
      );
    } finally {
      setActionMap((m) => ({ ...m, [userId + "beta"]: false }));
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/60 bg-card/95 backdrop-blur-sm px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/dash"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </a>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="font-semibold">Admin Panel</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-7 w-7">
            <AvatarImage
              src={user.avatarUrl}
              alt={user.username}
              crossOrigin="anonymous"
            />
            <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-sm text-muted-foreground">
            {user.globalName ?? user.username}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? "Logging out…" : "Logout"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        {/* Hero band */}
        <div className="ac-stat-in relative overflow-hidden rounded-3xl border border-border/60 bg-card/40 p-6 md:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.4]"
            style={{
              backgroundImage:
                "linear-gradient(to right, oklch(1 0 0 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.04) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
              maskImage:
                "radial-gradient(ellipse 70% 80% at 100% 0%, black, transparent 70%)",
            }}
          />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Shield className="h-3 w-3 text-primary" />
                {user.is_owner === 1 ? "Owner" : "Administrator"}
              </span>
              <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">
                Control Center
              </h1>
              <p className="max-w-md text-pretty text-sm text-muted-foreground">
                Monitor users, revenue, and subscriptions at a glance. Manage
                everything from the tabs below.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
                {stats.activeSubscriptions} active sub
                {stats.activeSubscriptions !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="ac-stat-in grid grid-cols-2 gap-4 md:grid-cols-4">
          <AdminStat
            icon={<Users className="h-4 w-4 text-sky-400" />}
            label="Total Users"
            value={stats.totalUsers}
            sub={`${users.filter((u) => u.is_banned === 1).length} banned`}
          />
          <AdminStat
            icon={<DollarSign className="h-4 w-4 text-emerald-400" />}
            label="Total Revenue"
            value={`$${stats.totalRevenue.toFixed(2)}`}
            sub={`${stats.recentPayments.length} recent`}
          />
          <AdminStat
            icon={<Activity className="h-4 w-4 text-amber-400" />}
            label="Active Subs"
            value={stats.activeSubscriptions}
            sub="subscriptions"
          />
          <AdminStat
            icon={<Shield className="h-4 w-4 text-rose-400" />}
            label="Admins"
            value={users.filter((u) => u.is_admin === 1).length}
            sub="with admin access"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border/60 overflow-x-auto no-scrollbar">
          {(["users", "payments", "subscriptions", "proxies", "keys", "docker", "presets", "tickets", "broadcast", "settings", "audit"] as AdminTab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => handleTabChange(t)}
              className={[
                "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0",
                tab === t
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Animated tab panel — re-mounts on tab change for a subtle entrance */}
        <div key={tab} className="ac-tab-panel">
        {/* Users tab */}
        {tab === "users" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Input
                placeholder="Search by username, name, or ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                {filteredUsers.length} / {users.length} users
              </p>
            </div>

            <div className="rounded-2xl border border-border/60 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 bg-muted/20">
                    <TableHead className="pl-5">User</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-5">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u, i) => (
                    <TableRow
                      key={u.id}
                      className="ac-row-stagger border-border/40"
                      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    >
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {u.avatar_url && (
                              <AvatarImage
                                src={u.avatar_url}
                                alt={u.username}
                                crossOrigin="anonymous"
                              />
                            )}
                            <AvatarFallback>
                              {u.username.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="text-sm font-medium">
                              {u.global_name ?? u.username}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              @{u.username}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {u.id}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.is_owner === 1 && (
                            <Badge
                              variant="outline"
                              className="border-rose-500/40 bg-rose-500/10 text-rose-400 text-xs"
                            >
                              Owner
                            </Badge>
                          )}
                          {u.is_admin === 1 && (
                            <Badge
                              variant="outline"
                              className="border-yellow-500/40 bg-yellow-500/10 text-yellow-400 text-xs"
                            >
                              Admin
                            </Badge>
                          )}
                          {u.is_banned === 1 && (
                            <Badge
                              variant="outline"
                              className="border-red-500/40 bg-red-500/10 text-red-400 text-xs"
                            >
                              Banned
                            </Badge>
                          )}
                          {u.is_admin === 0 && u.is_banned === 0 && (
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground"
                            >
                              User
                            </Badge>
                          )}
                          {u.is_beta === 1 && (
                            <Badge
                              variant="outline"
                              className="border-sky-500/40 bg-sky-500/10 text-sky-400 text-xs"
                            >
                              Beta
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="pr-5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => setModUser(u)}
                          title="Open moderation view"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Manage
                          {u.id === user.id && (
                            <span className="text-muted-foreground/60">(you)</span>
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Payments tab */}
        {tab === "payments" && (
          <div className="space-y-3">
            {paymentsLoading ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading payments…
              </div>
            ) : (
              <>
                <div className="rounded-2xl border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border/60 bg-muted/20">
                        <TableHead className="pl-5">User</TableHead>
                        <TableHead>Payment ID</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>USD</TableHead>
                        <TableHead>Crypto</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>TxID</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="pr-5 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(paymentsData?.rows ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="py-12 text-center text-sm text-muted-foreground">
                            No payments found.
                          </TableCell>
                        </TableRow>
                      ) : (paymentsData?.rows ?? []).map((p, i) => (
                        <TableRow
                          key={p.id}
                          className="ac-row-stagger border-border/40"
                          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                        >
                          <TableCell className="pl-5">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 shrink-0">
                                {p.avatar_url && (
                                  <AvatarImage src={p.avatar_url} crossOrigin="anonymous" alt={p.username ?? ""} />
                                )}
                                <AvatarFallback className="text-[10px]">
                                  {(p.username ?? "?").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-xs font-medium">{p.global_name ?? p.username ?? "—"}</p>
                                <p className="font-mono text-[10px] text-muted-foreground">{p.user_id.slice(0, 10)}…</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {p.id.slice(0, 14)}…
                          </TableCell>
                          <TableCell className="text-xs capitalize">{p.plan_id}</TableCell>
                          <TableCell className="text-xs font-medium">${p.amount_usd}</TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {p.amount_crypto ? `${p.amount_crypto} ${p.coin.toUpperCase()}` : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[120px] truncate" title={p.pay_address ?? ""}>
                            {p.pay_address ? `${p.pay_address.slice(0, 12)}…` : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground max-w-[100px] truncate" title={p.txid ?? ""}>
                            {p.txid ? `${p.txid.slice(0, 10)}…` : "—"}
                          </TableCell>
                          <TableCell>
                            <PayStatusBadge status={p.status} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(p.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {(p.status === "waiting" || p.status === "confirming") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10"
                                disabled={actionMap[p.id + "cancel"]}
                                onClick={() => handleCancelPayment(p.id)}
                                title="Cancel payment"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Cancel
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Pagination */}
                {paymentsData && paymentsData.total > paymentsData.limit && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {paymentsPage * paymentsData.limit + 1}–
                      {Math.min((paymentsPage + 1) * paymentsData.limit, paymentsData.total)} of {paymentsData.total}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        disabled={paymentsPage === 0}
                        onClick={() => loadPayments(paymentsPage - 1)}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1"
                        disabled={(paymentsPage + 1) * paymentsData.limit >= paymentsData.total}
                        onClick={() => loadPayments(paymentsPage + 1)}
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Broadcast tab */}
        {tab === "broadcast" && (
          <div className="grid gap-6 md:grid-cols-2" style={{ animation: "fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both" }}>
            {/* In-app notification broadcast */}
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-2xl border border-border/60 bg-card/50 px-5 py-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15">
                  <Megaphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">In-App Announcement</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sends a notification inside the dashboard. Users who disabled announcements are skipped.
                  </p>
                </div>
              </div>
              <form
                onSubmit={handleBroadcast}
                className="rounded-2xl border border-border/60 bg-card/50 px-5 py-5 space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Title</label>
                  <Input
                    placeholder="e.g. Scheduled maintenance tonight"
                    value={broadcastTitle}
                    onChange={(e) => setBroadcastTitle(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Message (optional)</label>
                  <Textarea
                    placeholder="Add more details for your users…"
                    value={broadcastBody}
                    onChange={(e) => setBroadcastBody(e.target.value)}
                    className="min-h-[90px] resize-none"
                    maxLength={500}
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={broadcastOnlyActive}
                    onChange={(e) => setBroadcastOnlyActive(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm text-muted-foreground">Active subscribers only</span>
                </label>
                {broadcastError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {broadcastError}
                  </div>
                )}
                {broadcastResult && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Sent to {broadcastResult.sent} user{broadcastResult.sent === 1 ? "" : "s"}.
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" disabled={!broadcastTitle.trim() || broadcastLoading} className="gap-1.5">
                    {broadcastLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                    {broadcastLoading ? "Sending…" : "Send"}
                  </Button>
                </div>
              </form>
            </div>

            {/* Discord DM broadcast */}
            <div className="space-y-4">
              <div className="flex items-start gap-4 rounded-2xl border border-border/60 bg-card/50 px-5 py-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15">
                  <MessageSquare className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-medium">Discord DM Broadcast</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Queues a DM via the bot to every user&apos;s Discord. Uses Components V2 embeds.
                  </p>
                </div>
              </div>
              <form
                onSubmit={handleDiscordDm}
                className="rounded-2xl border border-border/60 bg-card/50 px-5 py-5 space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Title</label>
                  <Input
                    placeholder="e.g. RexWare v2.5 is live"
                    value={dmTitle}
                    onChange={(e) => setDmTitle(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Message (optional)</label>
                  <Textarea
                    placeholder="Full announcement text…"
                    value={dmBody}
                    onChange={(e) => setDmBody(e.target.value)}
                    className="min-h-[90px] resize-none"
                    maxLength={1500}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Link URL (optional)</label>
                  <Input
                    placeholder="https://rexware.lol/dash"
                    value={dmUrl}
                    onChange={(e) => setDmUrl(e.target.value)}
                    type="url"
                  />
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={dmOnlyActive}
                    onChange={(e) => setDmOnlyActive(e.target.checked)}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <span className="text-sm text-muted-foreground">Active subscribers only</span>
                </label>
                {dmError && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {dmError}
                  </div>
                )}
                {dmResult && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Queued for {dmResult.queued} user{dmResult.queued === 1 ? "" : "s"}.
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={!dmTitle.trim() || dmLoading}
                    className="gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white"
                  >
                    {dmLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {dmLoading ? "Queueing…" : "Queue DMs"}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Settings tab — maintenance mode */}
        {tab === "settings" && (
          <div className="max-w-2xl space-y-6">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                    <Wrench className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Maintenance mode</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      When enabled, the site is blocked for all visitors. Admins
                      keep full access, and beta testers also get through unless
                      &quot;full lockdown&quot; is on.
                    </p>
                  </div>
                </div>
                <Badge
                  variant={maintEnabled ? "destructive" : "secondary"}
                  className="shrink-0"
                >
                  {maintEnabled ? "Active" : "Off"}
                </Badge>
              </div>

              {!maintLoaded ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="maint-msg"
                      className="text-sm font-medium text-foreground"
                    >
                      Message shown to visitors
                    </label>
                    <Textarea
                      id="maint-msg"
                      value={maintMessage}
                      onChange={(e) => setMaintMessage(e.target.value)}
                      rows={3}
                      maxLength={500}
                      placeholder="We're performing scheduled maintenance. Please check back soon."
                    />
                  </div>

                  <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div>
                      <label
                        htmlFor="maint-full"
                        className="text-sm font-medium text-foreground"
                      >
                        Full lockdown
                      </label>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Also block beta testers. Only admins keep access when this
                        is on.
                      </p>
                    </div>
                    <Switch
                      id="maint-full"
                      checked={maintFull}
                      onCheckedChange={(v) => saveMaintenance(maintEnabled, v)}
                      disabled={maintSaving}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant={maintEnabled ? "destructive" : "default"}
                      onClick={() => saveMaintenance(!maintEnabled)}
                      disabled={maintSaving}
                      className="gap-2"
                    >
                      {maintSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wrench className="h-4 w-4" />
                      )}
                      {maintEnabled ? "Disable maintenance" : "Enable maintenance"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => saveMaintenance(maintEnabled)}
                      disabled={maintSaving}
                    >
                      Save message
                    </Button>
                    {maintSaved && (
                      <span className="flex items-center gap-1.5 text-sm text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Saved
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Anti-VPN protection */}
            <div className="rounded-2xl border border-border/60 bg-card/40 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/20">
                    <Shield className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Anti-VPN protection</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Block visitors connecting through VPNs, proxies and Tor.
                      Flagged connections are redirected to the blocked page.
                    </p>
                  </div>
                </div>
                <Badge
                  variant={vpnEnabled ? "destructive" : "secondary"}
                  className="shrink-0"
                >
                  {vpnEnabled ? "Active" : "Off"}
                </Badge>
              </div>

              {!vpnLoaded ? (
                <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-muted/10 p-4">
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        Also block hosting / datacenter IPs
                      </span>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Catches more VPNs, but may flag some corporate or mobile
                        carrier gateways. Leave off if unsure.
                      </p>
                    </div>
                    <Switch
                      id="vpn-hosting"
                      checked={vpnBlockHosting}
                      onCheckedChange={(v) => saveVpn(vpnEnabled, v)}
                      disabled={vpnSaving || !vpnEnabled}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="vpn-allow"
                      className="text-sm font-medium text-foreground"
                    >
                      Allowlist (IP addresses)
                    </label>
                    <p className="text-sm text-muted-foreground">
                      Comma or space separated. These IPs always bypass the check
                      (e.g. your office or staff).
                    </p>
                    <Input
                      id="vpn-allow"
                      value={vpnAllowlist}
                      onChange={(e) => setVpnAllowlist(e.target.value)}
                      placeholder="203.0.113.4, 198.51.100.10"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant={vpnEnabled ? "destructive" : "default"}
                      onClick={() => saveVpn(!vpnEnabled)}
                      disabled={vpnSaving}
                      className="gap-2"
                    >
                      {vpnSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Shield className="h-4 w-4" />
                      )}
                      {vpnEnabled ? "Disable protection" : "Enable protection"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => saveVpn(vpnEnabled, vpnBlockHosting, true)}
                      disabled={vpnSaving}
                    >
                      Save allowlist
                    </Button>
                    {vpnSaved && (
                      <span className="flex items-center gap-1.5 text-sm text-green-400">
                        <CheckCircle2 className="h-4 w-4" />
                        Saved
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audit log tab */}
        {tab === "audit" && (
          <div className="rounded-2xl border border-border/60 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 bg-muted/20">
                  <TableHead className="pl-5">Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="pr-5">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.auditLog.map((entry, i) => (
                  <TableRow
                    key={entry.id}
                    className="ac-row-stagger border-border/40"
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                  >
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{entry.action}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.is_owner === 1 ? (
                        <span className="text-rose-400">Owner</span>
                      ) : (
                        <span>{entry.actor_id.slice(0, 12)}…</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {entry.target_id ? `${entry.target_id.slice(0, 12)}…` : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.detail ?? "—"}
                    </TableCell>
                    <TableCell className="pr-5 text-xs text-muted-foreground">
                      {new Date(entry.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {stats.auditLog.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No audit entries yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Subscriptions tab */}
        {tab === "subscriptions" && (
          <div className="space-y-3">
            {allSubsLoading ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading subscriptions…
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60 bg-muted/20">
                      <TableHead className="pl-5">User</TableHead>
                      <TableHead>Sub ID</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="pr-5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(allSubs ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                          No subscriptions found.
                        </TableCell>
                      </TableRow>
                    ) : (allSubs ?? []).map((s, i) => (
                      <TableRow
                        key={s.id}
                        className="ac-row-stagger border-border/40"
                        style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                      >
                        <TableCell className="pl-5">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6 shrink-0">
                              {s.avatar_url && (
                                <AvatarImage src={s.avatar_url} crossOrigin="anonymous" alt={s.username ?? ""} />
                              )}
                              <AvatarFallback className="text-[10px]">
                                {(s.username ?? "?").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-xs font-medium">{s.global_name ?? s.username ?? "—"}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{s.user_id.slice(0, 10)}…</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">
                          {s.id.slice(0, 14)}…
                        </TableCell>
                        <TableCell className="text-xs capitalize">{s.plan_name ?? s.plan_id}</TableCell>
                        <TableCell>
                          <SubStatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {s.started_at ? new Date(s.started_at).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {s.expires_at ? new Date(s.expires_at).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => {
                              const matchedUser = users.find((u) => u.id === s.user_id);
                              if (matchedUser) setSubsUser(matchedUser);
                            }}
                            title="Manage subscriptions for this user"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Manage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Tickets tab */}
        {tab === "tickets" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <Input
                placeholder="Search by subject, user, or ID…"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                className="max-w-xs"
              />
              <div className="flex gap-1">
                {(["all", "open", "in_progress", "closed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTicketStatusFilter(s)}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                      ticketStatusFilter === s
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    {s === "in_progress" ? "In Progress" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 ml-auto"
                onClick={() => { loadAllTickets(); loadTicketStats(); }}
                disabled={ticketsLoading}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${ticketsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {/* Ticket stats summary */}
            {ticketStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-emerald-400/70 uppercase tracking-wide">Open</p>
                  <p className="text-xl font-bold text-emerald-400 mt-0.5">{ticketStats.open_tickets}</p>
                </div>
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-blue-400/70 uppercase tracking-wide">In Progress</p>
                  <p className="text-xl font-bold text-blue-400 mt-0.5">{ticketStats.in_progress_tickets}</p>
                </div>
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-violet-400/70 uppercase tracking-wide">Closed Today</p>
                  <p className="text-xl font-bold text-violet-400 mt-0.5">{ticketStats.closed_today}</p>
                </div>
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-yellow-400/70 uppercase tracking-wide">Urgent</p>
                  <p className="text-xl font-bold text-yellow-400 mt-0.5">{ticketStats.by_priority.urgent}</p>
                </div>
                <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-orange-400/70 uppercase tracking-wide">High</p>
                  <p className="text-xl font-bold text-orange-400 mt-0.5">{ticketStats.by_priority.high}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5">
                  <p className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wide">Total</p>
                  <p className="text-xl font-bold text-foreground/70 mt-0.5">{ticketStats.total_tickets}</p>
                </div>
              </div>
            )}

            {ticketsLoading ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading tickets…
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60 bg-muted/20">
                      <TableHead className="pl-5">User</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="hidden sm:table-cell">Response</TableHead>
                      <TableHead className="hidden md:table-cell">Category</TableHead>
                      <TableHead className="hidden lg:table-cell">Created</TableHead>
                      <TableHead className="hidden lg:table-cell">Updated</TableHead>
                      <TableHead className="pr-5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const filtered = (allTickets ?? []).filter((t) => {
                        const q = ticketSearch.toLowerCase();
                        const matchesSearch =
                          !q ||
                          t.subject.toLowerCase().includes(q) ||
                          (t.username ?? "").toLowerCase().includes(q) ||
                          t.id.includes(q);
                        const matchesStatus =
                          ticketStatusFilter === "all" || t.status === ticketStatusFilter;
                        return matchesSearch && matchesStatus;
                      });

                      if (filtered.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                              No tickets found.
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return filtered.map((t, i) => (
                        <TableRow
                          key={t.id}
                          className="ac-row-stagger border-border/40"
                          style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                        >
                          <TableCell className="pl-5">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 shrink-0">
                                {t.avatar_url && (
                                  <AvatarImage src={t.avatar_url} crossOrigin="anonymous" alt={t.username ?? ""} />
                                )}
                                <AvatarFallback className="text-[10px]">
                                  {(t.username ?? "?").slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-xs font-medium">{t.global_name ?? t.username ?? "—"}</p>
                                <p className="font-mono text-[10px] text-muted-foreground">{t.user_id.slice(0, 10)}…</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-[180px]">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="ghost"
                                className={`shrink-0 h-5 px-1.5 text-[9px] font-mono gap-0.5 ${t.source === "web"
                                  ? "text-violet-400 bg-violet-500/10 border border-violet-500/20"
                                  : "text-blue-400 bg-blue-500/10 border border-blue-500/20"
                                }`}
                              >
                                {t.source === "web" ? "W" : "D"}
                              </Badge>
                              <p className="text-xs font-medium truncate">{t.subject}</p>
                            </div>
                            <p className="font-mono text-[10px] text-muted-foreground">#{t.id.slice(-6).toUpperCase()}</p>
                          </TableCell>
                          <TableCell>
                            <AdminTicketStatusBadge status={t.status} />
                          </TableCell>
                          <TableCell>
                            <AdminTicketPriorityBadge priority={t.priority} />
                          </TableCell>
                          {/* Response status — derived from ticket messages */}
                          <TableCell className="hidden sm:table-cell">
                            <ResponseStatusCell ticketId={t.id} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground capitalize">{t.category}</TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(t.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(t.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 text-xs"
                              onClick={() => setSelectedTicket(t)}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Manage
                            </Button>
                          </TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Proxies tab */}
        {tab === "proxies" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {proxies ? `${proxies.length} proxies total · ${proxies.filter((p) => p.assigned_user_id).length} assigned` : ""}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => { setBulkProxyText(""); setBulkProxyAssignedUserId(""); setBulkProxyResults(null); setBulkProxyOpen(true); }}
                >
                  <List className="h-3.5 w-3.5" />
                  Bulk Add
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setCreateProxyOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Proxy
                </Button>
              </div>
            </div>

            {proxiesLoading ? (
              <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
                Loading proxies…
              </div>
            ) : (
              <div className="rounded-2xl border border-border/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/60 bg-muted/20">
                      <TableHead className="pl-5">Label / ID</TableHead>
                      <TableHead>Host : Port</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Auth</TableHead>
                      <TableHead>Assigned User</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="pr-5 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(proxies ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                          No proxies yet. Add one with the button above.
                        </TableCell>
                      </TableRow>
                    ) : (proxies ?? []).map((p, i) => (
                      <TableRow
                        key={p.id}
                        className="ac-row-stagger border-border/40"
                        style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                      >
                        <TableCell className="pl-5">
                          <p className="text-sm font-medium">{p.label ?? "—"}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{p.id.slice(0, 14)}…</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.host}:{p.port}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs uppercase font-mono">
                            {p.protocol}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.username ? <span className="text-foreground/70">{p.username}</span> : "—"}
                        </TableCell>
                        <TableCell>
                          {p.assigned_user_id ? (
                            <span className="font-mono text-[10px] text-foreground/70 bg-muted/40 px-2 py-0.5 rounded">
                              {p.assigned_user_id.slice(0, 12)}…
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(p.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              onClick={() => { setAssignProxyRow(p); setAssignProxyUserId(p.assigned_user_id ?? ""); }}
                              title="Assign to user"
                            >
                              <Globe className="h-3.5 w-3.5" />
                              Assign
                            </Button>
                            {p.assigned_user_id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-muted-foreground"
                                disabled={actionMap[p.id + "unlink"]}
                                onClick={() => handleUnlinkProxy(p.id)}
                                title="Unlink from user"
                              >
                                <Unlink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10"
                              disabled={actionMap[p.id + "delete"]}
                              onClick={() => handleDeleteProxy(p.id)}
                              title="Delete proxy"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}

        {/* Keys tab */}
        {tab === "keys" && <KeysTab />}

        {tab === "docker" && <DockerTab />}

        {tab === "presets" && <PresetsTab />}
        </div>
      </main>

      {/* Ticket management dialog */}
      {selectedTicket && (
        <AdminTicketDialog
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onUpdate={(updated) => {
            setAllTickets((prev) => prev ? prev.map((t) => t.id === updated.id ? { ...t, ...updated } : t) : prev);
            setSelectedTicket((prev) => prev ? { ...prev, ...updated } : prev);
          }}
        />
      )}

        {/* Per-user moderation panel (Discord-style mod view) */}
        {modUser && (
          <UserModPanel
            user={modUser}
            currentUserId={user.id}
            onClose={() => setModUser(null)}
            onUserChange={(patch) => {
              setUsers((prev) =>
                prev.map((u) => (u.id === modUser.id ? { ...u, ...patch } : u)),
              );
              setModUser((prev) => (prev ? { ...prev, ...patch } : prev));
            }}
            onGift={(u) => setGiftUser(u)}
          />
        )}

        {/* Subscription management dialog */}
        {subsUser && (
          <UserSubsDialog
            user={subsUser}
            onClose={() => setSubsUser(null)}
          />
        )}

        {/* Registered IPs dialog */}
        {ipUser && (
          <UserIpsDialog
            user={ipUser}
            onClose={() => setIpUser(null)}
          />
        )}

      {/* Standalone gift dialog */}
      {giftUser && (
        <GiftDialog
          userId={giftUser.id}
          username={giftUser.global_name ?? giftUser.username}
          onClose={() => setGiftUser(null)}
        />
      )}

      {/* Create proxy dialog */}
      <Dialog open={createProxyOpen} onOpenChange={(open) => !open && setCreateProxyOpen(false)}>
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              New Proxy
            </DialogTitle>
          </DialogHeader>
          <Separator />
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1">
                <label className="text-xs text-muted-foreground">Host</label>
                <Input
                  placeholder="proxy.example.com"
                  value={createProxyHost}
                  onChange={(e) => setCreateProxyHost(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Port</label>
                <Input
                  placeholder="8080"
                  type="number"
                  value={createProxyPort}
                  onChange={(e) => setCreateProxyPort(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Protocol</label>
              <div className="flex gap-2">
                {(["http", "socks5"] as const).map((proto) => (
                  <button
                    key={proto}
                    type="button"
                    onClick={() => setCreateProxyProtocol(proto)}
                    className={[
                      "flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium uppercase transition-colors",
                      createProxyProtocol === proto
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    {proto}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Username (optional)</label>
                <Input
                  placeholder="user"
                  value={createProxyUsername}
                  onChange={(e) => setCreateProxyUsername(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Password (optional)</label>
                <Input
                  placeholder="pass"
                  type="password"
                  value={createProxyPassword}
                  onChange={(e) => setCreateProxyPassword(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Label (optional)</label>
              <Input
                placeholder="e.g. US-East-01"
                value={createProxyLabel}
                onChange={(e) => setCreateProxyLabel(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Assign to User ID (optional)</label>
              <Input
                placeholder="user Discord ID"
                value={createProxyAssignedUserId}
                onChange={(e) => setCreateProxyAssignedUserId(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setCreateProxyOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!createProxyHost || !createProxyPort || createProxyLoading}
              onClick={handleCreateProxy}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {createProxyLoading ? "Creating…" : "Create Proxy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign proxy dialog */}
      {assignProxyRow && (
        <Dialog open onOpenChange={(open) => !open && setAssignProxyRow(null)}>
          <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                Assign Proxy
              </DialogTitle>
            </DialogHeader>
            <Separator />
            <div className="space-y-3 py-1">
              <p className="text-xs text-muted-foreground">
                Proxy: <span className="font-mono text-foreground">{assignProxyRow.host}:{assignProxyRow.port}</span>
              </p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">User Discord ID</label>
                <Input
                  placeholder="Discord user ID"
                  value={assignProxyUserId}
                  onChange={(e) => setAssignProxyUserId(e.target.value)}
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setAssignProxyRow(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!assignProxyUserId.trim() || assignProxyLoading}
                onClick={handleAssignProxy}
                className="gap-1.5"
              >
                <Globe className="h-3.5 w-3.5" />
                {assignProxyLoading ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Bulk proxy dialog */}
      <Dialog open={bulkProxyOpen} onOpenChange={(open) => { if (!open) setBulkProxyOpen(false); }}>
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-4 w-4 text-primary" />
              Bulk Add Proxies
            </DialogTitle>
          </DialogHeader>
          <Separator />
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              One proxy per line:{" "}
              <span className="font-mono text-foreground/60">host:port [http|socks5] [user:pass] [label]</span>
            </p>
            <Textarea
              placeholder={"1.2.3.4:8080 http user:pass MyProxy\n5.6.7.8:1080 socks5"}
              value={bulkProxyText}
              onChange={(e) => setBulkProxyText(e.target.value)}
              className="h-36 font-mono text-xs resize-none"
            />
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Assign to User ID (optional)</label>
              <Input
                placeholder="Discord user ID"
                value={bulkProxyAssignedUserId}
                onChange={(e) => setBulkProxyAssignedUserId(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            </div>
            {bulkProxyResults && (
              <div className="rounded-lg border border-border/40 bg-muted/20 p-2 space-y-1 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {bulkProxyResults.filter((r) => r.ok).length} / {bulkProxyResults.length} added
                </p>
                {bulkProxyResults.map((r, i) => (
                  <p key={i} className={`text-xs font-mono ${r.ok ? "text-green-400" : "text-red-400"}`}>
                    {r.ok ? "✓" : "✗"} {r.host}{r.port > 0 ? `:${r.port}` : ""}{r.error ? ` — ${r.error}` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setBulkProxyOpen(false)}>
              {bulkProxyResults ? "Close" : "Cancel"}
            </Button>
            {!bulkProxyResults && (
              <Button
                size="sm"
                disabled={!bulkProxyText.trim() || bulkProxyLoading}
                onClick={handleBulkCreateProxies}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                {bulkProxyLoading ? "Adding…" : "Add All"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ticket status/priority badge helpers (admin panel)
// ---------------------------------------------------------------------------

const ADMIN_TICKET_STATUS_MAP: Record<string, { label: string; className: string }> = {
  open:        { label: "Open",        className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  in_progress: { label: "In Progress", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  closed:      { label: "Closed",      className: "border-border bg-muted/20 text-muted-foreground" },
};

const ADMIN_TICKET_PRIORITY_MAP: Record<string, { label: string; className: string }> = {
  low:    { label: "Low",    className: "border-border bg-muted/20 text-muted-foreground" },
  normal: { label: "Normal", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" },
  high:   { label: "High",   className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400" },
  urgent: { label: "Urgent", className: "border-red-500/30 bg-red-500/10 text-red-400" },
};

function AdminTicketStatusBadge({ status }: { status: string }) {
  const entry = ADMIN_TICKET_STATUS_MAP[status] ?? { label: status, className: "border-border bg-muted/20 text-muted-foreground" };
  return <Badge variant="outline" className={`text-xs ${entry.className}`}>{entry.label}</Badge>;
}

function AdminTicketPriorityBadge({ priority }: { priority: string }) {
  const entry = ADMIN_TICKET_PRIORITY_MAP[priority] ?? { label: priority, className: "border-border bg-muted/20 text-muted-foreground" };
  return <Badge variant="outline" className={`text-xs ${entry.className}`}>{entry.label}</Badge>;
}

function ResponseStatusCell({ ticketId }: { ticketId: string }) {
  const [replied, setReplied] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminGetTicketMessages({ data: { ticketId } })
      .then((msgs) => {
        if (cancelled) return;
        const hasStaff = (msgs as TicketMessageRow[]).some((m) => m.is_staff === 1);
        setReplied(hasStaff);
      })
      .catch(() => {
        if (cancelled) return;
        setReplied(false);
      });
    return () => { cancelled = true; };
  }, [ticketId]);

  if (replied === null) {
    return <span className="h-2 w-2 rounded-full bg-muted/30 animate-pulse inline-block" />;
  }

  if (replied) {
    return (
      <Badge variant="outline" className="text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-400 gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" />
        Staff Replied
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-xs border-yellow-500/30 bg-yellow-500/10 text-yellow-400 gap-1">
      <Clock className="h-2.5 w-2.5" />
      Awaiting
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Admin ticket management dialog
// ---------------------------------------------------------------------------

type TicketWithUser = TicketRow & { username: string | null; global_name: string | null; avatar_url: string | null; has_staff_reply?: boolean };

function AdminTicketDialog({
  ticket: initialTicket,
  onClose,
  onUpdate,
}: {
  ticket: TicketWithUser;
  onClose: () => void;
  onUpdate: (patch: Partial<TicketRow>) => void;
}) {
  const [ticket, setTicket] = useState<TicketWithUser>(initialTicket);
  const [messages, setMessages] = useState<TicketMessageRow[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [hasStaffReply, setHasStaffReply] = useState<boolean>(
    (initialTicket as TicketWithUser & { has_staff_reply?: boolean }).has_staff_reply ?? false,
  );
  const [reply, setReply] = useState("");
  const [notifyUser, setNotifyUser] = useState(true);
  const [sending, setSending] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleDownloadTranscript() {
    setDownloading(true);
    try {
      const { filename, content } = await adminGetTicketTranscript({ data: { ticketId: ticket.id } });
      downloadTextFile(filename, content);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    setLoadingMsgs(true);
    adminGetTicketMessages({ data: { ticketId: ticket.id } })
      .then((msgs) => setMessages(msgs as TicketMessageRow[]))
      .finally(() => setLoadingMsgs(false));
  }, [ticket.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function applyPatch(patch: Partial<TicketRow>) {
    const updated = { ...patch, updated_at: Date.now() };
    setTicket((prev) => ({ ...prev, ...updated }));
    onUpdate(updated);
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await adminReplyTicket({ data: { ticketId: ticket.id, content: reply.trim(), notifyUser } });
      const msgs = await adminGetTicketMessages({ data: { ticketId: ticket.id } });
      setMessages(msgs as TicketMessageRow[]);
      setReply("");
      setHasStaffReply(true);
      if (ticket.status === "open") applyPatch({ status: "in_progress" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleAction(action: "close" | "reopen" | "claim") {
    setActioning(true);
    setError(null);
    try {
      await adminUpdateTicket({ data: { ticketId: ticket.id, action } });
      if (action === "close") applyPatch({ status: "closed" });
      if (action === "reopen") applyPatch({ status: "open" });
      if (action === "claim") applyPatch({ status: "in_progress" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActioning(false);
    }
  }

  async function handleSetPriority(priority: TicketRow["priority"]) {
    setActioning(true);
    try {
      await adminUpdateTicket({ data: { ticketId: ticket.id, action: "set_priority", priority } });
      applyPatch({ priority });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActioning(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 md:p-6">
      <div
        className="flex flex-col w-full max-w-xl h-full max-h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:min-h-[24rem] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden"
        style={{ animation: "fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) both" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/40 px-5 py-4 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <span className="text-xs font-mono text-muted-foreground/50">#{ticket.id.slice(-6).toUpperCase()}</span>
              <AdminTicketStatusBadge status={ticket.status} />
              <AdminTicketPriorityBadge priority={ticket.priority} />
              <Badge
                variant="outline"
                className={`text-xs gap-1 ${ticket.source === "web"
                  ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                  : "border-blue-500/30 bg-blue-500/10 text-blue-400"
                }`}
              >
                {ticket.source === "web" ? "Web" : "Discord"}
              </Badge>
              <Badge variant="outline" className="text-xs border-border/40 bg-muted/20 text-muted-foreground capitalize">
                {ticket.category}
              </Badge>
            </div>
            <p className="text-sm font-medium truncate">{ticket.subject}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {ticket.avatar_url && (
                <Avatar className="h-5 w-5">
                  <AvatarImage src={ticket.avatar_url} crossOrigin="anonymous" alt={ticket.username ?? ""} />
                  <AvatarFallback className="text-[8px]">{(ticket.username ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              )}
              <span className="text-xs text-muted-foreground">
                {ticket.global_name ?? ticket.username ?? ticket.discord_user_tag}
              </span>
              <span className="text-xs text-muted-foreground/40">·</span>
              <span className="text-xs text-muted-foreground/40" title="Created">
                Opened {new Date(ticket.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </span>
              {ticket.updated_at !== ticket.created_at && (
                <>
                  <span className="text-xs text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground/40" title="Last updated">
                    Updated {new Date(ticket.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50"
              onClick={handleDownloadTranscript}
              disabled={downloading}
              aria-label="Download transcript"
              title="Download transcript"
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/30 px-5 py-2.5 shrink-0 bg-muted/10">
          <div className="flex flex-wrap items-center gap-2">
            {ticket.status !== "closed" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={actioning}
                  onClick={() => handleAction("claim")}
                >
                  <Shield className="h-3.5 w-3.5 text-blue-400" />
                  Claim
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                  disabled={actioning}
                  onClick={() => handleAction("close")}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Close
                </Button>
              </>
            )}
            {ticket.status === "closed" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                disabled={actioning}
                onClick={() => handleAction("reopen")}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reopen
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Response status badge */}
            <div className="flex items-center gap-1.5">
              {hasStaffReply ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-400 gap-1">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  Staff Replied
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] border-yellow-500/30 bg-yellow-500/10 text-yellow-400 gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  Awaiting Response
                </Badge>
              )}
            </div>
            {/* Priority selector */}
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground/50 mr-0.5">Priority:</span>
              {(["low", "normal", "high", "urgent"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={actioning}
                  onClick={() => handleSetPriority(p)}
                  className={[
                    "rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
                    ticket.priority === p
                      ? "border " + ADMIN_TICKET_PRIORITY_MAP[p].className
                      : "text-muted-foreground/50 hover:text-muted-foreground",
                  ].join(" ")}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loadingMsgs ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading…
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex gap-2 ${msg.is_staff ? "flex-row-reverse" : "flex-row"}`}>
                <div
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold
                    ${msg.is_staff ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted/60 text-muted-foreground border border-border/40"}`}
                >
                  {msg.is_staff ? "S" : msg.author_tag.slice(0, 1).toUpperCase()}
                </div>
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${msg.is_staff
                      ? "rounded-tr-sm bg-primary/10 border border-primary/20 text-foreground/90"
                      : "rounded-tl-sm bg-muted/40 border border-border/30 text-foreground/80"
                    }`}
                >
                  <p className="mb-0.5 text-[10px] font-medium opacity-50">
                    {msg.is_staff ? "Staff" : msg.author_tag}
                    {" · "}{new Date(msg.created_at).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Reply area */}
        <div className="border-t border-border/40 px-5 py-3.5 shrink-0">
          {ticket.source !== "web" ? (
            <p className="text-center text-xs text-muted-foreground py-1">
              Discord ticket — reply via the Discord channel.
              {ticket.channel_id && (
                <a
                  href={`https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${ticket.channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Open channel
                </a>
              )}
            </p>
          ) : ticket.status === "closed" ? (
            <p className="text-center text-xs text-muted-foreground py-1">Ticket is closed.</p>
          ) : (
            <form onSubmit={handleReply} className="space-y-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply to the user…"
                className="min-h-[52px] max-h-28 resize-none text-sm py-2.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleReply(e as unknown as React.FormEvent);
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={notifyUser}
                    onChange={(e) => setNotifyUser(e.target.checked)}
                    className="rounded"
                  />
                  Notify user via DM
                </label>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!reply.trim() || sending}
                  className="gap-1.5"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sending ? "Sending…" : "Send Reply"}
                </Button>
              </div>
            </form>
          )}
          {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// User subscription management dialog
// ---------------------------------------------------------------------------

function UserIpsDialog({
  user,
  onClose,
}: {
  user: UserRow;
  onClose: () => void;
}) {
  const [ips, setIps] = useState<UserIpRow[] | null>(null);
  const [banned, setBanned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [actionMap, setActionMap] = useState<Record<string, boolean>>({});

  async function reload() {
    setLoading(true);
    try {
      const [rows, bannedRows] = await Promise.all([
        adminGetUserIps({ data: { userId: user.id } }),
        adminGetBannedIps(),
      ]);
      setIps(rows as UserIpRow[]);
      setBanned(new Set((bannedRows as { ip: string }[]).map((b) => b.ip)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  async function toggleBan(ip: string, isBanned: boolean) {
    setActionMap((m) => ({ ...m, [ip]: true }));
    try {
      if (isBanned) {
        await adminUnbanIp({ data: { ip } });
      } else {
        await adminBanIp({ data: { ip, reason: `Banned via ${user.username}'s IP list` } });
      }
      await reload();
    } finally {
      setActionMap((m) => ({ ...m, [ip]: false }));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg border-border/60 bg-card/95 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="h-7 w-7">
              {user.avatar_url && (
                <AvatarImage src={user.avatar_url} crossOrigin="anonymous" alt={user.username} />
              )}
              <AvatarFallback className="text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            Registered IPs — {user.global_name ?? user.username}
          </DialogTitle>
        </DialogHeader>
        <Separator />
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !ips || ips.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No IPs recorded yet. They are captured on the user&apos;s next login.
          </p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {ips.map((row) => {
              const isBanned = banned.has(row.ip);
              return (
                <div
                  key={row.ip}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm">{row.ip}</p>
                      {isBanned && (
                        <Badge
                          variant="outline"
                          className="border-red-500/40 bg-red-500/10 text-red-400 text-[10px]"
                        >
                          Banned
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {row.hits} login{row.hits === 1 ? "" : "s"} · last{" "}
                      {new Date(row.last_seen).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-7 gap-1.5 text-xs shrink-0 ${
                      isBanned
                        ? "border-green-500/30 text-green-400 hover:bg-green-500/10"
                        : "border-red-500/30 text-red-400 hover:bg-red-500/10"
                    }`}
                    disabled={actionMap[row.ip]}
                    onClick={() => toggleBan(row.ip, isBanned)}
                  >
                    {isBanned ? (
                      <><CheckCircle2 className="h-3.5 w-3.5" /> Unban</>
                    ) : (
                      <><Ban className="h-3.5 w-3.5" /> Ban IP</>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type SubWithPlan = SubscriptionRow & { plan: PlanRow | null };

function UserSubsDialog({
  user,
  onClose,
}: {
  user: UserRow;
  onClose: () => void;
}) {
  const [subs, setSubs] = useState<SubWithPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMap, setActionMap] = useState<Record<string, boolean>>({});
  const [giftOpen, setGiftOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const result = await adminGetUserSubscriptions({ data: { userId: user.id } });
      setSubs(result as SubWithPlan[]);
    } finally {
      setLoading(false);
    }
  }

  // Load on mount
  useEffect(() => { reload(); }, []);

  async function handleCancel(subId: string) {
    setActionMap((m) => ({ ...m, [subId + "cancel"]: true }));
    try {
      await adminCancelSubscription({ data: { subscriptionId: subId, userId: user.id } });
      await reload();
    } finally {
      setActionMap((m) => ({ ...m, [subId + "cancel"]: false }));
    }
  }

  async function handleActivate(subId: string) {
    setActionMap((m) => ({ ...m, [subId + "activate"]: true }));
    try {
      await adminActivateSubscription({ data: { subscriptionId: subId, userId: user.id, durationDays: 30 } });
      await reload();
    } finally {
      setActionMap((m) => ({ ...m, [subId + "activate"]: false }));
    }
  }

  const statusClass: Record<string, string> = {
    active: "border-green-500/30 bg-green-500/10 text-green-400",
    pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    canceled: "border-border bg-muted/20 text-muted-foreground",
    expired: "border-border bg-muted/20 text-muted-foreground",
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg border-border/60 bg-card/95 backdrop-blur-sm">
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-3">
              <Avatar className="h-7 w-7">
                {user.avatar_url && (
                  <AvatarImage src={user.avatar_url} crossOrigin="anonymous" alt={user.username} />
                )}
                <AvatarFallback className="text-xs">
                  {user.username.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              Subscriptions — {user.global_name ?? user.username}
            </DialogTitle>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 shrink-0"
              onClick={() => setGiftOpen(true)}
            >
              <Gift className="h-3.5 w-3.5" />
              Gift Sub
            </Button>
          </div>
        </DialogHeader>
        <Separator />
        {giftOpen && (
          <GiftDialog
            userId={user.id}
            username={user.global_name ?? user.username}
            onClose={() => { setGiftOpen(false); reload(); }}
          />
        )}
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !subs || subs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No subscriptions found.</p>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {subs.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{s.plan?.name ?? s.plan_id}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{s.id}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${statusClass[s.status] ?? "text-muted-foreground"}`}
                  >
                    {s.status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Created: {new Date(s.created_at).toLocaleDateString()}</span>
                  {s.started_at && <span>Started: {new Date(s.started_at).toLocaleDateString()}</span>}
                  {s.expires_at && <span>Expires: {new Date(s.expires_at).toLocaleDateString()}</span>}
                </div>
                <div className="flex gap-2 pt-1">
                  {s.status === "active" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                      disabled={actionMap[s.id + "cancel"]}
                      onClick={() => handleCancel(s.id)}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  )}
                  {(s.status === "pending" || s.status === "canceled" || s.status === "expired") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                      disabled={actionMap[s.id + "activate"]}
                      onClick={() => handleActivate(s.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Activate (30d)
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Gift subscription dialog
// ---------------------------------------------------------------------------

const DURATION_PRESETS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "1 year", days: 365 },
];

const KEY_PLUGIN_OPTIONS = [
  { id: "discord-spam", label: "Discord Spam" },
  { id: "discord-autoreply", label: "Discord Auto-Reply" },
] as const;

// ---------------------------------------------------------------------------
// Keys tab — create & manage redeemable keys
// ---------------------------------------------------------------------------

function KeysTab() {
  const [keys, setKeys] = useState<RedeemKeyRow[] | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [type, setType] = useState<"subscription" | "plugin">("subscription");
  const [planId, setPlanId] = useState("");
  const [pluginId, setPluginId] =
    useState<(typeof KEY_PLUGIN_OPTIONS)[number]["id"]>("discord-spam");
  const [days, setDays] = useState(30);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<RedeemKeyRow[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    try {
      const [k, p] = await Promise.all([adminGetKeys(), getPlans()]);
      setKeys(k as RedeemKeyRow[]);
      setPlans(p);
      if (p.length > 0 && !planId) setPlanId(p[0].id);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canCreate =
    !creating &&
    quantity >= 1 &&
    (type === "plugin" || (type === "subscription" && !!planId && days > 0));

  async function handleCreate() {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    setJustCreated(null);
    try {
      const res = await adminCreateKey({
        data: {
          type,
          planId: type === "subscription" ? planId : undefined,
          pluginId: type === "plugin" ? pluginId : undefined,
          durationDays: type === "subscription" ? days : undefined,
          note: note.trim() || undefined,
          quantity,
        },
      });
      setJustCreated(res.keys as RedeemKeyRow[]);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting((m) => ({ ...m, [id]: true }));
    try {
      await adminDeleteKey({ data: { id } });
      setKeys((prev) => (prev ? prev.filter((k) => k.id !== id) : prev));
    } finally {
      setDeleting((m) => ({ ...m, [id]: false }));
    }
  }

  async function copyCode(code: string) {
    await navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
  }

  function describeKey(k: RedeemKeyRow): string {
    if (k.type === "subscription") {
      const plan = plans.find((p) => p.id === k.plan_id);
      return `${plan?.name ?? k.plan_id} · ${k.duration_days ?? 30}d`;
    }
    const plug = KEY_PLUGIN_OPTIONS.find((p) => p.id === k.plugin_id);
    return `${plug?.label ?? k.plugin_id} plugin`;
  }

  return (
    <div className="space-y-6">
      {/* Create form */}
      <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Create Keys</h3>
        </div>

        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2 max-w-xs">
          {(["subscription", "plugin"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={[
                "rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors",
                type === t
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-foreground/30",
              ].join(" ")}
            >
              {t}
            </button>
          ))}
        </div>

        {type === "subscription" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Plan
              </label>
              <div className="space-y-1.5">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={[
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                      planId === p.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ${p.price_usd}/{p.interval}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Duration
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    onClick={() => setDays(preset.days)}
                    className={[
                      "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                      days === preset.days
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-w-xs">
            <label className="text-xs font-medium text-muted-foreground">
              Plugin
            </label>
            <div className="space-y-1.5">
              {KEY_PLUGIN_OPTIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPluginId(p.id)}
                  className={[
                    "flex w-full items-center rounded-lg border px-3 py-2 text-sm transition-colors",
                    pluginId === p.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/30",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity + note */}
        <div className="grid gap-4 md:grid-cols-2 max-w-xl">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Quantity (1–100)
            </label>
            <Input
              type="number"
              min={1}
              max={100}
              value={quantity}
              onChange={(e) =>
                setQuantity(
                  Math.max(1, Math.min(100, parseInt(e.target.value) || 1)),
                )
              }
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Note (optional)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. giveaway batch"
              className="h-9 text-sm"
            />
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        )}

        <Button onClick={handleCreate} disabled={!canCreate} className="gap-1.5">
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {creating
            ? "Creating…"
            : `Create ${quantity > 1 ? `${quantity} keys` : "key"}`}
        </Button>

        {justCreated && justCreated.length > 0 && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 space-y-1.5">
            <p className="text-xs font-medium text-green-400">
              Created {justCreated.length} key{justCreated.length > 1 ? "s" : ""}:
            </p>
            {justCreated.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-2"
              >
                <code className="font-mono text-xs">{k.code}</code>
                <button
                  type="button"
                  onClick={() => copyCode(k.code)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Copy key"
                >
                  {copied === k.code ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Existing keys */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading keys…
          </div>
        ) : !keys || keys.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No keys yet. Create some above.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Grants</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-mono text-xs">{k.code}</TableCell>
                  <TableCell className="text-xs">{describeKey(k)}</TableCell>
                  <TableCell>
                    {k.redeemed_by ? (
                      <Badge
                        variant="outline"
                        className="text-xs border-muted-foreground/30 text-muted-foreground"
                      >
                        Redeemed
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs border-green-500/30 bg-green-500/10 text-green-400"
                      >
                        Available
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {k.note ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => copyCode(k.code)}
                        aria-label="Copy key"
                      >
                        {copied === k.code ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(k.id)}
                        disabled={deleting[k.id]}
                        aria-label="Delete key"
                      >
                        {deleting[k.id] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function GiftDialog({
  userId,
  username,
  onClose,
}: {
  userId: string;
  username: string;
  onClose: () => void;
}) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [customPlanId, setCustomPlanId] = useState("");
  const [selectedDays, setSelectedDays] = useState(30);
  const [useCustomDays, setUseCustomDays] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getPlans().then((p) => {
      setPlans(p);
      if (p.length > 0) setPlanId(p[0].id);
    });
  }, []);

  const resolvedPlanId = planId === "__custom__" ? customPlanId.trim() : planId;
  const resolvedDays = useCustomDays ? parseInt(customDays) : selectedDays;
  const canSubmit = !!resolvedPlanId && resolvedDays > 0 && !loading;

  async function handleGift() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await adminGiftSubscription({ data: { userId, planId: resolvedPlanId, durationDays: resolvedDays } });
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm border-border/60 bg-card/95 backdrop-blur-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-amber-400" />
            Gift Subscription — {username}
          </DialogTitle>
        </DialogHeader>
        <Separator />
        <div className="space-y-4 py-1">
          {/* Plan selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Plan</label>
            {!plans ? (
              <p className="text-xs text-muted-foreground">Loading plans…</p>
            ) : (
              <div className="space-y-1.5">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlanId(p.id)}
                    className={[
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                      planId === p.id
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">${p.price_usd}/mo</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPlanId("__custom__")}
                  className={[
                    "flex w-full items-center rounded-lg border px-3 py-2 text-sm transition-colors",
                    planId === "__custom__"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/30",
                  ].join(" ")}
                >
                  Custom plan ID…
                </button>
                {planId === "__custom__" && (
                  <Input
                    placeholder="plan_id (e.g. pro)"
                    value={customPlanId}
                    onChange={(e) => setCustomPlanId(e.target.value)}
                    className="h-8 text-sm font-mono"
                    autoFocus
                  />
                )}
              </div>
            )}
          </div>

          {/* Duration selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Duration</label>
            <div className="grid grid-cols-3 gap-1.5">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => { setSelectedDays(preset.days); setUseCustomDays(false); }}
                  className={[
                    "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                    !useCustomDays && selectedDays === preset.days
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30",
                  ].join(" ")}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUseCustomDays(true)}
                className={[
                  "rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                  useCustomDays
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30",
                ].join(" ")}
              >
                Custom
              </button>
            </div>
            {useCustomDays && (
              <Input
                placeholder="Number of days"
                type="number"
                min={1}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={handleGift}
            className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            variant="outline"
          >
            <Gift className="h-3.5 w-3.5" />
            {loading ? "Gifting…" : `Gift ${resolvedDays > 0 ? resolvedDays + "d" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub status badge
// ---------------------------------------------------------------------------

function SubStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "border-green-500/30 bg-green-500/10 text-green-400",
    pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    canceled: "border-border bg-muted/20 text-muted-foreground",
    expired: "border-border bg-muted/20 text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={`text-xs capitalize ${map[status] ?? "text-muted-foreground"}`}>
      {status}
    </Badge>
  );
}

function AdminStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card/90 hover:shadow-[0_8px_24px_oklch(0_0_0/0.4)]">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-border/50 bg-muted/30 transition-colors duration-200 group-hover:bg-muted/50">
          {icon}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PayStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    waiting: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    confirming: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    paid: "border-green-500/30 bg-green-500/10 text-green-400",
    expired: "border-border bg-muted/20 text-muted-foreground",
    failed: "border-red-500/30 bg-red-500/10 text-red-400",
  };
  return (
    <Badge
      variant="outline"
      className={`text-xs capitalize ${map[status] ?? "text-muted-foreground"}`}
    >
      {status}
    </Badge>
  );
}

