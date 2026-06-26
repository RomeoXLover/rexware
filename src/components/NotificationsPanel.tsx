import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, BellOff, Check, CreditCard, Bot, Megaphone, Info } from "lucide-react";
import type { NotificationRow } from "@/lib/repos.server";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/dashboard.functions";
import { useT } from "@/lib/preferences";

function iconForType(type: string) {
  switch (type) {
    case "payment":
      return <CreditCard className="h-4 w-4 text-green-400" />;
    case "bot":
      return <Bot className="h-4 w-4 text-blue-400" />;
    case "announcement":
      return <Megaphone className="h-4 w-4 text-yellow-400" />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatRelative(
  ts: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return t("notif.justNow");
  const m = Math.floor(s / 60);
  if (m < 60) return t("notif.minutesAgo", { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("notif.hoursAgo", { h });
  const d = Math.floor(h / 24);
  return t("notif.daysAgo", { d });
}

interface NotificationsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: NotificationRow[];
  onUpdate: (updated: NotificationRow[]) => void;
}

export function NotificationsPanel({
  open,
  onOpenChange,
  notifications,
  onUpdate,
}: NotificationsPanelProps) {
  const t = useT();
  const [marking, setMarking] = useState(false);
  const unread = notifications.filter((n) => n.read === 0).length;

  async function handleMarkAll() {
    setMarking(true);
    try {
      await markAllNotificationsRead();
      onUpdate(notifications.map((n) => ({ ...n, read: 1 })));
    } finally {
      setMarking(false);
    }
  }

  async function handleMarkOne(id: string) {
    await markNotificationRead({ data: { id } });
    onUpdate(
      notifications.map((n) => (n.id === id ? { ...n, read: 1 } : n)),
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-sm border-l border-border/60 bg-card p-0"
      >
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <SheetTitle className="text-base">{t("notif.title")}</SheetTitle>
            {unread > 0 && (
              <Badge className="h-5 min-w-5 rounded-full px-1.5 text-xs">
                {unread}
              </Badge>
            )}
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleMarkAll}
              disabled={marking}
            >
              <Check className="mr-1 h-3 w-3" />
              {t("notif.markAll")}
            </Button>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-73px)]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <BellOff className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {t("notif.empty")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={() => handleMarkOne(n.id)}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function NotificationItem({
  notification: n,
  onMarkRead,
}: {
  notification: NotificationRow;
  onMarkRead: () => void;
}) {
  const t = useT();
  return (
    <div
      className={[
        "flex gap-3 px-5 py-4 transition-colors",
        n.read === 0 ? "bg-muted/20" : "opacity-60",
      ].join(" ")}
    >
      <div className="mt-0.5 shrink-0">{iconForType(n.type)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-snug">{n.title}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelative(n.created_at, t)}
          </span>
        </div>
        {n.body && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {n.body}
          </p>
        )}
        {n.read === 0 && (
          <button
            type="button"
            className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={onMarkRead}
          >
            {t("notif.markRead")}
          </button>
        )}
      </div>
      {n.read === 0 && (
        <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </div>
  );
}
