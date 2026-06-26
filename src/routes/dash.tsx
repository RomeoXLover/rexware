import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, forwardRef } from "react";
import { createPortal } from "react-dom";
import * as Recharts from "recharts";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Bell,
  Settings,
  ShoppingCart,
  Bot,
  Activity,
  CreditCard,
  Users,
  ChevronRight,
  TrendingUp,
  Globe,
  XCircle,
  Plus,
  Minus,
  List,
  Clock,
  Timer,
  Ticket,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Download,
  MessageSquare,
  FileText,
  Send,
  Lock,
  Crown,
  Puzzle,
  Check,
  Trash2,
  Terminal,
  Square,
  Play,
  UserPlus,
  KeyRound,
  Sparkles,
  Bitcoin,
  ChevronDown,
  Hash,
  Reply,
  Zap,
  Gift,
  Copy,
  Wallet,
  Shuffle,
  Eye,
  EyeOff,
  Save,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  fetchSessionUser,
  fetchBanStatus,
  fetchMaintenance,
  logout,
} from "@/lib/api/auth.functions";
import type { BanReason } from "@/lib/auth.server";
import {
  getNotifications,
  getSettings,
  getPlans,
  getMySubscription,
  getMyPayments,
  cancelMyPayment,
  getMyProxies,
  addMyProxy,
  addMyProxiesBulk,
  getMyTickets,
  openTicketWeb,
  getTicketMessages,
  sendTicketMessage,
  getTicketTranscript,
  getMyReferral,
  getMyOverviewStats,
  getApprovedReviews,
  type ApprovedReview,
  type MyReferral,
} from "@/lib/api/dashboard.functions";
// bots.functions is server-only (requires Docker) so it can't be imported directly
// in a client component — importing it here ensures the server functions are
// registered in the SSR bundle where the router plugin can find them.
import "@/lib/api/bots.functions";
import {
  getMyPlugins,
  initPluginPayment,
  savePluginConfig,
  runPlugin,
  stopPluginRun,
  getPluginRunLogs,
  getChatMessages,
  sendChatMessage,
  PLUGIN_AVAILABLE,
  PLUGIN_PRICE_USD,
  type PluginId,
} from "@/lib/api/plugins.functions";
import { BotsManager } from "@/components/BotsManager";
import { DiscordDmPanel } from "@/components/DiscordDmPanel";
import { GlobalChatSection } from "@/components/GlobalChatSection";
import { CryptoInvoiceFlow } from "@/components/CryptoInvoiceFlow";
import type { PaymentInfo } from "@/components/CryptoInvoiceFlow";
import type { PluginRunRow } from "@/lib/repos.server";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { adminGetStats } from "@/lib/api/admin.functions";
import type { SessionUser } from "@/lib/auth.server";
import type {
  NotificationRow,
  UserSettingsRow,
  PlanRow,
  SubscriptionRow,
  PaymentRow,
  ProxyRow,
  TicketRow,
  TicketMessageRow,
} from "@/lib/repos.server";
import { SettingsDialog } from "@/components/SettingsDialog";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { useTosDialog, TosDialog, BlockedPopup } from "@/components/TosDialog";
import { PurchasePage } from "@/components/PurchasePage";
import { usePreferences, useT } from "@/lib/preferences";
import {
  ChartContainer,
  ChartTooltip,
  ChartConfig,
  ChartLegend,
} from "@/components/ui/chart";

// ---------------------------------------------------------------------------
// Types & Route
// ---------------------------------------------------------------------------

type DashboardSection =
  | "overview"
  | "purchase"
  | "bots"
  | "billing"
  | "referrals"
  | "proxies"
  | "reviews"
  | "plugin-discord-spam"
  | "plugin-discord-autoreply"
  | "chat"
  | "tickets";

interface PluginStateRow {
  pluginId: PluginId;
  purchased: boolean;
  configJson: string | null;
  activeRun: PluginRunRow | null;
}

interface LoaderData {
  user: SessionUser | null;
  banReason: BanReason;
  isAdmin: boolean;
  isOwner: boolean;
  notifications: NotificationRow[];
  settings: UserSettingsRow | null;
  plans: PlanRow[];
  currentSubscription: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
  payments: PaymentRow[];
  tickets: TicketRow[];
  plugins: PluginStateRow[];
  reviews: ApprovedReview[];
  overviewStats: {
    onlineBots: number;
    offlineBots: number;
    totalBots: number;
    weeklyHistory: { date: string; online: number }[];
  } | null;
}

export const Route = createFileRoute("/dash")({
  beforeLoad: async () => {
    const [user, banReason, maintenance] = await Promise.all([
    fetchSessionUser(),
    fetchBanStatus(),
    fetchMaintenance(),
    ]);
    // Maintenance gate: block everyone except admins.
    if (maintenance.enabled && !maintenance.bypass) {
    throw redirect({ to: "/maintenance" });
    }
    // Not logged in at all → back to home
    if (!user && !banReason) throw redirect({ to: "/" });
    // Return both so the loader can pass them down
    return { user, banReason };
  },
  loader: async ({ context }) => {
    const { user, banReason } = context as {
      user: SessionUser | null;
      banReason: BanReason;
    };

    // Banned: skip all data fetches, render the ban screen
    if (banReason) {
      return {
        user,
        banReason,
        isAdmin: false,
        isOwner: false,
        notifications: [],
        settings: null,
        plans: [],
        currentSubscription: null,
        payments: [],
        tickets: [],
        plugins: [],
        reviews: [],
        overviewStats: null,
      } satisfies LoaderData;
    }

    const [
      notifications,
      settings,
      plans,
      currentSubscription,
      payments,
      tickets,
      plugins,
      overviewStatsResult,
      reviewsResult,
    ] = await Promise.allSettled([
      getNotifications(),
      getSettings(),
      getPlans(),
      getMySubscription(),
      getMyPayments(),
      getMyTickets(),
      getMyPlugins(),
      getMyOverviewStats(),
      getApprovedReviews(),
    ]);
    let isAdmin = false;
    let isOwner = false;
    try {
      await adminGetStats();
      isAdmin = true;
    } catch {
      // not admin
    }
    // Check if user is an owner (from DB)
    isOwner = !!(user?.is_owner);
    // Owner always has admin access
    if (isOwner) isAdmin = true;
    return {
      user,
      banReason: null,
      isAdmin,
      isOwner,
      notifications:
        notifications.status === "fulfilled" ? notifications.value : [],
      settings: settings.status === "fulfilled" ? settings.value : null,
      plans: plans.status === "fulfilled" ? plans.value : [],
      currentSubscription:
        currentSubscription.status === "fulfilled"
          ? currentSubscription.value
          : null,
      payments: payments.status === "fulfilled" ? payments.value : [],
      tickets: tickets.status === "fulfilled" ? tickets.value : [],
      plugins:
        plugins.status === "fulfilled"
          ? (plugins.value as PluginStateRow[])
          : [],
      overviewStats:
        overviewStatsResult.status === "fulfilled"
          ? overviewStatsResult.value
          : null,
      reviews:
        reviewsResult.status === "fulfilled"
          ? reviewsResult.value
          : [],
    } satisfies LoaderData;
  },
  component: Dashboard,
});

// ---------------------------------------------------------------------------
// Animated number counter
// ---------------------------------------------------------------------------

function AnimatedNumber({
  target,
  duration = 1200,
}: {
  target: number;
  duration?: number;
}) {
  const [current, setCurrent] = useState(0);
  const animRef = useRef<number>(0);
  const startedRef = useRef(false);
  const nodeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || startedRef.current) return;
        startedRef.current = true;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - t, 3);
          setCurrent(Math.round(ease * target));
          if (t < 1) animRef.current = requestAnimationFrame(tick);
        };
        animRef.current = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(animRef.current);
    };
  }, [target, duration]);

  return <span ref={nodeRef}>{current}</span>;
}

// ---------------------------------------------------------------------------
// Dashboard root
// ---------------------------------------------------------------------------

function BannedScreen({
  reason,
  user,
}: {
  reason: BanReason;
  user: SessionUser | null;
}) {
  const t = useT();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

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

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground px-6">
      <div
        className="w-full max-w-md rounded-2xl border border-border/60 bg-card/60 p-10 text-center backdrop-blur-sm"
        style={{
          boxShadow:
            "0 0 0 1px oklch(1 0 0/0.06), 0 24px 64px oklch(0 0 0/0.55)",
        }}
      >
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-red-900/40 bg-red-950/30">
          <svg
            className="h-7 w-7 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-xl font-semibold tracking-tight">
          {t("dash.banned.title")}
        </h1>
        <p className="mb-1 text-sm text-foreground/60 leading-relaxed">
          {reason === "ip"
            ? t("dash.banned.reasonIp")
            : t("dash.banned.reasonAcct")}
        </p>
        <p className="text-xs text-foreground/40 mb-8">
          {t("dash.banned.contact")}
        </p>

        {user && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-border/40 bg-background/50 px-4 py-3">
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="h-8 w-8 rounded-full"
            />
            <div className="text-left min-w-0">
              <p className="truncate text-sm font-medium">
                {user.globalName ?? user.username}
              </p>
              <p className="truncate text-xs text-foreground/40">
                @{user.username}
              </p>
            </div>
            <span className="ml-auto shrink-0 rounded-full bg-red-950/50 px-2 py-0.5 text-[10px] font-medium text-red-400 border border-red-900/30">
              {t("dash.banned.badge")}
            </span>
          </div>
        )}

        <Button
          variant="outline"
          className="w-full"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? t("dash.banned.signingOut") : t("dash.banned.signOut")}
        </Button>
      </div>
    </div>
  );
}

function Dashboard() {
  const data = Route.useLoaderData() as LoaderData;
  const t = useT();
  const router = useRouter();

  // Show ban screen immediately — user stays logged in but cannot access dashboard
  if (data.banReason) {
    return <BannedScreen reason={data.banReason} user={data.user} />;
  }

  const user = data.user!;

  const [section, setSection] = useState<DashboardSection>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [notifications, setNotifications] = useState<NotificationRow[]>(
    data.notifications,
  );
  const [settings, setSettings] = useState<UserSettingsRow | null>(
    data.settings,
  );

  const unreadCount = notifications.filter((n) => n.read === 0).length;

  // ToS gate — enforced here in the dashboard (moved off the public landing).
  const {
    open: tosOpen,
    accept: acceptTos,
    decline: declineTos,
    setOpen: setTosOpen,
    isBlocked: tosBlocked,
    showBlockedPopup,
    closeBlockedPopup,
    leaveSite,
  } = useTosDialog({ gate: true });

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

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

  // Block the dashboard behind the ToS gate until the user accepts.
  if (tosBlocked) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <TosDialog
          open={tosOpen}
          gate
          onAccept={acceptTos}
          onDecline={declineTos}
          onOpenChange={setTosOpen}
        />
        <BlockedPopup
          open={showBlockedPopup}
          onAccept={closeBlockedPopup}
          onLeave={leaveSite}
        />
      </div>
    );
  }

  return (
    <div className="ac-dash-root relative flex min-h-screen text-foreground">
      {/* Ambient glass backdrop — colored orbs the frosted surfaces blur over */}
      <div
        aria-hidden
        className="ac-dash-bg pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="ac-dash-orb ac-dash-orb-1" />
        <div className="ac-dash-orb ac-dash-orb-2" />
        <div className="ac-dash-orb ac-dash-orb-3" />
        <div className="ac-dash-orb ac-dash-orb-4" />
      </div>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar/95 backdrop-blur-xl px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="RexWare" className="h-6 w-6" />
          <span className="font-semibold tracking-tight">RexWare</span>
        </div>
        <div className="flex items-center gap-1">
          <NotifButton
            unreadCount={unreadCount}
            onClick={() => setNotifOpen(true)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={mobileOpen ? t("dash.menu.close") : t("dash.menu.open")}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </header>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label={t("dash.menu.close")}
          className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        user={user}
        isAdmin={data.isAdmin}
        isOwner={data.isOwner}
        section={section}
        onSection={(s) => {
          setSection(s);
          setMobileOpen(false);
        }}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        mobileOpen={mobileOpen}
        unreadCount={unreadCount}
        onOpenNotifs={() => setNotifOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main */}
      <main
        className="relative flex-1 px-5 pb-24 pt-20 md:ml-72 md:px-14 md:pt-14 lg:px-16"
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "translateY(0)" : "translateY(12px)",
          transition:
            "opacity 0.55s cubic-bezier(0.22,1,0.36,1), transform 0.55s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Ambient top glow */}
        <div
          aria-hidden
          className="ac-dash-ambient pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        />

        <div className="relative mx-auto w-full max-w-[1440px]">
          {/* Desktop header */}
          <div className="mb-10 hidden items-start justify-between gap-8 md:flex">
            <div className="space-y-3">
              <p className="ac-rise text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground/55">
                {sectionEyebrow(section, t)}
              </p>
              <h1 className="ac-display ac-rise ac-d1 text-balance text-4xl text-foreground lg:text-5xl">
                {sectionHeadline(section, !!data.currentSubscription, t)}
              </h1>
              <p className="ac-rise ac-d2 max-w-2xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
                {sectionSubtitle(
                  section,
                  !!data.currentSubscription,
                  user.globalName ?? user.username,
                  t,
                )}
              </p>
            </div>
            <NotifButton
              unreadCount={unreadCount}
              onClick={() => setNotifOpen(true)}
            />
          </div>

          {/* Mobile header */}
          <div className="mb-8 md:hidden">
            <p className="ac-rise text-[10px] font-semibold uppercase tracking-[0.26em] text-muted-foreground/55">
              {sectionEyebrow(section, t)}
            </p>
            <h1 className="ac-display ac-rise ac-d1 mt-2 text-balance text-[2rem] text-foreground">
              {sectionHeadline(section, !!data.currentSubscription, t)}
            </h1>
            <p className="ac-rise ac-d2 mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
              {sectionSubtitle(
                section,
                !!data.currentSubscription,
                user.globalName ?? user.username,
                t,
              )}
            </p>
          </div>

          <div key={section} className="ac-tab-panel">
            <SectionContent
              section={section}
              data={data}
              onNavigate={setSection}
            />
          </div>
        </div>
      </main>

      <NotificationsPanel
        open={notifOpen}
        onOpenChange={setNotifOpen}
        notifications={notifications}
        onUpdate={setNotifications}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        user={data.user}
        settings={settings}
        onSettingsUpdated={setSettings}
        isAdmin={data.isAdmin}
        currentSubscription={data.currentSubscription}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const NAV_ITEMS: {
  id: DashboardSection;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "overview",
    label: "dash.sec.overview",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    id: "purchase",
    label: "dash.sec.purchase",
    icon: <ShoppingCart className="h-4 w-4" />,
  },
  { id: "bots", label: "dash.sec.bots", icon: <Bot className="h-4 w-4" /> },
  {
    id: "billing",
    label: "dash.sec.billing",
    icon: <CreditCard className="h-4 w-4" />,
  },
  {
    id: "referrals",
    label: "dash.sec.referrals",
    icon: <Gift className="h-4 w-4" />,
  },
  {
    id: "proxies",
    label: "dash.sec.proxies",
    icon: <Globe className="h-4 w-4" />,
  },
  {
    id: "reviews",
    label: "dash.sec.reviews",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    id: "tickets",
    label: "dash.nav.tickets",
    icon: <Ticket className="h-4 w-4" />,
  },
  {
    id: "chat",
    label: "dash.nav.chat",
    icon: <Hash className="h-4 w-4" />,
  },
];

function Sidebar({
  user,
  isAdmin,
  isOwner,
  section,
  onSection,
  onLogout,
  loggingOut,
  mobileOpen,
  unreadCount,
  onOpenNotifs,
  onOpenSettings,
}: {
  user: SessionUser;
  isAdmin: boolean;
  isOwner: boolean;
  section: DashboardSection;
  onSection: (s: DashboardSection) => void;
  onLogout: () => void;
  loggingOut: boolean;
  mobileOpen: boolean;
  unreadCount: number;
  onOpenNotifs: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const navTrackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Update sliding indicator position whenever the active section changes
  useEffect(() => {
    const track = navTrackRef.current;
    if (!track) return;
    const idx = NAV_ITEMS.findIndex((n) => n.id === section);
    const el = itemRefs.current.get(idx);
    if (!el) return;
    const trackRect = track.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const top = elRect.top - trackRect.top;
    track.style.setProperty("--nav-top", `${top}px`);
    track.style.setProperty("--nav-h", `${elRect.height}px`);
  }, [section]);

  return (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="nex-brand-mark">
          <img src="/logo.png" alt="" className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="text-[17px] font-semibold tracking-tight">
          RexWare
        </span>
      </div>

      {/* Nav */}
      <nav
        className="flex-1 overflow-y-auto px-4 py-2 space-y-1 no-scrollbar"
        aria-label={t("dash.mainNav")}
      >
        <div
          ref={navTrackRef}
          className="nex-nav-track space-y-1"
          style={{ position: "relative" }}
        >
          {/* Sliding indicator */}
          <span
            className="nex-nav-indicator"
            style={{ top: "var(--nav-top, 0px)", height: "var(--nav-h, 40px)" }}
          />
          {NAV_ITEMS.map((item, i) => (
            <NavItem
              key={item.id}
              label={t(item.label)}
              icon={item.icon}
              active={section === item.id}
              onClick={() => onSection(item.id)}
              index={i}
              ref={(el) => {
                if (el) itemRefs.current.set(i, el);
              }}
            />
          ))}
        </div>

        {/* Plugins section */}
        <Separator className="my-2 opacity-40" />
        <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
          {t("dash.nav.plugins")}
        </p>

        <NavItem
          label={t("dash.plugin.discordSpam")}
          icon={<Puzzle className="h-4 w-4" />}
          active={section === "plugin-discord-spam"}
          onClick={() => onSection("plugin-discord-spam")}
          index={NAV_ITEMS.length}
        />
        <NavItem
          label={t("dash.plugin.discordAutoReply")}
          icon={<MessageSquare className="h-4 w-4" />}
          active={section === "plugin-discord-autoreply"}
          onClick={() => onSection("plugin-discord-autoreply")}
          index={NAV_ITEMS.length + 1}
        />

        {isAdmin && (
          <>
            <Separator className="my-2 opacity-40" />
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              {t("dash.nav.admin")}
            </p>
            <a
              href="/admin"
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <Users className="h-4 w-4" />
              {t("dash.nav.adminPanel")}
              <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-40" />
            </a>
          </>
        )}
      </nav>

      {/* Bottom: account + settings/logout */}
      <div className="border-t border-sidebar-border p-3 space-y-3">
        <div className="flex items-center gap-3 rounded-2xl border border-sidebar-border bg-sidebar-accent/30 px-3 py-3">
          <Avatar className="h-9 w-9 shrink-0 ring-1 ring-white/10">
            <AvatarImage
              src={user.avatarUrl}
              alt={`${user.username} avatar`}
              crossOrigin="anonymous"
            />
            <AvatarFallback className="text-xs">
              {user.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold leading-tight">
                {user.globalName ?? user.username}
              </p>
              {isOwner && (
                <span className="inline-flex items-center rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                  <Crown className="h-3 w-3 mr-0.5" />
                  Owner
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              @{user.username}
            </p>
          </div>
          <span className="grid h-2 w-2 place-items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-9 justify-center gap-2 rounded-xl border-destructive/30 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onLogout}
            disabled={loggingOut}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "…" : t("dash.logout")}
          </Button>
          <Button
            variant="outline"
            className="h-9 justify-center gap-2 rounded-xl text-sm text-muted-foreground hover:text-foreground"
            onClick={onOpenSettings}
          >
            <Settings className="h-4 w-4" />
            {t("dash.nav.settings")}
          </Button>
        </div>
      </div>
    </aside>
  );
}

const NavItem = forwardRef<HTMLButtonElement, {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  index: number;
}>(function NavItem({ label, icon, active, onClick, index }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={[
        "nex-nav-item group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 text-left",
        active
          ? "nex-nav-item-active"
          : "nex-nav-item-idle",
      ].join(" ")}
      style={{
        animation: `fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) ${index * 60 + 100}ms both`,
      }}
    >
      <span
        className={[
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-200",
          active
            ? "bg-white/15 text-white"
            : "text-white/50 group-hover:bg-white/10 group-hover:text-white/80",
        ].join(" ")}
      >
        {icon}
      </span>
      {label}
      <ChevronRight
        className={[
          "ml-auto h-3.5 w-3.5 transition-all duration-200",
          active
            ? "opacity-50"
            : "translate-x-[-2px] opacity-0 group-hover:translate-x-0 group-hover:opacity-25",
        ].join(" ")}
      />
    </button>
  );
});
NavItem.displayName = "NavItem";

function NotifButton({
  unreadCount,
  onClick,
}: {
  unreadCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="icon"
      className="relative h-11 w-11 rounded-xl border-border/60 bg-card/40 hover:bg-card/80 transition-colors duration-200"
      onClick={onClick}
      aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 && (
        <span
          className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
          style={{
            animation: "ac-badge-pop 0.4s cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Section content switcher
// ---------------------------------------------------------------------------

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

function sectionLabel(s: DashboardSection, t: TFunc): string {
  return (
    {
      overview: t("dash.sec.overview"),
      purchase: t("dash.sec.purchase"),
      bots: t("dash.sec.bots"),
      billing: t("dash.sec.billing"),
      referrals: t("dash.sec.referrals"),
      proxies: t("dash.sec.proxies"),
      reviews: t("dash.sec.reviews"),
      "plugin-discord-spam": t("dash.plugin.discordSpam"),
      "plugin-discord-autoreply": t("dash.plugin.discordAutoReply"),
      chat: t("dash.nav.chat"),
      tickets: t("dash.section.supportTickets"),
    }[s] ?? s
  );
}

/** Tiny uppercase eyebrow shown above the page headline. */
function sectionEyebrow(s: DashboardSection, t: TFunc): string {
  return (
    {
      overview: t("dash.eyebrow.dashboard"),
      purchase: t("dash.eyebrow.billing"),
      bots: t("dash.eyebrow.deployment"),
      billing: t("dash.eyebrow.billing"),
      referrals: t("dash.eyebrow.rewards"),
      proxies: t("dash.eyebrow.network"),
      reviews: t("dash.eyebrow.reviews"),
      "plugin-discord-spam": t("dash.eyebrow.plugin"),
      "plugin-discord-autoreply": t("dash.eyebrow.plugin"),
      chat: t("dash.eyebrow.tools"),
      tickets: t("dash.eyebrow.support"),
    }[s] ?? t("dash.eyebrow.dashboard")
  );
}

/** Big page headline. Overview adapts to subscription state. */
function sectionHeadline(
  s: DashboardSection,
  hasSub: boolean,
  t: TFunc,
): string {
  if (s === "overview")
    return hasSub ? t("dash.headline.welcomeBack") : t("dash.headline.getStarted");
  return sectionLabel(s, t);
}

/** Supporting subtitle under the headline. */
function sectionSubtitle(
  s: DashboardSection,
  hasSub: boolean,
  name: string,
  t: TFunc,
): string {
  switch (s) {
    case "overview":
      return hasSub
        ? t("dash.subtitle.overviewActive", { name })
        : t("dash.subtitle.overviewInactive");
    case "purchase":
      return t("dash.subtitle.purchase");
    case "bots":
      return t("dash.subtitle.bots");
    case "billing":
      return t("dash.subtitle.billing");
    case "referrals":
      return t("dash.subtitle.referrals");
    case "proxies":
      return t("dash.subtitle.proxies");
    case "reviews":
      return t("dash.subtitle.reviews");
    case "plugin-discord-spam":
      return t("dash.subtitle.spam");
    case "plugin-discord-autoreply":
      return t("dash.subtitle.autoReply");
    case "tickets":
      return t("dash.subtitle.tickets");
    default:
      return "";
  }
}

function SectionContent({
  section,
  data,
  onNavigate,
}: {
  section: DashboardSection;
  data: LoaderData;
  onNavigate: (s: DashboardSection) => void;
}) {
  switch (section) {
    case "overview":
      return <OverviewSection data={data} onNavigate={onNavigate} />;
    case "purchase":
      return (
        <PurchasePage
          plans={data.plans}
          currentSubscription={data.currentSubscription}
        />
      );
    case "bots":
      return <BotsSection currentSubscription={data.currentSubscription} />;
    case "billing":
      return (
        <BillingSection
          payments={data.payments}
          subscription={data.currentSubscription}
        />
      );
    case "referrals":
      return <ReferralsSection />;
    case "proxies":
      return <ProxiesSection currentSubscription={data.currentSubscription} />;
    case "reviews":
      return <ReviewsSection reviews={data.reviews} />;
    case "plugin-discord-spam":
      return <PluginPage pluginId="discord-spam" plugins={data.plugins} />;
    case "plugin-discord-autoreply":
      return <PluginPage pluginId="discord-autoreply" plugins={data.plugins} />;
    case "chat":
      return <GlobalChatSection />;
    case "tickets":
      return (
        <TicketsSection
          tickets={data.tickets}
          currentSubscription={data.currentSubscription}
          onNavigate={onNavigate}
        />
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Overview section
// ---------------------------------------------------------------------------

function OverviewSection({
  data,
  onNavigate,
}: {
  data: LoaderData;
  onNavigate: (s: DashboardSection) => void;
}) {
  const t = useT();
  const { formatPrice } = usePreferences();
  const { currentSubscription, payments, tickets } = data;
  const recentPayments = payments.slice(0, 3);
  const plan = currentSubscription?.plan;
  const maxBots = plan?.max_bots ?? 0;
  const botHours = plan?.bot_hours ?? 0;
  const maxProxies = plan?.max_proxies ?? 0;
  const openTickets = (tickets ?? []).filter(
    (t) => t.status !== "closed",
  ).length;
  const expiresAt = currentSubscription?.subscription?.expires_at;

  // No subscription → clean, focal empty state (the marquee surface)
  if (!currentSubscription) {
    return (
      <div className="space-y-10">
        <div className="ac-sheen relative flex min-h-[460px] flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-border/60 bg-card/25 px-6 py-24 text-center md:min-h-[540px] md:py-32">
          {/* drifting grid texture, masked toward the center */}
          <div
            aria-hidden
            className="ac-grid-bg ac-grid-pan pointer-events-none absolute inset-0"
          />
          {/* breathing center glow */}
          <div
            aria-hidden
            className="ac-glow-pulse pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, oklch(0.65 0 0 / 0.10), transparent 65%)",
            }}
          />
          <div className="relative flex flex-col items-center">
            <div className="ac-rise mb-8">
              <div className="ac-float grid h-20 w-20 place-items-center rounded-3xl border border-border/60 bg-muted/30 shadow-[0_0_40px_oklch(1_0_0/0.06)]">
                <Sparkles className="h-9 w-9 text-foreground/80" />
              </div>
            </div>
            <h2 className="ac-display ac-rise ac-d1 text-balance text-4xl text-foreground md:text-5xl">{t("dash.noActiveSub")}</h2>
            <p className="ac-rise ac-d2 mt-5 max-w-lg text-pretty text-base leading-relaxed text-muted-foreground">
              {t("dash.noActiveSub.body")}
            </p>
            <div className="ac-rise ac-d3 mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button
                size="lg"
                className="h-12 gap-2 rounded-full px-7 text-[15px]"
                onClick={() => onNavigate("purchase")}
              >
                <ShoppingCart className="h-4 w-4" /> {t("dash.getPlan")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 gap-2 rounded-full px-7 text-[15px]"
                onClick={() => onNavigate("purchase")}
              >{t("dash.learnMore")}</Button>
            </div>
          </div>
        </div>

        {/* Plugins you'll unlock */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("dash.pluginsUnlock")}
            </h3>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PluginQuickCard
              icon={<Send className="h-5 w-5" />}
              title={t("dash.plugin.discordSpam")}
              description={t("dash.spam.quickDesc")}
              onClick={() => onNavigate("plugin-discord-spam")}
              delay={120}
            />
            <PluginQuickCard
              icon={<MessageSquare className="h-5 w-5" />}
              title={t("dash.plugin.discordAutoReply")}
              description={t("dash.autoReply.quickDesc")}
              onClick={() => onNavigate("plugin-discord-autoreply")}
              delay={180}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div
        className="ac-sheen relative overflow-hidden rounded-3xl border border-border/60 bg-card/40 p-6 md:p-8"
        style={{
          animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        {/* decorative drifting grid */}
        <div
          aria-hidden
          className="ac-grid-pan pointer-events-none absolute inset-0 opacity-[0.45]"
          style={{
            backgroundImage:
              "linear-gradient(to right, oklch(1 0 0 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, oklch(1 0 0 / 0.04) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage:
              "radial-gradient(ellipse 80% 80% at 100% 0%, black, transparent 70%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 80% at 100% 0%, black, transparent 70%)",
          }}
        />
        {/* breathing corner glow */}
        <div
          aria-hidden
          className="ac-glow-pulse pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full"
          style={{
            background:
              "radial-gradient(circle, oklch(0.7 0 0 / 0.10), transparent 65%)",
          }}
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
              {plan?.name ?? t("dash.active")} plan
            </span>
            <h2 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">{t("dash.workspaceReady")}</h2>
            <p className="max-w-md text-pretty text-sm text-muted-foreground">{t("dash.workspaceReadyDesc")}</p>
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <Button
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => onNavigate("bots")}
              >
                <Bot className="h-3.5 w-3.5" /> Deploy a bot
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-full"
                onClick={() => onNavigate("purchase")}
              >
                <ShoppingCart className="h-3.5 w-3.5" />{t("dash.managePlan")}</Button>
            </div>
          </div>

          {/* Plan limit chips */}
          {plan && (
            <div className="grid w-full grid-cols-3 gap-2.5 md:w-auto md:min-w-[280px]">
              {[
                {
                  icon: <Bot className="h-3.5 w-3.5 text-sky-400" />,
                  label: t("dash.sec.bots"),
                  value: maxBots === -1 ? "∞" : maxBots,
                },
                {
                  icon: <Clock className="h-3.5 w-3.5 text-amber-400" />,
                  label: "Bot-hours",
                  value: botHours === -1 ? "∞" : `${botHours}h`,
                },
                {
                  icon: <Globe className="h-3.5 w-3.5 text-emerald-400" />,
                  label: t("dash.sec.proxies"),
                  value: maxProxies === -1 ? "∞" : maxProxies,
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-2xl border border-border/50 bg-background/40 px-3 py-3 text-center backdrop-blur-sm"
                >
                  <div className="mb-1 flex justify-center">{c.icon}</div>
                  <p className="text-lg font-semibold tabular-nums leading-none">
                    {c.value}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    {c.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        {plan && expiresAt && (
          <p className="relative mt-5 text-xs text-muted-foreground/60">
            Plan renews/expires on{" "}
            <span className="text-foreground/80">
              {new Date(expiresAt).toLocaleDateString()}
            </span>
          </p>
        )}
      </div>

      {/* Stats + charts row */}
      <div className="grid gap-3 md:grid-cols-5">
        {/* Left: 2x2 stat cards */}
        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <StatCard
            icon={<Activity className="h-4 w-4 text-emerald-400" />}
            label="Plan"
            value={plan ? plan.name : "—"}
            sub={currentSubscription ? "Active" : t("dash.noActivePlan")}
            numeric={false}
            delay={0}
          />
          <StatCard
            icon={<Bot className="h-4 w-4 text-sky-400" />}
            label={t("dash.maxBots")}
            value={maxBots === -1 ? "∞" : maxBots}
            sub={maxBots === -1 ? "unlimited" : "concurrent"}
            numeric={false}
            delay={70}
          />
          <StatCard
            icon={<CreditCard className="h-4 w-4 text-violet-400" />}
            label="Payments"
            value={payments.length}
            sub="all time"
            numeric={true}
            delay={140}
          />
          <StatCard
            icon={<Ticket className="h-4 w-4 text-amber-400" />}
            label="Tickets"
            value={openTickets}
            sub="open"
            numeric={true}
            delay={210}
          />
        </div>

        {/* Right: pie chart + line chart */}
        <div className="md:col-span-3 grid gap-3 sm:grid-cols-2">
          {/* Pie chart: online vs offline */}
          {data.overviewStats && data.overviewStats.totalBots > 0 && (
            <div
              className="ac-lift ac-sheen group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 p-4"
              style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) 280ms both" }}
            >
              <div className="ac-grid-card pointer-events-none absolute inset-0 -z-10 opacity-60" />
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
                Bot Status
              </p>
              <ChartContainer
                config={{
                  online: { label: "Online", color: "#4ade80" },
                  offline: { label: "Offline", color: "#6b7280" },
                }}
                className="h-36 w-full"
              >
                <Recharts.PieChart>
                  <Recharts.Pie
                    data={[
                      { name: "online", value: data.overviewStats!.onlineBots },
                      { name: "offline", value: data.overviewStats!.offlineBots },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={32}
                    outerRadius={52}
                    paddingAngle={3}
                    dataKey="value"
                    isAnimationActive
                  >
                    <Recharts.Cell fill="#4ade80" />
                    <Recharts.Cell fill="#6b7280" />
                  </Recharts.Pie>
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-border/60 bg-card/95 px-3 py-2 text-xs backdrop-blur-sm">
                          <span className="font-semibold">{payload[0].value}</span> {String(payload[0].name)}
                        </div>
                      );
                    }}
                  />
                </Recharts.PieChart>
              </ChartContainer>
              <div className="mt-2 flex justify-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-400" /> Online
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-gray-500" /> Offline
                </span>
              </div>
            </div>
          )}

          {/* Line chart: 7-day history */}
          {data.overviewStats && (
            <div
              className="ac-lift ac-sheen group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 p-4"
              style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) 350ms both" }}
            >
              <div className="ac-grid-card pointer-events-none absolute inset-0 -z-10 opacity-60" />
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
                Online History — 7 Days
              </p>
              <ChartContainer
                config={{
                  online: { label: "Online Bots", color: "#38bdf8" },
                }}
                className="h-36 w-full"
              >
                <Recharts.LineChart
                  data={data.overviewStats!.weeklyHistory.map((d) => ({
                    ...d,
                    label: d.date.slice(5),
                  }))}
                  margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
                >
                  <Recharts.CartesianGrid
                    strokeDasharray="3 3"
                    stroke="oklch(1 0 0 / 0.06)"
                    vertical={false}
                  />
                  <Recharts.XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "oklch(0.55 0 0 / 0.6)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Recharts.YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.55 0 0 / 0.6)" }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <ChartTooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-border/60 bg-card/95 px-3 py-2 text-xs backdrop-blur-sm">
                          <span className="text-muted-foreground">{label}</span>
                          <br />
                          <span className="font-semibold text-sky-400">{payload[0].value}</span> online
                        </div>
                      );
                    }}
                  />
                  <Recharts.Line
                    type="monotone"
                    dataKey="online"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "#38bdf8", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "#38bdf8", strokeWidth: 0 }}
                    isAnimationActive
                  />
                </Recharts.LineChart>
              </ChartContainer>
            </div>
          )}
        </div>
      </div>

      {/* Plugins quick access */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Puzzle className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">{t("dash.nav.plugins")}</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <PluginQuickCard
            icon={<Send className="h-5 w-5" />}
            title={t("dash.plugin.discordSpam")}
            description={t("dash.spam.quickDesc")}
            onClick={() => onNavigate("plugin-discord-spam")}
            delay={240}
          />
            <PluginQuickCard
              icon={<MessageSquare className="h-5 w-5" />}
              title={t("dash.plugin.discordAutoReply")}
              description={t("dash.autoReply.quickDesc")}
              onClick={() => onNavigate("plugin-discord-autoreply")}
              delay={300}
            />
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 md:grid-cols-2">
        <QuickAction
          icon={<Globe className="h-5 w-5" />}
          title={t("dash.manageProxies")}
          description={t("dash.proxiesShort")}
          action={t("dash.openProxies")}
          onClick={() => onNavigate("proxies")}
          delay={360}
        />
        <QuickAction
          icon={<Ticket className="h-5 w-5" />}
          title={t("dash.needHelp")}
          description={
            openTickets > 0
              ? `You have ${openTickets} open ticket${openTickets !== 1 ? "s" : ""}`
              : t("dash.openTicketTeam")
          }
          action={t("dash.section.supportTickets")}
          onClick={() => onNavigate("tickets")}
          delay={420}
        />
      </div>

      {/* Recent payments */}
      {recentPayments.length > 0 && (
        <div
          className="rounded-2xl border border-border/50 bg-card/50 overflow-hidden"
          style={{
            animation: "fadeUp 0.55s cubic-bezier(0.22,1,0.36,1) 420ms both",
          }}
        >
          <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5">
            <p className="text-sm font-medium">{t("dash.recentPayments")}</p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200"
              onClick={() => onNavigate("billing")}
            >{t("dash.viewAll")}</button>
          </div>
          <div className="divide-y divide-border/30">
            {recentPayments.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-muted/20 transition-colors duration-150"
                style={{
                  animation: `fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) ${480 + i * 60}ms both`,
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-muted/40">
                    <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {p.plan_id ??
                        p.plugin_id ??
                        (p.kind === "slot"
                          ? `${p.slot_qty} extra bot slot(s)`
                          : "Payment")}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {p.coin} — {formatPrice(p.amount_usd, { decimals: 0 })}
                    </p>
                  </div>
                </div>
                <PaymentStatusBadge status={p.status} />
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  numeric,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  numeric: boolean;
  delay: number;
}) {
  return (
    <div
      className="ac-lift ac-sheen group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 px-5 py-4 hover:border-border hover:bg-card/80 hover:shadow-[0_10px_30px_oklch(0_0_0/0.45)]"
      style={{
        animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      }}
    >
      {/* faint grid texture */}
      <div
        aria-hidden
        className="ac-grid-card pointer-events-none absolute inset-0 -z-10 opacity-60"
      />
      {/* top hairline that lights up on hover */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-border/50 bg-muted/30 transition-colors duration-200 group-hover:bg-muted/50">
          {icon}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {numeric && typeof value === "number" ? (
          <AnimatedNumber target={value} />
        ) : (
          value
        )}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function PluginQuickCard({
  icon,
  title,
  description,
  onClick,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  delay: number;
}) {
  const t = useT();
  return (
    <div
      className="ac-lift ac-sheen group relative flex cursor-pointer items-start gap-5 overflow-hidden rounded-3xl border border-border/50 bg-card/50 px-7 py-7 hover:border-border hover:bg-card/80 hover:shadow-[0_14px_36px_oklch(0_0_0/0.5)]"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      style={{
        animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      }}
    >
      {/* faint grid texture */}
      <div
        aria-hidden
        className="ac-grid-card ac-grid-card-lg pointer-events-none absolute inset-0 -z-10 opacity-70"
      />
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-border/50 bg-muted/30 text-foreground transition-all duration-200 group-hover:scale-105 group-hover:bg-muted/60 group-hover:shadow-[0_0_24px_oklch(1_0_0/0.08)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <span className="mt-3 inline-flex items-center text-xs font-medium text-muted-foreground/70 transition-colors duration-200 group-hover:text-foreground">{t("dash.openPlugin")}<ChevronRight className="ml-0.5 h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  description,
  action,
  onClick,
  delay,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
  delay: number;
}) {
  return (
    <div
      className="ac-lift ac-sheen group relative flex items-start gap-4 overflow-hidden rounded-2xl border border-border/50 bg-card/50 px-5 py-5
                 hover:border-border hover:bg-card/80
                 hover:shadow-[0_10px_30px_oklch(0_0_0/0.45)] cursor-pointer"
      onClick={onClick}
      style={{
        animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      <div className="mt-0.5 rounded-xl bg-muted/40 p-2.5 transition-all duration-200 group-hover:bg-muted/70 group-hover:scale-110">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        <span className="mt-2 inline-flex items-center text-xs font-medium text-muted-foreground/70 group-hover:text-foreground transition-colors duration-200">
          {action}
          <ChevronRight className="ml-0.5 h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared dashboard section primitives (consistent design system)
// ---------------------------------------------------------------------------

/** Small uppercase eyebrow label that introduces a block, with optional right slot. */
function SectionLabel({
  icon,
  children,
  right,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-1">
      <div className="flex items-center gap-2 text-muted-foreground/70">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em]">
          {children}
        </h3>
      </div>
      {right}
    </div>
  );
}

/** Rounded surface with faint grid texture + hover sheen. */
function Panel({
  children,
  className = "",
  grid = true,
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  grid?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-3xl border border-border/60 bg-card/50",
        interactive ? "ac-lift ac-sheen hover:border-border hover:bg-card/80" : "",
        className,
      ].join(" ")}
    >
      {grid && (
        <div
          aria-hidden
          className="ac-grid-card ac-grid-card-lg pointer-events-none absolute inset-0 -z-10 opacity-60"
        />
      )}
      {children}
    </div>
  );
}

/** Header row inside a Panel. */
function PanelHeader({
  title,
  icon,
  right,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-5 py-3.5">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium">{title}</p>
      </div>
      {right}
    </div>
  );
}

/** Stat tile: grid texture, hover lift + sheen, tonal grayscale icon chip. */
function StatTile({
  icon,
  label,
  value,
  sub,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  delay?: number;
}) {
  return (
    <div
      className="ac-lift ac-sheen group relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 px-5 py-4 hover:border-border hover:bg-card/80 hover:shadow-[0_10px_30px_oklch(0_0_0/0.45)]"
      style={{
        animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}ms both`,
      }}
    >
      <div
        aria-hidden
        className="ac-grid-card pointer-events-none absolute inset-0 -z-10 opacity-60"
      />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid h-6 w-6 place-items-center rounded-lg border border-border/50 bg-muted/40 text-foreground/70">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground/50">{sub}</p>}
    </div>
  );
}

/** Polished empty / locked state with floating icon, drifting grid, glow. */
function EmptyPanel({
  icon,
  title,
  desc,
  action,
  tone = "default",
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "default" | "locked";
  className?: string;
}) {
  return (
    <div
      className={[
        "ac-sheen relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-3xl border px-6 py-20 text-center",
        tone === "locked"
          ? "border-foreground/20 bg-card/40"
          : "border-border/60 bg-card/30",
        className,
      ].join(" ")}
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      <div
        aria-hidden
        className="ac-grid-bg ac-grid-pan pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden
        className="ac-glow-pulse pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, oklch(0.65 0 0 / 0.08), transparent 65%)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <div className="ac-float mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-border/60 bg-muted/30 text-foreground/75 shadow-[0_0_36px_oklch(1_0_0/0.05)]">
          {icon}
        </div>
        <h3 className="text-balance text-lg font-semibold text-foreground">
          {title}
        </h3>
        {desc && (
          <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        )}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bots section
// ---------------------------------------------------------------------------

function BotsSection({
  currentSubscription,
}: {
  currentSubscription: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
}) {
  const t = useT();
  const plan = currentSubscription?.plan;
  const maxBots = plan?.max_bots ?? 0;
  const botHours = plan?.bot_hours ?? 0;
  const hasAccess = maxBots !== 0; // -1 = unlimited

  if (!hasAccess) {
    return (
      <div
        className="space-y-8"
        style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
      >
        <EmptyPanel
          icon={<Bot className="h-7 w-7" />}
          title={t("dash.noActiveSub")}
          desc={t("dash.subscribeCta")}
        />
      </div>
    );
  }

  return (
    <BotsManager
      maxBots={maxBots}
      botHours={botHours}
      planName={plan?.name ?? "—"}
    />
  );
}

// ---------------------------------------------------------------------------
// Billing section
// ---------------------------------------------------------------------------

function BillingSection({
  payments: initialPayments,
  subscription,
}: {
  payments: PaymentRow[];
  subscription: { subscription: SubscriptionRow; plan: PlanRow | null } | null;
}) {
  const t = useT();
  const { formatPrice } = usePreferences();
  const [payments, setPayments] = useState<PaymentRow[]>(initialPayments);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function handleCancel(paymentId: string) {
    setCancellingId(paymentId);
    try {
      await cancelMyPayment({ data: { paymentId } });
      setPayments((prev) =>
        prev.map((p) =>
          p.id === paymentId ? { ...p, status: "failed" as const } : p,
        ),
      );
    } catch {
      // ignore — payment may have already moved past waiting
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div
      className="space-y-8"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {/* Current subscription */}
      <section className="space-y-4">
        <SectionLabel icon={<Crown className="h-3.5 w-3.5" />}>{t("dash.currentSub")}</SectionLabel>
        <Panel className="px-6 py-6">
          {subscription?.plan ? (
            <div className="relative space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="ac-float grid h-12 w-12 place-items-center rounded-2xl border border-border/60 bg-muted/30 text-foreground/75">
                    <Crown className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xl font-semibold tracking-tight">
                      {subscription.plan.name}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {subscription.plan.price_usd === 0
                        ? subscription.plan.is_trial
                          ? "Free trial"
                          : "Complimentary"
                        : `${formatPrice(subscription.plan.price_usd, { decimals: 0 })} / ${subscription.plan.interval}`}
                    </p>
                  </div>
                </div>
                <span
                  className={[
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
                    subscription.subscription.status === "active"
                      ? "border-foreground/25 bg-foreground/10 text-foreground"
                      : "border-border bg-muted/20 text-muted-foreground",
                  ].join(" ")}
                >
                  {subscription.subscription.status === "active" && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="ac-glow-pulse absolute inline-flex h-full w-full rounded-full bg-foreground/60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
                    </span>
                  )}
                  {subscription.subscription.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/50 bg-muted/20 p-4 text-center text-xs">
                <div>
                  <p className="text-base font-semibold tabular-nums">
                    {(subscription.plan.max_bots ?? 0) === -1
                      ? "∞"
                      : subscription.plan.max_bots}
                  </p>
                  <p className="mt-0.5 text-muted-foreground/50">{t("dash.maxBots")}</p>
                </div>
                <div className="border-x border-border/40">
                  <p className="text-base font-semibold tabular-nums">
                    {(subscription.plan.bot_hours ?? 0) === -1
                      ? "∞"
                      : `${subscription.plan.bot_hours}h`}
                  </p>
                  <p className="mt-0.5 text-muted-foreground/50">{t("dash.botHours")}</p>
                </div>
                <div>
                  <p className="text-base font-semibold tabular-nums">
                    {(subscription.plan.max_proxies ?? 0) === -1
                      ? "∞"
                      : subscription.plan.max_proxies}
                  </p>
                  <p className="mt-0.5 text-muted-foreground/50">{t("dash.sec.proxies")}</p>
                </div>
              </div>
              {subscription.subscription.expires_at && (
                <p className="text-xs text-muted-foreground/50">
                  Expires:{" "}
                  {new Date(
                    subscription.subscription.expires_at,
                  ).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="relative text-sm text-muted-foreground">{t("dash.noActiveSubDot")}</p>
          )}
        </Panel>
      </section>

      {/* Payment history */}
      <section className="space-y-4">
        <SectionLabel icon={<CreditCard className="h-3.5 w-3.5" />}>{t("dash.paymentHistory")}</SectionLabel>
        <Panel>
          {payments.length === 0 ? (
            <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">{t("dash.noPayments")}</div>
          ) : (
            <div className="divide-y divide-border/30">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-5 py-3.5 transition-colors duration-150 hover:bg-muted/10"
                >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium capitalize">
                    {p.plan_id ??
                      p.plugin_id ??
                      (p.kind === "slot"
                        ? `${p.slot_qty} extra bot slot(s)`
                        : "Payment")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()} ·{" "}
                    {p.coin.toUpperCase()} · {formatPrice(p.amount_usd, { decimals: 0 })}
                    {p.amount_crypto && (
                      <span className="text-muted-foreground/50">
                        {" "}
                        ({p.amount_crypto} {p.coin.toUpperCase()})
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <PaymentStatusBadge status={p.status} />
                  {p.status === "waiting" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs text-red-400 hover:bg-red-500/10 px-2"
                      disabled={cancellingId === p.id}
                      onClick={() => handleCancel(p.id)}
                      title={t("dash.cancelInvoice")}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {cancellingId === p.id ? "Cancelling…" : t("dash.cancel")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Referrals section
// ---------------------------------------------------------------------------

function ReferralStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Panel className="px-5 py-4" interactive>
      <div className="flex items-center gap-2 text-muted-foreground/70">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </Panel>
  );
}

function ReferralsSection() {
  const t = useT();
  const { formatPrice } = usePreferences();
  const [data, setData] = useState<MyReferral | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => {
    getMyReferral()
      .then((d) => setData(d))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  const inviteLink =
    data && typeof window !== "undefined"
      ? `${window.location.origin}/?ref=${data.code}`
      : "";

  async function copy(text: string, which: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (failed || !data) {
    return (
      <Panel className="px-6 py-14">
        <p className="text-center text-sm text-muted-foreground">
          {t("referral.unavailable")}
        </p>
      </Panel>
    );
  }

  return (
    <div
      className="space-y-8"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {/* Invite hero */}
      <section className="space-y-4">
        <SectionLabel icon={<Gift className="h-3.5 w-3.5" />}>
          {t("referral.inviteTitle")}
        </SectionLabel>
        <Panel className="px-6 py-6">
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            {t("referral.intro", { pct: data.ratePct })}
          </p>

          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("referral.yourLink")}
              </p>
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {inviteLink}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 text-xs"
                  onClick={() => copy(inviteLink, "link")}
                >
                  {copied === "link" ? (
                    <Check className="h-3.5 w-3.5 text-green-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied === "link" ? t("referral.copied") : t("referral.copy")}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("referral.yourCode")}
                </p>
                <button
                  type="button"
                  onClick={() => copy(data.code, "code")}
                  className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5 font-mono text-lg font-semibold tracking-[0.2em] transition-colors hover:border-foreground/30"
                >
                  {data.code}
                  {copied === "code" ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </Panel>
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-3">
        <ReferralStat
          icon={<Wallet className="h-4 w-4" />}
          label={t("referral.creditBalance")}
          value={formatPrice(data.creditUsd)}
        />
        <ReferralStat
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("referral.totalEarned")}
          value={formatPrice(data.totalEarned)}
        />
        <ReferralStat
          icon={<Users className="h-4 w-4" />}
          label={t("referral.friendsJoined")}
          value={data.friendCount}
        />
      </section>

      {/* Referred friends */}
      <section className="space-y-4">
        <SectionLabel icon={<Users className="h-3.5 w-3.5" />}>
          {t("referral.friendsTitle")}
        </SectionLabel>
        <Panel>
          {data.friends.length === 0 ? (
            <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">
              {t("referral.noFriends")}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {data.friends.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-muted/10"
                >
                  <Avatar className="h-8 w-8">
                    {f.avatarUrl && <AvatarImage src={f.avatarUrl} alt="" />}
                    <AvatarFallback>
                      {f.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {f.name}
                  </p>
                  <p className="shrink-0 text-xs text-muted-foreground">
                    {new Date(f.joinedAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      {/* Credit history */}
      <section className="space-y-4">
        <SectionLabel icon={<CreditCard className="h-3.5 w-3.5" />}>
          {t("referral.historyTitle")}
        </SectionLabel>
        <Panel>
          {data.history.length === 0 ? (
            <div className="flex items-center justify-center py-14 text-sm text-muted-foreground">
              {t("referral.noFriends")}
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {data.history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between px-5 py-3.5"
                >
                  <p className="text-sm text-muted-foreground">
                    {t("referral.creditApplied")} ·{" "}
                    {new Date(h.createdAt).toLocaleDateString()}
                  </p>
                  <p className="text-sm font-semibold text-green-400 tabular-nums">
                    +{formatPrice(h.amountUsd)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proxies section (plan-gated, users can add their own on Pro/Enterprise)
// ---------------------------------------------------------------------------

type AddProxyMode = "single" | "bulk";

function ProxiesSection({
  currentSubscription,
}: {
  currentSubscription: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
}) {
  const t = useT();
  const [proxies, setProxies] = useState<ProxyRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddProxyMode>("single");
  // Single fields
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [protocol, setProtocol] = useState<"http" | "socks5">("http");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  // Bulk field
  const [bulkText, setBulkText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bulkResults, setBulkResults] = useState<
    { host: string; port: number; ok: boolean; error?: string }[] | null
  >(null);

  const maxProxies = currentSubscription?.plan?.max_proxies ?? 0;
  // -1 means unlimited, any positive value grants access. Only 0 (or no plan) locks the tab.
  const unlimitedProxies = maxProxies === -1;
  const hasAccess = maxProxies !== 0;

  function reload() {
    setLoading(true);
    getMyProxies()
      .then((p) => setProxies(p as ProxyRow[]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!hasAccess) return;
    reload();
  }, [hasAccess]);

  function openAdd() {
    setHost("");
    setPort("");
    setProtocol("http");
    setUsername("");
    setPassword("");
    setLabel("");
    setBulkText("");
    setBulkResults(null);
    setAddMode("single");
    setAddOpen(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (addMode === "single") {
        const portNum = parseInt(port);
        if (!host || !portNum) return;
        await addMyProxy({
          data: {
            host,
            port: portNum,
            protocol,
            username: username || undefined,
            password: password || undefined,
            label: label || undefined,
          },
        });
        setAddOpen(false);
        reload();
      } else {
        if (!bulkText.trim()) return;
        const result = await addMyProxiesBulk({ data: { lines: bulkText } });
        setBulkResults(result.results);
        reload();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const slotsLeft = unlimitedProxies
    ? Infinity
    : maxProxies - (proxies?.length ?? 0);

  return (
    <div
      className="space-y-8"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {!hasAccess ? (
        <EmptyPanel
          tone="locked"
          icon={<Globe className="h-7 w-7" />}
          title={t("dash.proxiesNotAvail")}
          desc={t("dash.proxiesUpgrade")}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading proxies…
        </div>
      ) : !proxies || proxies.length === 0 ? (
        /* Empty state — invite to add */
        <EmptyPanel
          icon={<Globe className="h-7 w-7" />}
          title={t("dash.noProxies")}
          desc={t("dash.noProxiesDesc")}
          action={
            <Button size="sm" className="gap-1.5 rounded-full" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" />{t("dash.addProxy")}</Button>
          }
        />
      ) : (
        <section className="space-y-4">
          <SectionLabel icon={<Globe className="h-3.5 w-3.5" />}>{t("dash.yourProxies")}</SectionLabel>
          <Panel>
            <PanelHeader
              title={t("dash.activeProxies")}
              right={
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {proxies.length} / {unlimitedProxies ? "∞" : maxProxies}{" "}
                    slots used
                  </span>
                  {slotsLeft > 0 && (
                    <Button
                      size="sm"
                      className="h-7 gap-1.5 rounded-full text-xs"
                      onClick={openAdd}
                    >
                      <Plus className="h-3.5 w-3.5" />{t("dash.add")}</Button>
                  )}
                </div>
              }
            />
            <div className="divide-y divide-border/30">
              {proxies.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-5 py-3.5 transition-colors duration-150 hover:bg-muted/10"
                  style={{
                    animation: `fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) ${i * 40}ms both`,
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/50 bg-muted/40 text-foreground/70">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.label ?? `${p.host}:${p.port}`}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {p.protocol.toUpperCase()} · {p.host}:{p.port}
                        {p.username && (
                          <span className="text-muted-foreground/50">
                            {" "}
                            · {p.username}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <span className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400 [animation:pulse_2s_ease-in-out_infinite]" />{t("dash.active")}</span>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      )}

      {/* Add proxy dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) setAddOpen(false);
        }}
      >
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />{t("dash.addProxy")}</DialogTitle>
          </DialogHeader>
          <Separator />

          {/* Mode toggle */}
          <div className="flex gap-2 mt-1">
            {(
              [
                ["single", "Single", <Globe key="g" className="h-3.5 w-3.5" />],
                ["bulk", "Bulk", <List key="l" className="h-3.5 w-3.5" />],
              ] as [AddProxyMode, string, React.ReactNode][]
            ).map(([mode, label2, icon]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setAddMode(mode);
                  setBulkResults(null);
                }}
                className={[
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                  addMode === mode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-foreground/30",
                ].join(" ")}
              >
                {icon}
                {label2}
              </button>
            ))}
          </div>

          {addMode === "single" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.host")}</label>
                  <Input
                    placeholder="1.2.3.4"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.port")}</label>
                  <Input
                    placeholder="8080"
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                {(["http", "socks5"] as const).map((proto) => (
                  <button
                    key={proto}
                    type="button"
                    onClick={() => setProtocol(proto)}
                    className={[
                      "flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium uppercase transition-colors",
                      protocol === proto
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    ].join(" ")}
                  >
                    {proto}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.username")}</label>
                  <Input
                    placeholder={t("dash.optional")}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.password")}</label>
                  <Input
                    placeholder={t("dash.optional")}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("dash.labelOptional")}</label>
                <Input
                  placeholder={t("dash.proxyLabelPh")}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                One proxy per line:{" "}
                <span className="font-mono text-foreground/60">
                  host:port [http|socks5] [user:pass] [label]
                </span>
              </p>
              <Textarea
                placeholder={
                  "1.2.3.4:8080 http user:pass MyProxy\n5.6.7.8:1080 socks5"
                }
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                className="h-32 font-mono text-xs resize-none"
              />
              {slotsLeft < 100 && (
                <p className="text-xs text-muted-foreground/60">
                  You have {slotsLeft} slot{slotsLeft !== 1 ? "s" : ""}{" "}
                  remaining.
                </p>
              )}
              {/* Results */}
              {bulkResults && (
                <div className="rounded-lg border border-border/40 bg-muted/20 p-2 space-y-1 max-h-28 overflow-y-auto">
                  {bulkResults.map((r, i) => (
                    <p
                      key={i}
                      className={`text-xs font-mono ${r.ok ? "text-green-400" : "text-red-400"}`}
                    >
                      {r.ok ? "✓" : "✗"} {r.host}
                      {r.port > 0 ? `:${r.port}` : ""}
                      {r.error ? ` — ${r.error}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(false)}
            >{t("dash.cancel")}</Button>
            <Button
              size="sm"
              disabled={
                submitting ||
                (addMode === "single" ? !host || !port : !bulkText.trim())
              }
              onClick={handleSubmit}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting
                ? "Adding…"
                : addMode === "bulk" && bulkResults
                  ? "Done"
                  : t("dash.add")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins section
// ---------------------------------------------------------------------------

type PluginType = "discord-spam" | "discord-autoreply";

type PluginMeta = {
  name: string;
  description: string;
  price: number;
  icon: React.ReactNode;
  features: string[];
};

function getPluginMeta(t: TFunc): Record<PluginType, PluginMeta> {
  return {
    "discord-spam": {
      name: t("dash.plugin.discordSpam"),
      description: t("dash.spam.desc"),
      price: PLUGIN_PRICE_USD["discord-spam"],
      icon: <Puzzle className="h-6 w-6" />,
      features: [
        t("dash.spam.f1"),
        t("dash.spam.f2"),
        t("dash.spam.f3"),
        t("dash.spam.f4"),
        t("dash.feat.proxySupport"),
        t("dash.liveConsole"),
      ],
    },
    "discord-autoreply": {
      name: t("dash.plugin.discordAutoReply"),
      description: t("dash.autoReply.desc"),
      price: PLUGIN_PRICE_USD["discord-autoreply"],
      icon: <MessageSquare className="h-6 w-6" />,
      features: [
        t("dash.autoReply.f1"),
        t("dash.autoReply.f2"),
        t("dash.autoReply.f3"),
        t("dash.autoReply.f4"),
        t("dash.feat.proxySupport"),
        t("dash.liveConsole"),
      ],
    },
  };
}

/** Show whole dollars as-is ($10) but keep cents when present ($6.50). */

/** Dedicated page for a single plugin: paywall when unowned, config when owned. */
function PluginPage({
  pluginId,
  plugins: pluginState,
}: {
  pluginId: PluginType;
  plugins: PluginStateRow[];
}) {
  const router = useRouter();
  const t = useT();
  const meta = getPluginMeta(t)[pluginId];
  const state = pluginState.find((p) => p.pluginId === pluginId) ?? null;
  const isPurchased = state?.purchased ?? false;
  const available = PLUGIN_AVAILABLE[pluginId];
  const savedConfig = state?.configJson
    ? (JSON.parse(state.configJson) as Record<string, unknown>)
    : null;
  const activeRun = state?.activeRun ?? null;

  const onChanged = () => router.invalidate();

  // Auto-Reply (and any future plugin) stays gated until released.
  if (!available) {
    return <ComingSoonPlugin meta={meta} />;
  }

  if (!isPurchased) {
    return (
      <PluginPaywall pluginId={pluginId} meta={meta} onChanged={onChanged} />
    );
  }

  return (
    <PluginWorkspace
      pluginId={pluginId}
      meta={meta}
      savedConfig={savedConfig}
      activeRun={activeRun}
      onChanged={onChanged}
    />
  );
}

// ---------------------------------------------------------------------------
// Coming soon (unreleased plugin)
// ---------------------------------------------------------------------------

function ComingSoonPlugin({
  meta,
}: {
  meta: PluginMeta;
}) {
  const t = useT();
  return (
    <section className="mx-auto max-w-lg">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-8 text-center">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/30 to-transparent" />
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground">
          {meta.icon}
        </div>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />{t("dash.comingSoon")}</span>
        <h2 className="mt-4 text-xl font-semibold">{meta.name}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("dash.comingSoon.body")}
        </p>
        <button
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-sm font-medium text-muted-foreground opacity-70"
        >{t("dash.notAvailYet")}</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Owned plugin workspace: live settings (left) + live console (right)
// ---------------------------------------------------------------------------

function PluginWorkspace({
  pluginId,
  meta,
  savedConfig,
  activeRun,
  onChanged,
}: {
  pluginId: PluginType;
  meta: PluginMeta;
  savedConfig: Record<string, unknown> | null;
  activeRun: PluginRunRow | null;
  onChanged: () => void;
}) {
  const t = useT();
  const status = activeRun?.status ?? "idle";
  const isLive = status === "running" || status === "pending" || status === "starting";

  // While a run is live, refresh loader data so the status pill and Start/Stop
  // button reflect transitions (pending → running → stopped/error) without a
  // manual page refresh.
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => onChanged(), 3000);
    return () => clearInterval(id);
  }, [isLive, onChanged]);

  return (
    <section className="space-y-5">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-card/50 p-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border/60 bg-muted/40 text-foreground">
          {meta.icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{meta.name}</h2>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400">
            <Check className="h-3.5 w-3.5" />{t("dash.ownedLifetime")}</span>
        </div>
        <div className="ml-auto">
          <RunStatusPill status={status} />
        </div>
      </header>

      {/* Two-column workspace */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* Left — live settings */}
        <div className="rounded-xl border border-border/40 bg-card/50 p-5 md:p-6">
          <div className="mb-5">
            <h3 className="text-sm font-semibold">{t("dash.nav.settings")}</h3>
            <p className="text-xs text-muted-foreground">{t("dash.expandHint")}</p>
          </div>
          {pluginId === "discord-autoreply" ? (
            <DiscordAutoReplyConfig
              savedConfig={savedConfig as AutoReplyConfig | null}
              activeRun={activeRun}
              onChanged={onChanged}
            />
          ) : (
            <DiscordSpamConfig
              savedConfig={savedConfig as SpamConfig | null}
              activeRun={activeRun}
              onChanged={onChanged}
            />
          )}
        </div>

        {/* Right — live console / Discord-style DM panel */}
        <RunActivityPanel
          pluginId={pluginId}
          meta={meta}
          activeRun={activeRun}
          onChanged={onChanged}
        />
      </div>
    </section>
  );
}

function RunActivityPanel({
  pluginId,
  meta,
  activeRun,
  onChanged,
}: {
  pluginId: PluginType;
  meta: PluginMeta;
  activeRun: PluginRunRow | null;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"console" | "dms">("console");
  const status = activeRun?.status ?? "idle";
  const live =
    status === "running" || status === "pending" || status === "starting";

  return (
    <div className="self-start xl:sticky xl:top-6">
      <div className="mb-3 inline-flex items-center gap-1 rounded-lg border border-border/40 bg-card/50 p-1">
        <button
          onClick={() => setTab("console")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "console"
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          Console
        </button>
        <button
          onClick={() => setTab("dms")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "dms"
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          DMs
        </button>
      </div>

      {tab === "console" ? (
        <LiveConsole
          pluginId={pluginId}
          meta={meta}
          activeRun={activeRun}
          onChanged={onChanged}
        />
      ) : (
        <DiscordDmPanel runId={activeRun?.id ?? null} live={live} />
      )}
    </div>
  );
}

function RunStatusPill({ status }: { status: string }) {
  const t = useT();
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    running: {
      label: t("dash.status.running"),
      cls: "border-green-500/30 bg-green-500/10 text-green-400",
      dot: "bg-green-400",
    },
    pending: {
      label: t("dash.status.queued"),
      cls: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
      dot: "bg-yellow-400",
    },
    stopped: {
      label: t("dash.status.stopped"),
      cls: "border-border/60 bg-muted/30 text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    error: {
      label: t("dash.status.error"),
      cls: "border-red-500/30 bg-red-500/10 text-red-400",
      dot: "bg-red-400",
    },
    idle: {
      label: t("dash.status.idle"),
      cls: "border-border/60 bg-muted/30 text-muted-foreground",
      dot: "bg-muted-foreground",
    },
  };
  const s = map[status] ?? map.idle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${s.cls}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${
          status === "running" || status === "pending" ? "animate-pulse" : ""
        }`}
      />
      {s.label}
    </span>
  );
}

type ConsoleLine = { time: string; level: "info" | "ok" | "warn" | "err" | "dim"; text: string };

function buildConsoleLines(
  meta: PluginMeta,
  activeRun: PluginRunRow | null,
): ConsoleLine[] {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-GB", { hour12: false });

  if (!activeRun) {
    return [
      { time: "--:--:--", level: "dim", text: "instance idle — no active run" },
      {
        time: "--:--:--",
        level: "dim",
        text: "configure settings on the left, then press Run Plugin to launch",
      },
    ];
  }

  const t0 = activeRun.created_at;
  const lines: ConsoleLine[] = [
    { time: fmt(t0), level: "info", text: `run ${activeRun.id} created` },
  ];

  if (activeRun.status === "pending") {
    lines.push(
      { time: fmt(t0 + 200), level: "warn", text: "waiting for a host to pick up the job…" },
      { time: fmt(t0 + 400), level: "dim", text: "(execution layer not deployed yet)" },
    );
  } else if (activeRun.status === "running") {
    lines.push(
      { time: fmt(t0 + 300), level: "ok", text: "container started" },
      { time: fmt(t0 + 600), level: "info", text: `booting ${meta.name}…` },
      { time: fmt(t0 + 900), level: "info", text: "tokens loaded, proxy ready" },
      { time: fmt(t0 + 1200), level: "ok", text: "online — streaming activity" },
    );
  } else if (activeRun.status === "stopped") {
    lines.push(
      { time: fmt(activeRun.stopped_at ?? t0), level: "warn", text: "container stopped" },
    );
  } else if (activeRun.status === "error") {
    lines.push(
      { time: fmt(t0 + 300), level: "err", text: activeRun.error ?? "container crashed" },
    );
  }

  return lines;
}

function LiveConsole({
  pluginId,
  meta,
  activeRun,
  onChanged,
}: {
  pluginId: PluginType;
  meta: PluginMeta;
  activeRun: PluginRunRow | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const status = activeRun?.status ?? "idle";
  const running = status === "running" || status === "pending";

  // Real container logs (polled incrementally). The bot pushes its structured
  // stdout to the website, which we read from the DB — no Docker socket needed.
  const [realLines, setRealLines] = useState<ConsoleLine[]>([]);
  const [logsAvailable, setLogsAvailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef(0);
  const runId = activeRun?.id ?? null;

  const mapLevel = (lvl: string): ConsoleLine["level"] => {
    const l = lvl.toUpperCase();
    if (l === "SENT" || l === "OK") return "ok";
    if (l === "WARNING" || l === "WARN") return "warn";
    if (l === "ERROR" || l === "CRITICAL") return "err";
    if (l === "RAW") return "dim";
    return "info";
  };

  useEffect(() => {
    // Reset when switching runs.
    setRealLines([]);
    setLogsAvailable(false);
    lastIdRef.current = 0;
    if (!runId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getPluginRunLogs({
          data: { runId, afterId: lastIdRef.current, limit: 500 },
        });
        if (cancelled) return;
        if (res.lines.length > 0) {
          lastIdRef.current = res.lastId;
          setLogsAvailable(true);
          setRealLines((prev) => {
            const next = [
              ...prev,
              ...res.lines.map((l) => ({
                time: l.ts || "--:--:--",
                level: mapLevel(l.level),
                text: l.msg,
              })),
            ];
            // Keep the console bounded.
            return next.length > 1000 ? next.slice(-1000) : next;
          });
        }
      } catch {
        // best effort — keep showing whatever we have
      }
    };

    poll();
    // Poll faster while active, slower afterwards to catch any final lines.
    const active = status === "running" || status === "pending";
    const id = setInterval(poll, active ? 2000 : 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, status]);

  const lines =
    logsAvailable && realLines.length > 0
      ? realLines
      : buildConsoleLines(meta, activeRun);

  // Auto-scroll to the newest line as logs stream in.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const levelColor: Record<ConsoleLine["level"], string> = {
    info: "text-sky-300",
    ok: "text-green-400",
    warn: "text-yellow-400",
    err: "text-red-400",
    dim: "text-muted-foreground/60",
  };

  const handleStop = async () => {
    if (!activeRun) return;
    setStopping(true);
    try {
      await stopPluginRun({ data: { runId: activeRun.id } });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : t("dash.err.stopRun"));
    } finally {
      setStopping(false);
    }
  };

  const handleExport = () => {
    const body = lines.map((l) => `[${l.time}] ${l.text}`).join("\n");
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pluginId}-${activeRun?.id ?? "logs"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col self-start overflow-hidden rounded-xl border border-border/40 bg-[#0e1119] xl:sticky xl:top-6">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground/90">{t("dash.feat.liveConsole")}</span>
          <RunStatusPill status={status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={lines.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground disabled:opacity-40"
            title="Export logs"
          >
            <Download className="h-3 w-3" />
            Export
          </button>
          {running ? (
            <button
              onClick={handleStop}
              disabled={stopping}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              {stopping ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              Stop
            </button>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground/60">
              {activeRun?.id ?? "no active run"}
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-[440px] overflow-y-auto no-scrollbar px-4 py-3 font-mono text-[12px] leading-relaxed"
      >
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground/40">{l.time}</span>
            <span className={levelColor[l.level]}>{l.text}</span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-1">
          <span className="text-green-400">$</span>
          <span className="inline-block h-3.5 w-1.5 animate-pulse bg-green-400/70" />
        </div>
      </div>

      <div className="border-t border-white/5 bg-white/[0.02] px-4 py-2 text-[11px] text-muted-foreground">
        {logsAvailable
          ? "Live output streamed from your running container · refreshes every 3s"
          : t("dash.consoleEmpty")}
      </div>
    </div>
  );
}

function PluginPaywall({
  pluginId,
  meta,
  onChanged,
}: {
  pluginId: PluginType;
  meta: PluginMeta;
  onChanged: () => void;
}) {
  const t = useT();
  const { formatPrice } = usePreferences();
  const [open, setOpen] = useState(false);

  return (
    <section className="mx-auto max-w-lg">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6 md:p-8">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-foreground">
            {meta.icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{meta.name}</h2>
            <p className="text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </div>

        <div className="mt-6 flex items-end justify-between rounded-xl border border-border/50 bg-muted/20 px-5 py-4">
          <div>
            <p className="text-3xl font-bold text-foreground">{formatPrice(meta.price)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("dash.oneTimeLifetime")}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-[11px] font-medium text-yellow-400">
            <Bitcoin className="h-3 w-3" />{t("dash.payWithCrypto")}</span>
        </div>

        <ul className="mt-6 space-y-2">
          {meta.features.map((f) => (
            <li
              key={f}
              className="flex items-start gap-2 text-sm text-foreground/80"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
              <span>{f}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={() => setOpen(true)}
          className="mt-6 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-all hover:bg-accent/90"
        >
          Unlock for {formatPrice(meta.price)}
        </button>

        <div className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" />{t("dash.redeemHint")}</div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-border/60 bg-card/95 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="text-xl tracking-tight">
              Unlock {meta.name}
            </DialogTitle>
          </DialogHeader>
          <Separator />
          <CryptoInvoiceFlow
            title={meta.name}
            priceUsd={meta.price}
            initPayment={(coin) =>
              initPluginPayment({
                data: { pluginId, coin },
              }) as Promise<PaymentInfo>
            }
            onClose={() => setOpen(false)}
            onPaid={onChanged}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Animated accordion section — the building block for both plugin config forms.
// Smoothly expands/collapses (grid-rows trick) and fades/rises in on mount with
// a staggered delay so the whole form animates in section-by-section.
// ---------------------------------------------------------------------------

function AccordionSection({
  icon,
  title,
  subtitle,
  summary,
  defaultOpen = false,
  index = 0,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  index?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="ac-reveal overflow-hidden rounded-xl border border-border/40 bg-muted/10 transition-colors duration-200 hover:border-border/70"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
            open
              ? "border-foreground/30 bg-foreground/10 text-foreground scale-105"
              : "border-border/50 bg-muted/30 text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
        {summary && (
          <span
            className={`hidden max-w-[42%] truncate text-xs font-medium text-muted-foreground transition-opacity duration-200 sm:block ${
              open ? "opacity-0" : "opacity-100"
            }`}
          >
            {summary}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
            open ? "rotate-180 text-foreground" : ""
          }`}
        />
      </button>
      <div
        className={`grid transition-all duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border/30 px-4 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

type AiReplyFields = {
  aiEnabled: boolean;
  aiApiKey: string;
  aiModel: string;
  aiPrompt: string;
};

type SharedExtraFields = {
  blockedWords: string[];
  blacklistUserIds: string[];
  firstMessage: string;
  webhookUrl: string;
  notifyOnBan: boolean;
  logDms: boolean;
  customStatus: string;
};

type SpamConfig = {
  tokens: string[];
  channelId: string;
  channels: { channelId: string; intervalMinutes: number }[];
  intervalMinutes: number;
  messages: string[];
  replaceMode: boolean;
  maxSendFailures: number;
  autoDelete: boolean;
  autoDeleteSeconds: number;
  proxy: string;
  mode: "dm" | "friend";
  autoReplyEnabled: boolean;
  autoReply: string;
  dmDelaySeconds: number;
  maxConcurrentReplies: number;
  smartSend: boolean;
  minOnline: number;
  schedule: { time: string; message: string }[];
  massDmEnabled: boolean;
  massDmUserIds: string[];
  massDmMessage: string;
} & AiReplyFields & SharedExtraFields;

// --- Reusable config building blocks (shared by both plugin configs) -------

const cfgInputCls =
  "w-full rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none";

/** Chip-style editor for a list of short strings (ids, words). */
function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) {
      onChange(Array.from(new Set([...values, ...parts])));
    }
    setDraft("");
  };
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-2.5">
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-xs font-medium"
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, idx) => idx !== i))}
                className="text-muted-foreground transition-colors hover:text-red-400"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        className="w-full bg-transparent px-1 py-1 text-sm focus:outline-none"
      />
    </div>
  );
}

/** A toggle card with an icon, title and description. */
function ToggleCard({
  checked,
  onChange,
  title,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-4 transition-colors hover:bg-muted/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border border-border/40"
      />
      <span className="space-y-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{desc}</span>
      </span>
    </label>
  );
}

/**
 * Shared "AI Reply" + "Safety & Notifications" accordion sections, reused by
 * both the Spam and Auto-Reply plugin configs so reply behaviour stays in sync.
 */
function SharedReplyExtras({
  startIndex,
  ai,
  setAi,
  extras,
  setExtras,
}: {
  startIndex: number;
  ai: AiReplyFields;
  setAi: (next: AiReplyFields) => void;
  extras: SharedExtraFields;
  setExtras: (next: SharedExtraFields) => void;
}) {
  return (
    <>
      {/* ---------------- AI REPLY ---------------- */}
      <AccordionSection
        index={startIndex}
        icon={<Sparkles className="h-4 w-4" />}
        title="AI Replies"
        subtitle="Generate human-like replies with an LLM (Groq)"
        summary={ai.aiEnabled ? "On" : "Off"}
      >
        <div className="space-y-4">
          <ToggleCard
            checked={ai.aiEnabled}
            onChange={(v) => setAi({ ...ai, aiEnabled: v })}
            title="Enable AI-generated replies"
            desc="When on, each reply is written by the model using the incoming message as context. Falls back to your static reply on any error, so a run never stalls."
          />
          {ai.aiEnabled && (
            <div className="space-y-4 rounded-lg border border-border/40 bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold">Groq API key</label>
                  <input
                    type="password"
                    placeholder="gsk_…"
                    value={ai.aiApiKey}
                    onChange={(e) => setAi({ ...ai, aiApiKey: e.target.value })}
                    className={cfgInputCls}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold">Model</label>
                  <input
                    type="text"
                    placeholder="llama-3.3-70b-versatile"
                    value={ai.aiModel}
                    onChange={(e) => setAi({ ...ai, aiModel: e.target.value })}
                    className={cfgInputCls}
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">System prompt</label>
                <textarea
                  rows={3}
                  placeholder="You are a friendly Discord user. Reply casually and briefly."
                  value={ai.aiPrompt}
                  onChange={(e) => setAi({ ...ai, aiPrompt: e.target.value })}
                  className={cfgInputCls + " resize-none"}
                />
              </div>
            </div>
          )}
        </div>
      </AccordionSection>

      {/* ---------------- SAFETY & NOTIFICATIONS ---------------- */}
      <AccordionSection
        index={startIndex + 1}
        icon={<Bell className="h-4 w-4" />}
        title="Safety & Notifications"
        subtitle="Blocked words, blacklist, first message & webhook alerts"
        summary={
          [
            extras.blockedWords.length ? `${extras.blockedWords.length} word` : null,
            extras.blacklistUserIds.length ? `${extras.blacklistUserIds.length} blocked` : null,
            extras.webhookUrl ? "webhook" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Off"
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Blocked words</label>
              <p className="text-xs text-muted-foreground">
                Skip replying to any DM that contains one of these. Press Enter to add.
              </p>
              <TagInput
                values={extras.blockedWords}
                onChange={(v) => setExtras({ ...extras, blockedWords: v })}
                placeholder="word, then Enter"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Blacklisted user IDs</label>
              <p className="text-xs text-muted-foreground">
                These users are never DMed or auto-replied to.
              </p>
              <TagInput
                values={extras.blacklistUserIds}
                onChange={(v) => setExtras({ ...extras, blacklistUserIds: v })}
                placeholder="user id, then Enter"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold">First-contact message</label>
            <textarea
              rows={2}
              placeholder="Optional — sent the first time someone (or a new friend) messages. Leave empty to use the normal reply."
              value={extras.firstMessage}
              onChange={(e) => setExtras({ ...extras, firstMessage: e.target.value })}
              className={cfgInputCls + " resize-none"}
            />
          </div>

          <div className="space-y-3 border-t border-border/30 pt-5">
            <label className="mb-1 block text-sm font-semibold">Discord webhook</label>
            <input
              type="text"
              placeholder="https://discord.com/api/webhooks/…"
              value={extras.webhookUrl}
              onChange={(e) => setExtras({ ...extras, webhookUrl: e.target.value })}
              className={cfgInputCls}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleCard
                checked={extras.notifyOnBan}
                onChange={(v) => setExtras({ ...extras, notifyOnBan: v })}
                title="Ban / timeout alerts"
                desc="Send an embed to the webhook whenever an account is rotated out after a ban or timeout."
              />
              <ToggleCard
                checked={extras.logDms}
                onChange={(v) => setExtras({ ...extras, logDms: v })}
                title="Log incoming DMs"
                desc="Forward every received DM to the webhook for monitoring."
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold">Custom status</label>
            <input
              type="text"
              placeholder="Optional — set a custom status on each account"
              value={extras.customStatus}
              onChange={(e) => setExtras({ ...extras, customStatus: e.target.value })}
              className={cfgInputCls}
            />
          </div>
        </div>
      </AccordionSection>
    </>
  );
}

function DiscordSpamConfig({
  savedConfig,
  activeRun,
  onClose,
  onChanged,
}: {
  savedConfig: SpamConfig | null;
  activeRun?: PluginRunRow | null;
  onClose?: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [tokens, setTokens] = useState<string[]>(savedConfig?.tokens?.length ? savedConfig.tokens : [""]);
  const [channelId, setChannelId] = useState(savedConfig?.channelId ?? "");
  const [interval, setInterval] = useState(String(savedConfig?.intervalMinutes ?? 0.5));
  const [messages, setMessages] = useState<string[]>(
    savedConfig?.messages?.length ? savedConfig.messages : [t("dash.err.sendingSpam")],
  );
  const [replaceMode, setReplaceMode] = useState(savedConfig?.replaceMode ?? false);
  const [maxSendFailures, setMaxSendFailures] = useState(String(savedConfig?.maxSendFailures ?? 3));
  const [autoDelete, setAutoDelete] = useState(savedConfig?.autoDelete ?? true);
  const [autoDeleteSeconds, setAutoDeleteSeconds] = useState(String(savedConfig?.autoDeleteSeconds ?? 20));
  const [proxy, setProxy] = useState(savedConfig?.proxy ?? "");
  const [mode, setMode] = useState<"dm" | "friend">(savedConfig?.mode ?? "dm");
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(savedConfig?.autoReplyEnabled ?? false);
  const [autoReply, setAutoReply] = useState(savedConfig?.autoReply ?? "");
  const [dmDelaySeconds, setDmDelaySeconds] = useState(String(savedConfig?.dmDelaySeconds ?? 20));
  const [maxConcurrentReplies, setMaxConcurrentReplies] = useState(String(savedConfig?.maxConcurrentReplies ?? 10));
  const [channels, setChannels] = useState<{ channelId: string; intervalMinutes: number }[]>(
    savedConfig?.channels ?? [],
  );
  const [smartSend, setSmartSend] = useState(savedConfig?.smartSend ?? false);
  const [minOnline, setMinOnline] = useState(String(savedConfig?.minOnline ?? 5));
  const [schedule, setSchedule] = useState<{ time: string; message: string }[]>(
    savedConfig?.schedule ?? [],
  );
  const [massDmEnabled, setMassDmEnabled] = useState(savedConfig?.massDmEnabled ?? false);
  const [massDmUserIds, setMassDmUserIds] = useState<string[]>(savedConfig?.massDmUserIds ?? []);
  const [massDmMessage, setMassDmMessage] = useState(savedConfig?.massDmMessage ?? "");
  const [ai, setAi] = useState<AiReplyFields>({
    aiEnabled: savedConfig?.aiEnabled ?? false,
    aiApiKey: savedConfig?.aiApiKey ?? "",
    aiModel: savedConfig?.aiModel ?? "llama-3.3-70b-versatile",
    aiPrompt:
      savedConfig?.aiPrompt ??
      "You are a friendly Discord user. Reply casually and briefly to the message.",
  });
  const [extras, setExtras] = useState<SharedExtraFields>({
    blockedWords: savedConfig?.blockedWords ?? [],
    blacklistUserIds: savedConfig?.blacklistUserIds ?? [],
    firstMessage: savedConfig?.firstMessage ?? "",
    webhookUrl: savedConfig?.webhookUrl ?? "",
    notifyOnBan: savedConfig?.notifyOnBan ?? false,
    logDms: savedConfig?.logDms ?? false,
    customStatus: savedConfig?.customStatus ?? "",
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleAddToken = () => setTokens([...tokens, ""]);
  const handleRemoveToken = (idx: number) =>
    setTokens(tokens.filter((_, i) => i !== idx));
  const handleTokenChange = (idx: number, val: string) => {
    const updated = [...tokens];
    updated[idx] = val;
    setTokens(updated);
  };

  const handleAddMessage = () => setMessages([...messages, ""]);
  const handleRemoveMessage = (idx: number) =>
    setMessages(messages.filter((_, i) => i !== idx));
  const handleMessageChange = (idx: number, val: string) => {
    const updated = [...messages];
    updated[idx] = val;
    setMessages(updated);
  };

  const buildConfig = (): SpamConfig => ({
    tokens: tokens.map((t) => t.trim()).filter(Boolean),
    channelId: channelId.trim(),
    channels: channels
      .map((c) => ({
        channelId: c.channelId.trim(),
        intervalMinutes: Number(c.intervalMinutes) || 0.5,
      }))
      .filter((c) => c.channelId),
    intervalMinutes: Number(interval) || 0.5,
    messages: messages.map((m) => m.trim()).filter(Boolean),
    replaceMode,
    maxSendFailures: Number(maxSendFailures) || 3,
    autoDelete,
    autoDeleteSeconds: Number(autoDeleteSeconds) || 20,
    proxy: proxy.trim(),
    mode,
    autoReplyEnabled,
    autoReply: autoReply.trim(),
    dmDelaySeconds: Number(dmDelaySeconds) || 20,
    maxConcurrentReplies: Number(maxConcurrentReplies) || 10,
    smartSend,
    minOnline: Number(minOnline) || 5,
    schedule: schedule
      .map((s) => ({ time: s.time.trim(), message: s.message.trim() }))
      .filter((s) => s.time && s.message),
    massDmEnabled,
    massDmUserIds: massDmUserIds.map((u) => u.trim()).filter(Boolean),
    massDmMessage: massDmMessage.trim(),
    ...ai,
    aiApiKey: ai.aiApiKey.trim(),
    ...extras,
    customStatus: extras.customStatus.trim(),
    webhookUrl: extras.webhookUrl.trim(),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePluginConfig({ data: { pluginId: "discord-spam", config: buildConfig() } });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    const hasChannel = channelId.trim() || channels.some((c) => c.channelId.trim());
    if (!tokens.every((t) => t.trim()) || !hasChannel || !messages.some((m) => m.trim())) {
      alert(t("dash.err.fillRequired"));
      return;
    }
    if (autoReplyEnabled && !autoReply.trim()) {
      alert(t("dash.err.enterReply"));
      return;
    }
    setRunning(true);
    try {
      const res = await runPlugin({
        data: { pluginId: "discord-spam", config: buildConfig() },
      });
      onChanged();
      if (res.dockerAvailable) {
        alert(
          "Bot launched. A dedicated container is starting now — watch the live console for status updates.",
        );
      } else {
        alert(
          "Configuration saved and run queued.\n\nThe Docker engine isn't reachable from this environment, so the run is recorded as 'pending' and will start automatically once a container host picks it up.",
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const runStatus = activeRun?.status ?? "idle";
  const isRunning =
    runStatus === "running" || runStatus === "pending" || runStatus === "starting";

  const handleStop = async () => {
    if (!activeRun) return;
    setStopping(true);
    try {
      await stopPluginRun({ data: { runId: activeRun.id } });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to stop the bot");
    } finally {
      setStopping(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {/* ---------------- ACCOUNTS & TOKENS ---------------- */}
        <AccordionSection
          index={0}
          defaultOpen
          icon={<KeyRound className="h-4 w-4" />}
          title={t("dash.spam.accounts")}
          subtitle={t("dash.spam.accountsDescSpam")}
          summary={`${tokens.filter((t) => t.trim()).length} active`}
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">{t("dash.discordTokens")}</label>
              <button
                onClick={handleAddToken}
                className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> {t("dash.addToken")}
              </button>
            </div>
            <div className="space-y-2">
              {tokens.map((token, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder={`Token ${idx + 1}`}
                    value={token}
                    onChange={(e) => handleTokenChange(idx, e.target.value)}
                    className={inputCls + " flex-1"}
                  />
                  {tokens.length > 1 && (
                    <button
                      onClick={() => handleRemoveToken(idx)}
                      className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                      aria-label={t("dash.removeToken")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              {t("dash.spam.tokenSafety")}
            </p>
          </div>
        </AccordionSection>

        {/* ---------------- CHANNEL & MESSAGES ---------------- */}
        <AccordionSection
          index={1}
          icon={<Hash className="h-4 w-4" />}
          title={t("dash.spam.channelMessages")}
          subtitle={t("dash.spam.channelDesc")}
          summary={`${messages.filter((m) => m.trim()).length} msg · ${interval}m`}
        >
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="mb-2 block text-sm font-semibold">{t("dash.spam.targetChannel")}</label>
                <input
                  type="text"
                  placeholder="e.g. 299949507989340160"
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">{t("dash.spam.intervalMin")}</label>
                <NumberStepper
                  value={interval}
                  onChange={setInterval}
                  min={0.1}
                  step={0.1}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">{t("dash.spam.maxFailures")}</label>
                <NumberStepper
                  value={maxSendFailures}
                  onChange={setMaxSendFailures}
                  min={1}
                  step={1}
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">{t("dash.messagesToSend")}</label>
                <button
                  onClick={handleAddMessage}
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> {t("dash.addMessage")}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {messages.map((msg, idx) => (
                  <div key={idx} className="relative">
                    <textarea
                      placeholder={`Message ${idx + 1} (supports newlines)`}
                      value={msg}
                      onChange={(e) => handleMessageChange(idx, e.target.value)}
                      rows={3}
                      className={inputCls + " resize-none pr-9"}
                    />
                    {messages.length > 1 && (
                      <button
                        onClick={() => handleRemoveMessage(idx)}
                        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                        aria-label={t("dash.removeMessage")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 border-t border-border/30 pt-5 sm:grid-cols-2">
              <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={autoDelete}
                    onChange={(e) => setAutoDelete(e.target.checked)}
                    className="rounded border border-border/40"
                  />
                  <span className="text-sm font-medium">{t("dash.spam.autoDelete")}</span>
                </label>
                {autoDelete && (
                  <div className="mt-3 flex items-center gap-2">
                    <NumberStepper
                      value={autoDeleteSeconds}
                      onChange={setAutoDeleteSeconds}
                      min={1}
                      step={1}
                      className="w-32"
                    />
                    <span className="text-xs text-muted-foreground">
                      seconds after sending
                    </span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border/40 bg-muted/20 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={replaceMode}
                    onChange={(e) => setReplaceMode(e.target.checked)}
                    className="rounded border border-border/40"
                  />
                  <span className="text-sm font-medium">{t("dash.replaceMode")}</span>
                </label>
                <p className="mt-2 text-xs text-muted-foreground">{t("dash.spam.autoDeleteDesc")}</p>
              </div>
            </div>
          </div>
        </AccordionSection>

        {/* ---------------- AUTO-REPLY ---------------- */}
        <AccordionSection
          index={2}
          icon={<Reply className="h-4 w-4" />}
          title={t("dash.autoReplyTitle")}
          subtitle={t("dash.ar.replyDmFriend")}
          summary={
            autoReplyEnabled
              ? mode === "dm"
                ? "DMs"
                : "Friends"
              : "Off"
          }
        >
          <div className="space-y-5">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={autoReplyEnabled}
                onChange={(e) => setAutoReplyEnabled(e.target.checked)}
                className="rounded border border-border/40"
              />
              <span className="text-sm font-medium">{t("dash.ar.enableAutoReply")}</span>
            </label>

            {autoReplyEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">{t("dash.source")}</label>
                  <div className="inline-flex rounded-lg border border-border/50 bg-muted/20 p-1">
                    {(["dm", "friend"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                          mode === m
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m === "dm" ? (
                          <MessageSquare className="h-3.5 w-3.5" />
                        ) : (
                          <UserPlus className="h-3.5 w-3.5" />
                        )}
                        {m === "dm" ? "DMs" : "Friends"}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {mode === "dm"
                      ? "Reply to anyone who sends a direct message."
                      : "Accept incoming friend requests (after a humanized delay), then wait. When the new friend sends their first message it is queued for the reply below — no captcha, nothing that risks the account."}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold">
                    {t("dash.ar.replyMessage")}
                  </label>
                  <textarea
                    placeholder={t("dash.ar.replyPh")}
                    value={autoReply}
                    onChange={(e) => setAutoReply(e.target.value)}
                    rows={2}
                    className={inputCls + " resize-none"}
                  />
                </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold">{t("dash.ar.replyDelay")}</label>
                      <NumberStepper
                        value={dmDelaySeconds}
                        onChange={setDmDelaySeconds}
                        min={0}
                        step={1}
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold">{t("dash.ar.maxConcurrent")}</label>
                      <NumberStepper
                        value={maxConcurrentReplies}
                        onChange={setMaxConcurrentReplies}
                        min={1}
                        step={1}
                      />
                    </div>
                  </div>
              </>
            )}
          </div>
        </AccordionSection>

        {/* ---------------- EXTRA CHANNELS (multi-channel) ---------------- */}
        <AccordionSection
          index={3}
          icon={<Hash className="h-4 w-4" />}
          title="Extra Channels"
          subtitle="Spam multiple channels, each with its own interval"
          summary={channels.length ? `${channels.length} extra` : "None"}
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Each row spams its own channel independently using the same message
              pool above. The main target channel keeps running too.
            </p>
            {channels.map((ch, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Channel ID"
                  value={ch.channelId}
                  onChange={(e) => {
                    const next = [...channels];
                    next[idx] = { ...next[idx], channelId: e.target.value };
                    setChannels(next);
                  }}
                  className={inputCls + " flex-1"}
                />
                <div className="w-28 shrink-0">
                  <NumberStepper
                    value={String(ch.intervalMinutes)}
                    onChange={(v) => {
                      const next = [...channels];
                      next[idx] = { ...next[idx], intervalMinutes: Number(v) || 0.5 };
                      setChannels(next);
                    }}
                    min={0.1}
                    step={0.1}
                  />
                </div>
                <button
                  onClick={() => setChannels(channels.filter((_, i) => i !== idx))}
                  className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remove channel"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setChannels([...channels, { channelId: "", intervalMinutes: 0.5 }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add channel
            </button>
          </div>
        </AccordionSection>

        {/* ---------------- SMART SEND ---------------- */}
        <AccordionSection
          index={4}
          icon={<Activity className="h-4 w-4" />}
          title="Smart Send"
          subtitle="Only post when enough members are online"
          summary={smartSend ? `≥ ${minOnline}` : "Off"}
        >
          <div className="space-y-4">
            <ToggleCard
              checked={smartSend}
              onChange={setSmartSend}
              title="Enable smart send"
              desc="Skip a tick when fewer than the threshold of members are online, so messages land when people can actually see them."
            />
            {smartSend && (
              <div className="w-40">
                <label className="mb-2 block text-sm font-semibold">Minimum online</label>
                <NumberStepper value={minOnline} onChange={setMinOnline} min={0} step={1} />
              </div>
            )}
          </div>
        </AccordionSection>

        {/* ---------------- SCHEDULER ---------------- */}
        <AccordionSection
          index={5}
          icon={<Clock className="h-4 w-4" />}
          title="Scheduled Messages"
          subtitle="Send one-off messages at specific UTC times"
          summary={schedule.length ? `${schedule.length} scheduled` : "None"}
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Each entry fires once per day at the given time (UTC, 24h) on the
              main target channel.
            </p>
            {schedule.map((s, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <input
                  type="time"
                  value={s.time}
                  onChange={(e) => {
                    const next = [...schedule];
                    next[idx] = { ...next[idx], time: e.target.value };
                    setSchedule(next);
                  }}
                  className={inputCls + " w-32 shrink-0"}
                />
                <textarea
                  rows={2}
                  placeholder="Message to send"
                  value={s.message}
                  onChange={(e) => {
                    const next = [...schedule];
                    next[idx] = { ...next[idx], message: e.target.value };
                    setSchedule(next);
                  }}
                  className={inputCls + " flex-1 resize-none"}
                />
                <button
                  onClick={() => setSchedule(schedule.filter((_, i) => i !== idx))}
                  className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Remove schedule"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setSchedule([...schedule, { time: "12:00", message: "" }])}
              className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add scheduled message
            </button>
          </div>
        </AccordionSection>

        {/* ---------------- MASS DM ---------------- */}
        <AccordionSection
          index={6}
          icon={<Send className="h-4 w-4" />}
          title="Mass DM"
          subtitle="One-time direct-message blast on startup"
          summary={massDmEnabled ? `${massDmUserIds.length} target` : "Off"}
        >
          <div className="space-y-4">
            <ToggleCard
              checked={massDmEnabled}
              onChange={setMassDmEnabled}
              title="Enable mass DM"
              desc="When the bot starts it DMs every listed user once, heavily paced to stay ban-safe. Blacklisted users are skipped."
            />
            {massDmEnabled && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Target user IDs</label>
                  <TagInput
                    values={massDmUserIds}
                    onChange={setMassDmUserIds}
                    placeholder="user id, then Enter"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-semibold">Message</label>
                  <textarea
                    rows={3}
                    placeholder="Type @user to mention the recipient."
                    value={massDmMessage}
                    onChange={(e) => setMassDmMessage(e.target.value)}
                    className={inputCls + " resize-none"}
                  />
                </div>
              </>
            )}
          </div>
        </AccordionSection>

        <SharedReplyExtras
          startIndex={7}
          ai={ai}
          setAi={setAi}
          extras={extras}
          setExtras={setExtras}
        />

        {/* ---------------- PROXY ---------------- */}
        <AccordionSection
          index={9}
          icon={<Globe className="h-4 w-4" />}
          title={t("dash.proxyTitle")}
          subtitle={t("dash.proxyOptionalSafe")}
          summary={proxy ? "Configured" : "Direct"}
        >
          <div className="space-y-2">
            <input
              type="text"
              placeholder={t("dash.proxyPh")}
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              className={inputCls}
            />
            <p className="text-xs text-muted-foreground">
              A residential or healthy proxy keeps accounts safe by avoiding
              datacenter IP flags. Leave empty to connect directly.
            </p>
          </div>
        </AccordionSection>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 border-t border-border/30 pt-6">
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
          >{t("dash.cancel")}</button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Config"}
        </button>
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600/80 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-600 disabled:opacity-50"
          >
            {stopping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {stopping ? "Stopping…" : "Stop Bot"}
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={running}
            className="flex-1 rounded-lg bg-green-600/80 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-600 disabled:opacity-50"
          >
            {running ? "Starting…" : "Start Bot"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discord Auto-Reply config — reply-only (no channel spam). The user picks a
// mode (DM vs Friend) and a reply message; the bot only answers incoming DMs.
// ---------------------------------------------------------------------------

type AutoReplyConfig = {
  mode: "dm" | "friend";
  autoReply: string;
  autoReplyLines: string[];
  autoReplyLinesRandom: boolean;
  dmDelaySeconds: number;
  maxConcurrentReplies: number;
  friendAcceptDelay: number;
  singleReply: boolean;
  group1Count: number;
  friendOneAtATime: boolean;
  friendCrossToken: boolean;
  proxy: string;
} & AiReplyFields & SharedExtraFields;

function DiscordAutoReplyConfig({
  savedConfig,
  activeRun,
  onClose,
  onChanged,
}: {
  savedConfig: AutoReplyConfig | null;
  activeRun?: PluginRunRow | null;
  onClose?: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [tokens, setTokens] = useState<string[]>(
    savedConfig?.tokens?.length ? savedConfig.tokens : [""],
  );
  const [mode, setMode] = useState<"dm" | "friend">(savedConfig?.mode ?? "dm");
  const [autoReply, setAutoReply] = useState(savedConfig?.autoReply ?? "");
  const [autoReplyLines, setAutoReplyLines] = useState<string[]>(
    savedConfig?.autoReplyLines?.length ? savedConfig.autoReplyLines : [],
  );
  const [autoReplyLinesRandom, setAutoReplyLinesRandom] = useState(
    savedConfig?.autoReplyLinesRandom ?? true,
  );
  const [dmDelaySeconds, setDmDelaySeconds] = useState(
    String(savedConfig?.dmDelaySeconds ?? 20),
  );
  const [maxConcurrentReplies, setMaxConcurrentReplies] = useState(
    String(savedConfig?.maxConcurrentReplies ?? 10),
  );
  const [friendAcceptDelay, setFriendAcceptDelay] = useState(
    String(savedConfig?.friendAcceptDelay ?? 12),
  );
  const [singleReply, setSingleReply] = useState(savedConfig?.singleReply ?? false);
  const [group1Count, setGroup1Count] = useState(
    String(savedConfig?.group1Count ?? 0),
  );
  const [friendOneAtATime, setFriendOneAtATime] = useState(
    savedConfig?.friendOneAtATime ?? false,
  );
  const [friendCrossToken, setFriendCrossToken] = useState(
    savedConfig?.friendCrossToken ?? false,
  );
  const [proxy, setProxy] = useState(savedConfig?.proxy ?? "");
  const [ai, setAi] = useState<AiReplyFields>({
    aiEnabled: savedConfig?.aiEnabled ?? false,
    aiApiKey: savedConfig?.aiApiKey ?? "",
    aiModel: savedConfig?.aiModel ?? "llama-3.3-70b-versatile",
    aiPrompt:
      savedConfig?.aiPrompt ??
      "You are a friendly Discord user. Reply casually and briefly to the message.",
  });
  const [extras, setExtras] = useState<SharedExtraFields>({
    blockedWords: savedConfig?.blockedWords ?? [],
    blacklistUserIds: savedConfig?.blacklistUserIds ?? [],
    firstMessage: savedConfig?.firstMessage ?? "",
    webhookUrl: savedConfig?.webhookUrl ?? "",
    notifyOnBan: savedConfig?.notifyOnBan ?? false,
    logDms: savedConfig?.logDms ?? false,
    customStatus: savedConfig?.customStatus ?? "",
  });
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleAddToken = () => setTokens([...tokens, ""]);
  const handleRemoveToken = (idx: number) =>
    setTokens(tokens.filter((_, i) => i !== idx));
  const handleTokenChange = (idx: number, val: string) => {
    const updated = [...tokens];
    updated[idx] = val;
    setTokens(updated);
  };

  const handleAddReplyLine = () =>
    setAutoReplyLines([...autoReplyLines, ""]);
  const handleRemoveReplyLine = (idx: number) =>
    setAutoReplyLines(autoReplyLines.filter((_, i) => i !== idx));
  const handleReplyLineChange = (idx: number, val: string) => {
    const updated = [...autoReplyLines];
    updated[idx] = val;
    setAutoReplyLines(updated);
  };

  const buildConfig = (): AutoReplyConfig => ({
    tokens: tokens.map((t) => t.trim()).filter(Boolean),
    mode,
    autoReply: autoReply.trim(),
    autoReplyLines: autoReplyLines.map((l) => l.trim()).filter(Boolean),
    autoReplyLinesRandom,
    dmDelaySeconds: Number(dmDelaySeconds) || 20,
    maxConcurrentReplies: Number(maxConcurrentReplies) || 10,
    friendAcceptDelay: Number(friendAcceptDelay) || 12,
    singleReply,
    group1Count: Number(group1Count) || 0,
    friendOneAtATime,
    friendCrossToken,
    proxy: proxy.trim(),
    ...ai,
    aiApiKey: ai.aiApiKey.trim(),
    ...extras,
    customStatus: extras.customStatus.trim(),
    webhookUrl: extras.webhookUrl.trim(),
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await savePluginConfig({
        data: { pluginId: "discord-autoreply", config: buildConfig() },
      });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!tokens.some((t) => t.trim())) {
      alert(t("dash.err.addToken"));
      return;
    }
    if (!autoReply.trim() && autoReplyLines.length === 0) {
      alert(t("dash.err.enterReply"));
      return;
    }
    setRunning(true);
    try {
      const res = await runPlugin({
        data: { pluginId: "discord-autoreply", config: buildConfig() },
      });
      onChanged();
      if (res.dockerAvailable) {
        alert(
          "Auto-Reply launched. A dedicated container is starting now — watch the live console for status updates.",
        );
      } else {
        alert(
          "Configuration saved and run queued.\n\nThe Docker engine isn't reachable from this environment, so the run is recorded as 'pending' and will start automatically once a container host picks it up.",
        );
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const runStatus = activeRun?.status ?? "idle";
  const isRunning =
    runStatus === "running" || runStatus === "pending" || runStatus === "starting";

  const handleStop = async () => {
    if (!activeRun) return;
    setStopping(true);
    try {
      await stopPluginRun({ data: { runId: activeRun.id } });
      onChanged();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to stop the bot");
    } finally {
      setStopping(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-sm transition-colors focus:border-accent focus:outline-none";

  const modes = [
    {
      id: "dm" as const,
      icon: <MessageSquare className="h-4 w-4" />,
      title: "DM mode",
      desc: t("dash.ar.dmModeDesc"),
    },
    {
      id: "friend" as const,
      icon: <UserPlus className="h-4 w-4" />,
      title: "Friend mode",
      desc: t("dash.ar.friendModeDesc"),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {/* ---------------- ACCOUNTS & TOKENS ---------------- */}
        <AccordionSection
          index={0}
          defaultOpen
          icon={<KeyRound className="h-4 w-4" />}
          title={t("dash.spam.accounts")}
          subtitle={t("dash.ar.accountsDesc")}
          summary={`${tokens.filter((t) => t.trim()).length} active`}
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">{t("dash.discordTokens")}</label>
              <button
                onClick={handleAddToken}
                className="inline-flex items-center gap-1 text-xs font-medium text-foreground/80 transition-colors hover:text-foreground hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> {t("dash.addToken")}
              </button>
            </div>
            <div className="space-y-2">
              {tokens.map((token, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder={`Token ${idx + 1}`}
                    value={token}
                    onChange={(e) => handleTokenChange(idx, e.target.value)}
                    className={inputCls + " flex-1"}
                  />
                  {tokens.length > 1 && (
                    <button
                      onClick={() => handleRemoveToken(idx)}
                      className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
                      aria-label={t("dash.removeToken")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              {t("dash.ar.tokenSafety")}
            </p>
          </div>
        </AccordionSection>

        {/* ---------------- MODE ---------------- */}
        <AccordionSection
          index={1}
          defaultOpen
          icon={<Zap className="h-4 w-4" />}
          title={t("dash.ar.replyMode")}
          subtitle={t("dash.ar.replyModeDesc")}
          summary={mode === "dm" ? "DM mode" : "Friend mode"}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {modes.map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-all duration-200 ${
                    active
                      ? "border-foreground/50 bg-foreground/[0.06] shadow-[0_0_0_1px_var(--color-foreground)]"
                      : "border-border/40 bg-muted/20 hover:border-border/70 hover:bg-muted/30"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                      active
                        ? "border-foreground/40 bg-foreground/15 text-foreground"
                        : "border-border/50 bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {m.icon}
                  </span>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {m.title}
                    {active && <Check className="h-3.5 w-3.5 text-foreground" />}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {m.desc}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === "friend" && (
            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold">{t("dash.ar.acceptDelay")}</label>
              <NumberStepper
                value={friendAcceptDelay}
                onChange={setFriendAcceptDelay}
                min={0}
                step={1}
                className="w-40"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                A humanized wait before accepting each request so it never looks
                automated.
              </p>
            </div>
          )}

          {mode === "friend" && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Single Reply (Group 1)</p>
                  <p className="text-xs text-muted-foreground">
                    Only one Group-1 account replies to each user. Others skip them.
                  </p>
                </div>
                <Toggle
                  pressed={singleReply}
                  onPressedChange={setSingleReply}
                  size="sm"
                />
              </div>

              {singleReply && (
                <div>
                  <label className="mb-1 block text-xs font-semibold">Group 1 account count</label>
                  <NumberStepper
                    value={String(group1Count)}
                    onChange={(v) => setGroup1Count(Number(v) || 0)}
                    min={0}
                    step={1}
                    className="w-32"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    First N accounts are Group 1. The rest are Group 2.
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Queue friend requests</p>
                  <p className="text-xs text-muted-foreground">
                    Process one incoming request at a time across all Group-1 accounts.
                  </p>
                </div>
                <Toggle
                  pressed={friendOneAtATime}
                  onPressedChange={setFriendOneAtATime}
                  size="sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Cross-token friend dedup</p>
                  <p className="text-xs text-muted-foreground">
                    If one Group-1 token already accepted a friend request, other tokens skip that user. Prevents duplicate accepts across tokens.
                  </p>
                </div>
                <Toggle
                  pressed={friendCrossToken}
                  onPressedChange={setFriendCrossToken}
                  size="sm"
                />
              </div>
            </div>
          )}
        </AccordionSection>

        {/* ---------------- REPLY MESSAGE & TIMING ---------------- */}
        <AccordionSection
          index={2}
          defaultOpen
          icon={<Reply className="h-4 w-4" />}
          title={t("dash.ar.msgTiming")}
          subtitle={t("dash.ar.msgTimingDesc")}
          summary={
            autoReply.trim() ? autoReply.trim() : "Empty"
          }
        >
          <div className="space-y-5">
            {/* ── Reply messages ───────────────────────────────── */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-semibold">
                  {t("dash.ar.replyMessages")}
                </label>
                <button
                  type="button"
                  onClick={handleAddReplyLine}
                  className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("dash.ar.addReplyLine")}
                </button>
              </div>

              {autoReplyLines.length === 0 && (
                <p className="py-3 text-center text-xs italic text-muted-foreground/50">
                  {t("dash.ar.noReplyLines")}
                </p>
              )}

              <div className="space-y-3">
                {autoReplyLines.map((line, idx) => (
                  <div key={idx} className="relative">
                    <div className="flex items-center gap-2">
                      <textarea
                        placeholder={`Reply ${idx + 1}`}
                        value={line}
                        onChange={(e) => handleReplyLineChange(idx, e.target.value)}
                        rows={2}
                        className={inputCls + " resize-none pr-9"}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveReplyLine(idx)}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/40 text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400"
                        title={t("common.delete")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Legacy single reply field — kept for backwards compat */}
              {autoReply.trim() && (
                <p className="mt-2 text-[11px] text-muted-foreground/50">
                  {t("dash.ar.legacyReplyNote")}
                </p>
              )}
            </div>

            {/* ── Timing controls ──────────────────────────────── */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  {t("dash.ar.replyDelay")}
                </label>
                <NumberStepper
                  value={dmDelaySeconds}
                  onChange={setDmDelaySeconds}
                  min={0}
                  step={1}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold">
                  {t("dash.ar.maxConcurrent")}
                </label>
                <NumberStepper
                  value={maxConcurrentReplies}
                  onChange={setMaxConcurrentReplies}
                  min={1}
                  step={1}
                />
              </div>
            </div>
          </div>
        </AccordionSection>

        <SharedReplyExtras
          startIndex={3}
          ai={ai}
          setAi={setAi}
          extras={extras}
          setExtras={setExtras}
        />

        {/* ---------------- PROXY ---------------- */}
        <AccordionSection
          index={5}
          icon={<Globe className="h-4 w-4" />}
          title={t("dash.proxyTitle")}
          subtitle={t("dash.proxyOptionalSafe")}
          summary={proxy ? "Configured" : "Direct"}
        >
          <div className="space-y-2">
            <input
              type="text"
              placeholder={t("dash.proxyPh")}
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              className={inputCls}
            />
            <p className="text-xs text-muted-foreground">
              A residential or healthy proxy keeps accounts safe by avoiding
              datacenter IP flags. Leave empty to connect directly.
            </p>
          </div>
        </AccordionSection>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 border-t border-border/30 pt-6">
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border/40 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
          >{t("dash.cancel")}</button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-lg border border-border/60 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Config"}
        </button>
        {isRunning ? (
          <button
            onClick={handleStop}
            disabled={stopping}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-600/80 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-red-600 disabled:opacity-50"
          >
            {stopping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            {stopping ? "Stopping…" : "Stop Bot"}
          </button>
        ) : (
          <button
            onClick={handleRun}
            disabled={running}
            className="flex-1 rounded-lg bg-green-600/80 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-600 disabled:opacity-50"
          >
            {running ? "Starting…" : "Start Bot"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styled number stepper (custom +/- buttons, no native browser arrows)
// ---------------------------------------------------------------------------

function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const t = useT();
  const decimals = (String(step).split(".")[1] ?? "").length;
  const clamp = (n: number) => {
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  };
  const commit = (n: number) => {
    if (Number.isNaN(n)) n = min ?? 0;
    const c = clamp(n);
    onChange(decimals ? c.toFixed(decimals) : String(c));
  };
  const current = Number(value);

  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-lg border border-border/40 bg-muted/30 transition-colors focus-within:border-accent ${
        className ?? ""
      }`}
    >
      <button
        type="button"
        aria-label={t("dash.decrease")}
        onClick={() => commit((Number.isNaN(current) ? 0 : current) - step)}
        className="grid w-9 shrink-0 place-items-center border-r border-border/40 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:bg-muted"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
        }}
        onBlur={() => commit(Number(value))}
        className="w-full min-w-0 bg-transparent px-2 py-2 text-center text-sm focus:outline-none"
      />
      <button
        type="button"
        aria-label={t("dash.increase")}
        onClick={() => commit((Number.isNaN(current) ? 0 : current) + step)}
        className="grid w-9 shrink-0 place-items-center border-l border-border/40 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground active:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tickets section
// ---------------------------------------------------------------------------

const TICKET_STATUS_MAP: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  open: {
    label: "dash.ticketStatus.open",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    icon: <AlertCircle className="h-3 w-3" />,
  },
  in_progress: {
    label: "dash.inProgress",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  closed: {
    label: "dash.ticketStatus.closed",
    className: "border-border bg-muted/20 text-muted-foreground",
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
};

const TICKET_PRIORITY_MAP: Record<
  string,
  { label: string; className: string }
> = {
  low: {
    label: "dash.prio.low",
    className: "border-border bg-muted/20 text-muted-foreground",
  },
  normal: {
    label: "dash.prio.normal",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  },
  high: {
    label: "dash.prio.high",
    className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  },
  urgent: {
    label: "dash.prio.urgent",
    className: "border-red-500/30 bg-red-500/10 text-red-400",
  },
};

function TicketStatusBadge({ status }: { status: string }) {
  const t = useT();
  const entry = TICKET_STATUS_MAP[status] ?? {
    label: status,
    className: "border-border bg-muted/20 text-muted-foreground",
    icon: null,
  };
  return (
    <Badge variant="outline" className={`gap-1 text-xs ${entry.className}`}>
      {entry.icon}
      {t(entry.label)}
    </Badge>
  );
}

function TicketPriorityBadge({ priority }: { priority: string }) {
  const t = useT();
  const entry = TICKET_PRIORITY_MAP[priority] ?? {
    label: priority,
    className: "border-border bg-muted/20 text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={`text-xs ${entry.className}`}>
      {t(entry.label)}
    </Badge>
  );
}

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

// ---------------------------------------------------------------------------
// Web ticket conversation drawer
// ---------------------------------------------------------------------------

function WebTicketConversation({
  ticket,
  onClose,
}: {
  ticket: TicketRow;
  onClose: () => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<TicketMessageRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleDownloadTranscript() {
    setDownloading(true);
    try {
      const { filename, content } = await getTicketTranscript({
        data: { ticketId: ticket.id },
      });
      downloadTextFile(filename, content);
    } catch {
      // ignore — ticket may have been removed
    } finally {
      setDownloading(false);
    }
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const msgs = await getTicketMessages({ data: { ticketId: ticket.id } });
      setMessages(msgs as TicketMessageRow[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
  }, [ticket.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendTicketMessage({
        data: { ticketId: ticket.id, content: reply.trim() },
      });
      setMessages((prev) => [...(prev ?? []), msg as TicketMessageRow]);
      setReply("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 md:p-6">
      <div
        className="flex flex-col w-full max-w-lg h-full max-h-[100dvh] sm:h-auto sm:max-h-[85dvh] sm:min-h-[24rem] rounded-2xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-2xl overflow-hidden"
        style={{ animation: "fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) both" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground/50">
                #{ticket.id.slice(-6).toUpperCase()}
              </span>
              <TicketStatusBadge status={ticket.status} />
              <TicketPriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-0.5 text-sm font-medium truncate">
              {ticket.subject}
            </p>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50"
              onClick={handleDownloadTranscript}
              disabled={downloading}
              aria-label={t("dash.downloadTranscript")}
              title={t("dash.downloadTranscript")}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              onClick={onClose}
              aria-label={t("dash.closeConversation")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("dash.noMessagesYet")}</p>
              <p className="text-xs text-muted-foreground/50 mt-1">{t("dash.staffReplySoon")}</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.is_staff ? "flex-row" : "flex-row-reverse"}`}
              >
                <div
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold
                    ${msg.is_staff ? "bg-primary/20 text-primary border border-primary/30" : "bg-muted/60 text-muted-foreground border border-border/40"}`}
                >
                  {msg.is_staff
                    ? "S"
                    : msg.author_tag.slice(0, 1).toUpperCase()}
                </div>
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed
                    ${
                      msg.is_staff
                        ? "rounded-tl-sm bg-primary/10 border border-primary/20 text-foreground/90"
                        : "rounded-tr-sm bg-muted/40 border border-border/30 text-foreground/80"
                    }`}
                >
                  <p className="mb-0.5 text-[10px] font-medium opacity-50">
                    {msg.is_staff ? "Staff" : msg.author_tag}
                    {" · "}
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    {new Date(msg.created_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                  <p className="whitespace-pre-wrap break-words">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Reply box */}
        <div className="border-t border-border/40 px-5 py-3.5 shrink-0">
          {ticket.status === "closed" ? (
            <p className="text-center text-xs text-muted-foreground py-1">{t("dash.ticketClosed")}</p>
          ) : (
            <form onSubmit={handleSend} className="flex gap-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("dash.writeReplyPh")}
                className="min-h-[42px] max-h-28 flex-1 resize-none text-sm py-2.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as unknown as React.FormEvent);
                  }
                }}
              />
              <Button
                type="submit"
                size="sm"
                className="h-auto self-end px-3 gap-1.5"
                disabled={!reply.trim() || sending}
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {sending ? "Sending…" : "Send"}
              </Button>
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
// ReviewsSection — public approved reviews with Leave a Review CTA
// ---------------------------------------------------------------------------

function ReviewsSection({
  reviews,
}: {
  reviews: ApprovedReview[];
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const t = useT();

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div
      className="space-y-6"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {/* Header + CTA */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground max-w-xl">
          {t("dash.reviews.subtitle")}
        </p>
        <Button
          size="sm"
          variant="default"
          onClick={() => setModalOpen(true)}
          className="shrink-0"
        >
          <MessageSquare className="h-4 w-4" />
          {t("dash.reviews.leaveReview")}
        </Button>
      </div>

      {/* Review cards grid */}
      {reviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-card/40 py-16 text-center">
          <div className="ac-float mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/30">
              <MessageSquare className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {t("dash.reviews.empty")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {t("dash.reviews.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review, i) => (
            <div
              key={review.id}
              className="group relative flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur-sm transition-all duration-300 hover:border-border hover:bg-card/60 hover:shadow-lg hover:shadow-black/10"
              style={{
                animation: `fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) ${i * 0.06}s both`,
              }}
            >
              {/* Stars */}
              <div className="flex items-center gap-0.5 text-amber-400 text-base leading-none">
                <span className="tracking-wide">{review.starsDisplay}</span>
              </div>

              {/* Feedback */}
              <p className="flex-1 text-sm leading-relaxed text-foreground/90">
                {review.feedback}
              </p>

              {/* Author + date */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                <span className="text-xs font-medium text-muted-foreground truncate">
                  {review.discordTag}
                </span>
                <span className="text-xs text-muted-foreground/60 shrink-0">
                  {formatDate(review.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Leave a Review modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("dash.reviews.modalTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("dash.reviews.modalBody")}
            </p>
            <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground mb-1">
                {t("dash.reviews.howToTitle")}
              </p>
              <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
                <li>{t("dash.reviews.step1")}</li>
                <li>{t("dash.reviews.step2")}</li>
                <li>{t("dash.reviews.step3")}</li>
              </ol>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/60 p-4">
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                {t("dash.reviews.commandLabel")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg bg-background px-3 py-2 font-mono text-sm text-foreground border border-border/60">
                  /review
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText("/review");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("dash.reviews.copy")}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketsSection — differentiated by plan tier
// ---------------------------------------------------------------------------

function TicketsSection({
  tickets,
  currentSubscription,
  onNavigate,
}: {
  tickets: TicketRow[];
  currentSubscription: {
    subscription: SubscriptionRow;
    plan: PlanRow | null;
  } | null;
  onNavigate: (s: DashboardSection) => void;
}) {
  // Web support is a Pro/Enterprise perk; Discord tickets stay available to all.
  const planId = currentSubscription?.subscription.plan_id;
  const webEnabled = planId === "pro" || planId === "enterprise";
  return (
    <PremiumTicketsSection
      tickets={tickets}
      webEnabled={webEnabled}
      onNavigate={onNavigate}
    />
  );
}

type TicketTabType = "web" | "discord";

function PremiumTicketsSection({
  tickets,
  webEnabled,
  onNavigate,
}: {
  tickets: TicketRow[];
  webEnabled: boolean;
  onNavigate: (s: DashboardSection) => void;
}) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TicketTabType>(
    webEnabled ? "web" : "discord",
  );
  const router = useRouter();

  const discordTickets = tickets.filter((t) => t.source === "discord");
  const webTickets = tickets.filter((t) => t.source === "web");

  // Web ticket form state
  const [showForm, setShowForm] = useState(false);
  const [formSubject, setFormSubject] = useState("");
  const [formCategory, setFormCategory] = useState<
    "general" | "billing" | "technical" | "account" | "feature"
  >("general");
  const [formPriority, setFormPriority] = useState<
    "normal" | "high" | "urgent"
  >("normal");
  const [formMessage, setFormMessage] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Conversation state
  const [openConversation, setOpenConversation] = useState<TicketRow | null>(
    null,
  );

  const hasOpenWebTicket = webTickets.some((t) => t.status !== "closed");
  const webOpen = webTickets.filter((t) => t.status !== "closed");
  const webClosed = webTickets.filter((t) => t.status === "closed");
  const discordOpen = discordTickets.filter((t) => t.status !== "closed");
  const discordClosed = discordTickets.filter((t) => t.status === "closed");
  const [showDiscordClosed, setShowDiscordClosed] = useState(false);
  const [showWebClosed, setShowWebClosed] = useState(false);

  async function handleOpenWebTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!formSubject.trim()) return;
    setFormLoading(true);
    setFormError(null);
    try {
      await openTicketWeb({
        data: {
          subject: formSubject.trim(),
          category: formCategory,
          priority: formPriority,
          message: formMessage.trim() || undefined,
        },
      });
      setShowForm(false);
      setFormSubject("");
      setFormCategory("general");
      setFormPriority("normal");
      setFormMessage("");
      router.invalidate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("TICKET_ALREADY_OPEN")) {
        setFormError(t("dash.alreadyOpenTicket"));
      } else {
        setFormError(msg);
      }
    } finally {
      setFormLoading(false);
    }
  }

  return (
    <div
      className="space-y-5"
      style={{ animation: "fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both" }}
    >
      {/* Tab switcher — pill segmented control */}
      <div className="inline-flex gap-1 rounded-full border border-border/60 bg-card/50 p-1">
        {(["web", "discord"] as TicketTabType[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200",
              activeTab === tab
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab === "web" ? (
              <FileText className="h-3.5 w-3.5" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
            {tab === "web" ? "Web" : "Discord"}
            {tab === "web" && webOpen.length > 0 && (
              <span
                className={[
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                  activeTab === tab
                    ? "bg-background/20 text-background"
                    : "bg-foreground/15 text-foreground",
                ].join(" ")}
              >
                {webOpen.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Web Tickets Tab */}
      {activeTab === "web" && !webEnabled && (
        <EmptyPanel
          tone="locked"
          icon={<Lock className="h-7 w-7" />}
          title={t("dash.webSupportPro")}
          desc={
            <>
              {t("dash.webPaywallDescPre")}{" "}
              <span className="font-medium text-foreground/80">Pro</span> {t("dash.webPaywallMid")}{" "}
              <span className="font-medium text-foreground/80">Enterprise</span>
              {t("dash.webPaywallDescPost")}
            </>
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button
                size="sm"
                className="gap-1.5 rounded-full"
                onClick={() => onNavigate("purchase")}
              >
                <Crown className="h-3.5 w-3.5" />{t("dash.upgradePlan")}</Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 rounded-full"
                onClick={() => setActiveTab("discord")}
              >
                <MessageSquare className="h-3.5 w-3.5" />{t("dash.useDiscordTickets")}</Button>
            </div>
          }
        />
      )}
      {activeTab === "web" && webEnabled && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("dash.webTicketsManageDesc")}
            </p>
            {!hasOpenWebTicket && !showForm && (
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => setShowForm(true)}
              >
                <Plus className="h-3.5 w-3.5" />{t("dash.newTicket")}</Button>
            )}
          </div>

          {/* New ticket form */}
          {showForm && (
            <form
              onSubmit={handleOpenWebTicket}
              className="rounded-2xl border border-border/50 bg-card/50 px-5 py-4 space-y-3"
              style={{
                animation: "fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) both",
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium">{t("dash.newSupportTicket")}</p>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    setShowForm(false);
                    setFormError(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("dash.subjectLabel")}</label>
                <Input
                  placeholder={t("dash.ticketSubjectPh")}
                  value={formSubject}
                  onChange={(e) => setFormSubject(e.target.value)}
                  className="h-8 text-sm"
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.category")}</label>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        "general",
                        "billing",
                        "technical",
                        "account",
                        "feature",
                      ] as const
                    ).map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFormCategory(cat)}
                        className={[
                          "rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                          formCategory === cat
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-foreground/30",
                        ].join(" ")}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{t("dash.priority")}</label>
                  <div className="flex flex-wrap gap-1">
                    {(["normal", "high", "urgent"] as const).map((pri) => {
                      const cls = {
                        normal:
                          "text-blue-400 border-blue-500/30 bg-blue-500/10",
                        high: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
                        urgent: "text-red-400 border-red-500/30 bg-red-500/10",
                      };
                      return (
                        <button
                          key={pri}
                          type="button"
                          onClick={() => setFormPriority(pri)}
                          className={[
                            "rounded-lg border px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                            formPriority === pri
                              ? cls[pri]
                              : "border-border text-muted-foreground hover:border-foreground/30",
                          ].join(" ")}
                        >
                          {pri}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t("dash.messageOptional")}</label>
                <Textarea
                  placeholder={t("dash.ticketMsgPh")}
                  value={formMessage}
                  onChange={(e) => setFormMessage(e.target.value)}
                  className="min-h-[80px] text-sm resize-none"
                  maxLength={2000}
                />
              </div>
              {formError && <p className="text-xs text-red-400">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setFormError(null);
                  }}
                >{t("dash.cancel")}</Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!formSubject.trim() || formLoading}
                  className="gap-1.5"
                >
                  {formLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {formLoading ? "Submitting��" : t("dash.submitTicket")}
                </Button>
              </div>
            </form>
          )}

          {webTickets.length === 0 && !showForm ? (
            <EmptyPanel
              icon={<Ticket className="h-7 w-7" />}
              title={t("dash.noWebTickets")}
              desc={t("dash.noWebTicketsDesc")}
              action={
                <Button
                  size="sm"
                  className="gap-1.5 rounded-full"
                  onClick={() => setShowForm(true)}
                >
                  <Plus className="h-3.5 w-3.5" />{t("dash.openTicket")}</Button>
              }
            />
          ) : (
            <Panel>
              {webTickets.length > 0 && (
                <>
                  <div className="flex items-center justify-between border-b border-border/40 px-5 py-3.5">
                    <p className="text-sm font-medium">
                      {showWebClosed
                        ? "All Web Tickets"
                        : webOpen.length > 0
                          ? "Open Web Tickets"
                          : t("dash.webTickets")}
                    </p>
                    {webClosed.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowWebClosed((v) => !v)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors duration-200"
                      >
                        {showWebClosed
                          ? "Show open only"
                          : `Show all (${webTickets.length})`}
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-border/30">
                    {(showWebClosed
                      ? webTickets
                      : webOpen.length > 0
                        ? webOpen
                        : webTickets
                    ).map((ticket, i) => (
                      <div
                        key={ticket.id}
                        className="flex items-start justify-between gap-4 px-5 py-4 hover:bg-muted/10 transition-colors duration-150 cursor-pointer"
                        style={{
                          animation: `fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) ${i * 50}ms both`,
                        }}
                        onClick={() => setOpenConversation(ticket)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) =>
                          e.key === "Enter" && setOpenConversation(ticket)
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-muted-foreground/50">
                              #{ticket.id.slice(-6).toUpperCase()}
                            </span>
                            <TicketStatusBadge status={ticket.status} />
                            <TicketPriorityBadge priority={ticket.priority} />
                            <span className="ml-auto text-xs text-muted-foreground/40 capitalize">
                              {ticket.category}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-foreground/90 truncate">
                            {ticket.subject}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground/50">
                            Opened{" "}
                            {new Date(ticket.created_at).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              },
                            )}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-1" />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>
          )}
        </div>
      )}

      {/* Discord Tickets Tab */}
      {activeTab === "discord" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Discord tickets opened with{" "}
            <code className="rounded bg-muted/50 px-1.5 py-0.5 text-xs font-mono">
              /ticket open
            </code>
            . These are read-only in the dashboard.
          </p>

          {discordTickets.length === 0 ? (
            <EmptyPanel
              icon={<Ticket className="h-7 w-7" />}
              title={t("dash.noDiscordTickets")}
              desc={
                <>
                  Use{" "}
                  <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-foreground/70">
                    /ticket open
                  </code>{" "}
                  in Discord to create one.
                </>
              }
            />
          ) : (
            <Panel>
              <PanelHeader
                title={
                  showDiscordClosed
                    ? "All Discord Tickets"
                    : discordOpen.length > 0
                      ? "Open Discord Tickets"
                      : t("dash.discordTickets")
                }
                right={
                  discordClosed.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowDiscordClosed((v) => !v)}
                      className="text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
                    >
                      {showDiscordClosed
                        ? "Show open only"
                        : `Show all (${discordTickets.length})`}
                    </button>
                  ) : undefined
                }
              />
              <div className="divide-y divide-border/30">
                {(showDiscordClosed
                  ? discordTickets
                  : discordOpen.length > 0
                    ? discordOpen
                    : discordTickets
                ).map((ticket, i) => (
                  <div
                    key={ticket.id}
                    className="flex items-start gap-4 px-5 py-4 hover:bg-muted/10 transition-colors duration-150"
                    style={{
                      animation: `fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) ${i * 50}ms both`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground/50">
                          #{ticket.id.slice(-6).toUpperCase()}
                        </span>
                        <TicketStatusBadge status={ticket.status} />
                        <TicketPriorityBadge priority={ticket.priority} />
                        <span className="ml-auto text-xs text-muted-foreground/40 capitalize">
                          {ticket.category}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground/90 truncate">
                        {ticket.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground/50">
                        Opened{" "}
                        {new Date(ticket.created_at).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                        {ticket.channel_id && (
                          <span>
                            {" · "}
                            <a
                              href={`https://discord.com/channels/${process.env.DISCORD_GUILD_ID}/${ticket.channel_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-2 hover:text-foreground/70 transition-colors"
                            >{t("dash.viewInDiscord")}</a>
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Web ticket conversation drawer */}
      {openConversation && (
        <WebTicketConversation
          ticket={openConversation}
          onClose={() => setOpenConversation(null)}
        />
      )}
    </div>
  );
}

function PaymentStatusBadge({ status }: { status: PaymentRow["status"] }) {
  const map: Record<
    PaymentRow["status"],
    { label: string; className: string }
  > = {
    waiting: {
      label: "Waiting",
      className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
    },
    confirming: {
      label: "Confirming",
      className: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    },
    paid: {
      label: "Paid",
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    },
    expired: {
      label: "Expired",
      className: "border-border bg-muted/20 text-muted-foreground",
    },
    failed: {
      label: "Failed",
      className: "border-red-500/30 bg-red-500/10 text-red-400",
    },
  };
  const { label, className } = map[status];
  return (
    <Badge variant="outline" className={`text-xs ${className}`}>
      {label}
    </Badge>
  );
}
