import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin, requireUser } from "../auth.server";
import {
  usersRepo,
  paymentsRepo,
  subscriptionsRepo,
  plansRepo,
  auditRepo,
  bannedIpsRepo,
  userIpsRepo,
  proxiesRepo,
  botsRepo,
  botRunsRepo,
  warnsRepo,
  notesRepo,
  ticketsRepo,
  notificationsRepo,
  settingsRepo,
  dmQueueRepo,
  botSettingsRepo,
  type UserRow,
  type PaymentRow,
  type PlanRow,
  type SubscriptionRow,
  type ProxyRow,
  type UserWarnRow,
  type UserNoteRow,
  type TicketRow,
  type TicketMessageRow,
} from "../repos.server";
import {
  getDockerInfo,
  listProjectContainers,
  type ContainerSummary,
} from "../docker.server";

// ---------------------------------------------------------------------------
// Staff-level server functions. These require either admin status (DB flag)
// OR ownership (owner IDs from config). Use requireStaff() for these handlers.
// ---------------------------------------------------------------------------

/**
 * Staff-level auth: requires either admin (DB flag) OR owner status.
 * Use this for all admin functions that should be accessible by owners too.
 */
export async function requireStaff(): Promise<UserRow> {
  const user = await requireUser();
  if (!user.is_admin && !user.is_owner) throw new Error("FORBIDDEN");
  return user;
}

export const adminGetUsers = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    return await usersRepo.all();
  },
);

export const adminSetAdmin = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), isAdmin: z.boolean() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await usersRepo.setAdmin(data.userId, data.isAdmin);
    await auditRepo.log({
      actorId: actor.id,
      action: data.isAdmin ? "grant_admin" : "revoke_admin",
      targetId: data.userId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminSetBanned = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), banned: z.boolean() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await usersRepo.setBanned(data.userId, data.banned);
    await auditRepo.log({
      actorId: actor.id,
      action: data.banned ? "ban_user" : "unban_user",
      targetId: data.userId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminSetBeta = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), beta: z.boolean() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await usersRepo.setBeta(data.userId, data.beta);
    await auditRepo.log({
      actorId: actor.id,
      action: data.beta ? "grant_beta" : "revoke_beta",
      targetId: data.userId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminGetUserIps = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    await requireStaff();
    return await userIpsRepo.forUser(data.userId);
  });

// ---------------------------------------------------------------------------
// Alt detection — other accounts that have logged in from one of the same IPs
// as the target user. Returns one entry per alt account with the list of
// shared IPs and the most recent time they were seen on a shared IP.
// ---------------------------------------------------------------------------

export interface AdminUserAlt {
  id: string;
  username: string;
  global_name: string | null;
  avatar_url: string | null;
  is_admin: number;
  is_banned: number;
  sharedIps: string[];
  lastSeen: number;
}

export const adminGetUserAlts = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }): Promise<AdminUserAlt[]> => {
    await requireStaff();
    const { query } = await import("../db.server");
    const rows = (await query(
      `SELECT u.id, u.username, u.global_name, u.avatar_url, u.is_admin, u.is_banned,
              oi.ip AS ip, oi.last_seen AS last_seen
         FROM user_ips mi
         JOIN user_ips oi ON oi.ip = mi.ip AND oi.user_id <> mi.user_id
         JOIN users u ON u.id = oi.user_id
        WHERE mi.user_id = ?
        ORDER BY oi.last_seen DESC`,
      [data.userId],
    )) as {
      id: string;
      username: string;
      global_name: string | null;
      avatar_url: string | null;
      is_admin: number;
      is_banned: number;
      ip: string;
      last_seen: number;
    }[];

    const map = new Map<string, AdminUserAlt>();
    for (const r of rows) {
      const existing = map.get(r.id);
      if (existing) {
        if (!existing.sharedIps.includes(r.ip)) existing.sharedIps.push(r.ip);
        existing.lastSeen = Math.max(existing.lastSeen, r.last_seen);
      } else {
        map.set(r.id, {
          id: r.id,
          username: r.username,
          global_name: r.global_name,
          avatar_url: r.avatar_url,
          is_admin: r.is_admin,
          is_banned: r.is_banned,
          sharedIps: [r.ip],
          lastSeen: r.last_seen,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  });

export const adminGetStats = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    const totalUsers = await usersRepo.count();
    const totalRevenue = await paymentsRepo.totalRevenueUsd();
    const activeSubscriptions = await subscriptionsRepo.activeCount();
    const recentPayments = await paymentsRepo.recent(20);
    const auditLog = await auditRepo.recent(30);

    return {
      totalUsers,
      totalRevenue,
      activeSubscriptions,
      recentPayments,
      auditLog,
    };
  },
);

export const adminGetAuditLog = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    return await auditRepo.recent(100);
  },
);

// ---------------------------------------------------------------------------
// Broadcast a notification (announcement) to all users
// ---------------------------------------------------------------------------

export const adminBroadcastNotification = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      title: z.string().min(1).max(120),
      body: z.string().max(500).optional(),
      onlyActiveSubs: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const allUsers = await usersRepo.all();
    let sent = 0;
    for (const u of allUsers) {
      if (u.is_banned === 1) continue;
      if (data.onlyActiveSubs && !await subscriptionsRepo.activeForUser(u.id)) continue;
      const settings = await settingsRepo.get(u.id);
      if (settings.notify_announcements === 0) continue;
      await notificationsRepo.create({
        userId: u.id,
        type: "announcement",
        title: data.title,
        body: data.body,
      });
      sent += 1;
    }
    await auditRepo.log({
      actorId: actor.id,
      action: "broadcast_notification",
      detail: `${sent} recipients · ${data.title}`,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true, sent };
  });

// ---------------------------------------------------------------------------
// Discord DM broadcast — queues a DM to every user with a discord_id.
// The bot worker drains dm_queue and delivers the DM via Discord API.
// ---------------------------------------------------------------------------

export const adminBroadcastDiscordDm = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      title: z.string().min(1).max(120),
      body: z.string().max(1500).optional(),
      url: z.string().url().optional(),
      onlyActiveSubs: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const allUsers = await usersRepo.all();
    let queued = 0;
    for (const u of allUsers) {
      if (u.is_banned === 1) continue;
      if (!u.id) continue; // needs discord_id (user.id is discord snowflake)
      if (data.onlyActiveSubs && !await subscriptionsRepo.activeForUser(u.id)) continue;
      await dmQueueRepo.enqueue({
        discordId: u.id,
        title: data.title,
        body: data.body ?? "",
        url: data.url,
      });
      queued += 1;
    }
    await auditRepo.log({
      actorId: actor.id,
      action: "broadcast_discord_dm",
      detail: `${queued} queued · ${data.title}`,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true, queued };
  });

// ---------------------------------------------------------------------------
// Maintenance mode (global, stored in bot_settings key-value)
// ---------------------------------------------------------------------------

export const adminGetMaintenance = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean; message: string; full: boolean }> => {
    await requireStaff();
    return {
      enabled: await botSettingsRepo.get("maintenance_mode") === "1",
      full: await botSettingsRepo.get("maintenance_full") === "1",
      message:
        await botSettingsRepo.get("maintenance_message") ??
        "We're performing scheduled maintenance. Please check back soon.",
    };
  },
);

export const adminSetMaintenance = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      enabled: z.boolean(),
      message: z.string().max(500).optional(),
      full: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await botSettingsRepo.set("maintenance_mode", data.enabled ? "1" : "0");
    if (data.full !== undefined) {
      await botSettingsRepo.set("maintenance_full", data.full ? "1" : "0");
    }
    if (data.message !== undefined) {
      await botSettingsRepo.set("maintenance_message", data.message);
    }
    await auditRepo.log({
      actorId: actor.id,
      action: data.enabled ? "maintenance_on" : "maintenance_off",
      detail: `${data.full ? "full lockdown · " : ""}${data.message?.slice(0, 100) ?? ""}`,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Anti-VPN protection (global, stored in bot_settings key-value)
// ---------------------------------------------------------------------------

export const adminGetVpnSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    enabled: boolean;
    blockHosting: boolean;
    allowlist: string;
  }> => {
    await requireStaff();
    return {
      enabled: (await botSettingsRepo.get("vpn_block")) === "1",
      blockHosting: (await botSettingsRepo.get("vpn_block_hosting")) === "1",
      allowlist: (await botSettingsRepo.get("vpn_allowlist")) ?? "",
    };
  },
);

export const adminSetVpnSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      enabled: z.boolean(),
      blockHosting: z.boolean().optional(),
      allowlist: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await botSettingsRepo.set("vpn_block", data.enabled ? "1" : "0");
    if (data.blockHosting !== undefined) {
      await botSettingsRepo.set("vpn_block_hosting", data.blockHosting ? "1" : "0");
    }
    if (data.allowlist !== undefined) {
      await botSettingsRepo.set("vpn_allowlist", data.allowlist.trim());
    }
    await auditRepo.log({
      actorId: actor.id,
      action: data.enabled ? "vpn_block_on" : "vpn_block_off",
      detail: data.blockHosting ? "hosting blocked" : "",
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminGetBannedIps = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    return await bannedIpsRepo.all();
  },
);

export const adminBanIp = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ ip: z.string().min(1), reason: z.string().optional() }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await bannedIpsRepo.ban(data.ip, actor.id, data.reason);
    await auditRepo.log({
      actorId: actor.id,
      action: "ban_ip",
      detail: data.ip,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminUnbanIp = createServerFn({ method: "POST" })
  .inputValidator(z.object({ ip: z.string().min(1) }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await bannedIpsRepo.unban(data.ip);
    await auditRepo.log({
      actorId: actor.id,
      action: "unban_ip",
      detail: data.ip,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// All payments with joined user info (paginated)
// ---------------------------------------------------------------------------

export const adminGetAllPayments = createServerFn({ method: "GET" })
  .inputValidator(z.object({ page: z.number().min(0).default(0) }))
  .handler(async ({ data }) => {
    await requireStaff();
    const { query, queryOne } = await import("../db.server");
    const limit = 50;
    const offset = data.page * limit;
    const rows = (await query(
      `SELECT p.*, u.username, u.global_name, u.avatar_url
         FROM payments p
         LEFT JOIN users u ON p.user_id = u.id
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
      [limit, offset],
    )) as (PaymentRow & {
      username: string | null;
      global_name: string | null;
      avatar_url: string | null;
    })[];
    const total = (
      (await queryOne<{ c: number }>("SELECT COUNT(*) AS c FROM payments"))!
    ).c;
    return { rows, total, page: data.page, limit };
  });

// ---------------------------------------------------------------------------
// Subscription management per utente
// ---------------------------------------------------------------------------

export const adminGetUserSubscriptions = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    await requireStaff();
    const subs = await subscriptionsRepo.listForUser(data.userId);
    const { query } = await import("../db.server");
    const plans = (await query("SELECT * FROM plans")) as PlanRow[];
    const planMap = Object.fromEntries(plans.map((p) => [p.id, p]));
    return subs.map((s) => ({ ...s, plan: planMap[s.plan_id] ?? null }));
  });

export const adminCancelSubscription = createServerFn({ method: "POST" })
  .inputValidator(z.object({ subscriptionId: z.string(), userId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const { execute } = await import("../db.server");
    await execute(
      `UPDATE subscriptions SET status = 'canceled' WHERE id = ? AND user_id = ?`,
      [data.subscriptionId, data.userId],
    );
    await auditRepo.log({
      actorId: actor.id,
      action: "cancel_subscription",
      targetId: data.userId,
      detail: data.subscriptionId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminActivateSubscription = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      subscriptionId: z.string(),
      userId: z.string(),
      durationDays: z.number().min(1).default(30),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const { execute } = await import("../db.server");
    const start = Date.now();
    const expires = start + data.durationDays * 24 * 60 * 60 * 1000;
    await execute(
      `UPDATE subscriptions SET status = 'active', started_at = ?, expires_at = ? WHERE id = ? AND user_id = ?`,
      [start, expires, data.subscriptionId, data.userId],
    );
    await auditRepo.log({
      actorId: actor.id,
      action: "activate_subscription",
      targetId: data.userId,
      detail: `${data.subscriptionId} for ${data.durationDays}d`,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Gift subscription to a user (creates a new sub + activates it)
// ---------------------------------------------------------------------------

export const adminGiftSubscription = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      userId: z.string(),
      planId: z.string(),
      durationDays: z.number().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const { execute } = await import("../db.server");
    const { newId, notificationsRepo, settingsRepo, plansRepo } = await import("../repos.server");
    const id = newId("sub");
    const start = Date.now();
    const expires = start + data.durationDays * 24 * 60 * 60 * 1000;
    await execute(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, started_at, expires_at, created_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [id, data.userId, data.planId, start, expires, start],
    );
    await auditRepo.log({
      actorId: actor.id,
      action: "gift_subscription",
      targetId: data.userId,
      detail: `plan=${data.planId} days=${data.durationDays}`,
      isOwner: !!(actor?.is_owner),
    });

    // Send notification to the gifted user
    const settings = await settingsRepo.get(data.userId);
    const plan = await plansRepo.byId(data.planId);
    if (settings.notify_payments !== 0) {
      const planName = plan?.name ?? data.planId;
      const duration =
        data.durationDays === 1
          ? "1 day"
          : data.durationDays % 365 === 0
            ? `${data.durationDays / 365} year${data.durationDays / 365 > 1 ? "s" : ""}`
            : data.durationDays % 30 === 0
              ? `${data.durationDays / 30} month${data.durationDays / 30 > 1 ? "s" : ""}`
              : `${data.durationDays} days`;
      await notificationsRepo.create({
        userId: data.userId,
        type: "gift",
        title: "Subscription gifted!",
        body: `You received a ${planName} subscription for ${duration}.`,
      });
    }

    return { ok: true, subscriptionId: id };
  });

// ---------------------------------------------------------------------------
// Cancel a payment (admin — can cancel waiting OR confirming)
// ---------------------------------------------------------------------------

export const adminCancelPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ paymentId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const cancelled = await paymentsRepo.adminCancel(data.paymentId);
    if (!cancelled) throw new Error("Payment cannot be cancelled (not waiting/confirming or not found)");
    await auditRepo.log({
      actorId: actor.id,
      action: "cancel_payment",
      detail: data.paymentId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Proxy management (shared pool)
// ---------------------------------------------------------------------------

export const adminGetAllProxies = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    return await proxiesRepo.all();
  },
);

export const adminCreateProxy = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      username: z.string().optional(),
      password: z.string().optional(),
      protocol: z.enum(["http", "socks5"]).default("http"),
      label: z.string().optional(),
      assignedUserId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const proxy = await proxiesRepo.create({
      host: data.host,
      port: data.port,
      username: data.username ?? null,
      password: data.password ?? null,
      protocol: data.protocol,
      label: data.label ?? null,
      assignedUserId: data.assignedUserId ?? null,
    });
    await auditRepo.log({
      actorId: actor.id,
      action: "create_proxy",
      detail: `${data.host}:${data.port}`,
      isOwner: !!(actor?.is_owner),
    });
    return proxy;
  });

export const adminAssignProxy = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ proxyId: z.string(), userId: z.string().nullable() }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await proxiesRepo.assign(data.proxyId, data.userId);
    await auditRepo.log({
      actorId: actor.id,
      action: "assign_proxy",
      detail: `proxy=${data.proxyId} -> user=${data.userId ?? "unassigned"}`,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminDeleteProxy = createServerFn({ method: "POST" })
  .inputValidator(z.object({ proxyId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await proxiesRepo.delete(data.proxyId);
    await auditRepo.log({
      actorId: actor.id,
      action: "delete_proxy",
      detail: data.proxyId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// Bulk-create proxies from a multi-line text block.
// Each line: host:port [protocol] [username:password] [label]
// e.g. "1.2.3.4:8080 http user:pass MyProxy"
//      "5.6.7.8:1080 socks5"
export const adminBulkCreateProxies = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      lines: z.string().min(1),
      assignedUserId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const results: { host: string; port: number; ok: boolean; error?: string }[] = [];
    const rawLines = data.lines
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of rawLines) {
      try {
        const parts = line.split(/\s+/);
        const [hostPort, ...rest] = parts;
        const colonIdx = hostPort.lastIndexOf(":");
        const host = hostPort.slice(0, colonIdx);
        const port = parseInt(hostPort.slice(colonIdx + 1));
        if (!host || isNaN(port)) throw new Error("Invalid host:port");

        let protocol: "http" | "socks5" = "http";
        let username: string | null = null;
        let password: string | null = null;
        let label: string | null = null;

        for (const part of rest) {
          if (part === "http" || part === "socks5") {
            protocol = part;
          } else if (part.includes(":")) {
            const [u, p] = part.split(":");
            username = u;
            password = p ?? null;
          } else {
            label = part;
          }
        }

        await proxiesRepo.create({
          host,
          port,
          protocol,
          username,
          password,
          label,
          assignedUserId: data.assignedUserId ?? null,
        });
        results.push({ host, port, ok: true });
      } catch (err) {
        results.push({ host: line, port: 0, ok: false, error: String(err) });
      }
    }

    await auditRepo.log({
      actorId: actor.id,
      action: "bulk_create_proxies",
      detail: `${results.filter((r) => r.ok).length}/${rawLines.length} created`,
      isOwner: !!(actor?.is_owner),
    });
    return { results };
  });

// ---------------------------------------------------------------------------
// Tickets (admin view)
// ---------------------------------------------------------------------------

export interface TicketStats {
  open_tickets: number;
  in_progress_tickets: number;
  closed_today: number;
  avg_response_time: number; // minutes, 0 if no data
  total_tickets: number;
  by_priority: {
    low: number;
    normal: number;
    high: number;
    urgent: number;
  };
  by_source: {
    web: number;
    discord: number;
  };
}

export const adminGetTicketStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<TicketStats> => {
    await requireStaff();
    const { query } = await import("../db.server");

    const [openRows, inProgressRows, closedTodayRows, totalRows, priorityRows, sourceRows] =
      await Promise.all([
        ticketsRepo.all("open"),
        ticketsRepo.all("in_progress"),
        query<{ c: number }>(
          `SELECT COUNT(*) AS c FROM tickets WHERE status = 'closed' AND closed_at >= ?`,
          [new Date().setHours(0, 0, 0, 0)],
        ),
        ticketsRepo.all(),
        query<{ priority: string; c: number }[]>(
          `SELECT priority, COUNT(*) AS c FROM tickets GROUP BY priority`,
          [],
        ),
        query<{ source: string; c: number }[]>(
          `SELECT source, COUNT(*) AS c FROM tickets GROUP BY source`,
          [],
        ),
      ]);

    const priorityCounts = { low: 0, normal: 0, high: 0, urgent: 0 };
    for (const r of priorityRows) {
      if (r.priority in priorityCounts) {
        priorityCounts[r.priority as keyof typeof priorityCounts] = r.c;
      }
    }

    const sourceCounts = { web: 0, discord: 0 };
    for (const r of sourceRows) {
      if (r.source === "web" || r.source === "discord") {
        sourceCounts[r.source as keyof typeof sourceCounts] = r.c;
      }
    }

    // Mock avg response time — calculate from ticket_messages if available
    // For now, return a plausible mock value
    const avg_response_time = 0; // Real implementation would query ticket_messages for staff response times

    return {
      open_tickets: openRows.length,
      in_progress_tickets: inProgressRows.length,
      closed_today: (closedTodayRows[0] as { c: number })?.c ?? 0,
      avg_response_time,
      total_tickets: totalRows.length,
      by_priority: priorityCounts,
      by_source: sourceCounts,
    };
  },
);

export const adminGetAllTickets = createServerFn({ method: "GET" })
  .inputValidator(z.object({ status: z.enum(["open", "in_progress", "closed"]).optional() }))
  .handler(async ({ data }): Promise<TicketRow[]> => {
    await requireStaff();
    return await ticketsRepo.all(data.status);
  });

// All tickets with joined user info + staff reply indicator
export const adminGetAllTicketsWithUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<(TicketRow & { username: string | null; global_name: string | null; avatar_url: string | null; has_staff_reply: boolean })[]> => {
    await requireStaff();
    const { query } = await import("../db.server");

    const tickets = (await query(
      `SELECT t.*, u.username, u.global_name, u.avatar_url
         FROM tickets t
         LEFT JOIN users u ON t.user_id = u.id
         ORDER BY t.created_at DESC
         LIMIT 500`,
    )) as (TicketRow & { username: string | null; global_name: string | null; avatar_url: string | null })[];

    // Check which tickets have staff replies
    const ids = tickets.map((t) => t.id);
    if (ids.length === 0) return tickets.map((t) => ({ ...t, has_staff_reply: false }));

    const placeholders = ids.map(() => "?").join(", ");
    const messages = (await query(
      `SELECT DISTINCT ticket_id FROM ticket_messages WHERE ticket_id IN (${placeholders}) AND is_staff = 1`,
      ids,
    )) as { ticket_id: string }[];

    const repliedIds = new Set(messages.map((m) => m.ticket_id));
    return tickets.map((t) => ({ ...t, has_staff_reply: repliedIds.has(t.id) }));
  },
);

// Get all messages for a ticket (admin)
export const adminGetTicketMessages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }): Promise<TicketMessageRow[]> => {
    await requireStaff();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    return await ticketsRepo.messages(data.ticketId);
  });

// Build a plain-text transcript for a ticket (admin)
export const adminGetTicketTranscript = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }): Promise<{ filename: string; content: string }> => {
    await requireStaff();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    const messages = await ticketsRepo.messages(data.ticketId);
    const { buildTicketTranscript } = await import("./dashboard.functions");
    return buildTicketTranscript(ticket, messages);
  });

// Admin replies to a web ticket and optionally notifies user via DM (bot does the DM)
export const adminReplyTicket = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      ticketId: z.string(),
      content: z.string().min(1).max(2000),
      notifyUser: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");
    if (ticket.status === "closed") throw new Error("Ticket is closed");

    // Save the reply message
    const msg = await ticketsRepo.addMessage({
      ticketId: data.ticketId,
      authorId: actor.id,
      authorTag: "Staff",
      content: data.content,
      isStaff: true,
    });

    // Move to in_progress if still open
    if (ticket.status === "open") {
      await ticketsRepo.setStatus(data.ticketId, "in_progress");
    }

    // Notify user in dashboard notifications
    const userSettings = await settingsRepo.get(ticket.user_id);
    if (userSettings.notify_announcements !== 0) {
      await notificationsRepo.create({
        userId: ticket.user_id,
        type: "ticket",
        title: "Staff replied to your ticket",
        body: `Ticket #${data.ticketId.slice(-6).toUpperCase()}: ${data.content.slice(0, 80)}${data.content.length > 80 ? "…" : ""}`,
      });
    }

    await auditRepo.log({ actorId: actor.id, action: "ticket_reply", targetId: data.ticketId, isOwner: !!(actor?.is_owner) });

    // If requested, enqueue a Discord DM. The bot drains dm_queue and delivers it.
    if (data.notifyUser) {
      const ticketCode = `#${data.ticketId.slice(-6).toUpperCase()}`;
      const baseUrl = process.env.APP_BASE_URL ?? "";
      await dmQueueRepo.enqueue({
        discordId: ticket.discord_user_id || ticket.user_id,
        title: `Reply on ticket ${ticketCode}`,
        body: `A staff member replied to your premium ticket **${ticket.subject}**:\n\n> ${data.content.slice(0, 1500)}\n\nOpen your dashboard to view and respond.`,
        url: baseUrl ? `${baseUrl}/dash?ticket=${data.ticketId}` : undefined,
      });
    }

    return { ok: true, messageId: msg.id, notifyUser: data.notifyUser };
  });

export const adminUpdateTicket = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      ticketId: z.string(),
      action: z.enum(["close", "claim", "set_priority", "reopen"]),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket) throw new Error("Ticket not found");

    if (data.action === "close") {
      await ticketsRepo.setStatus(data.ticketId, "closed", actor.id);
    } else if (data.action === "reopen") {
      await ticketsRepo.setStatus(data.ticketId, "open");
    } else if (data.action === "claim") {
      await ticketsRepo.claim(data.ticketId, actor.id);
    } else if (data.action === "set_priority" && data.priority) {
      await ticketsRepo.setPriority(data.ticketId, data.priority);
    }

    await auditRepo.log({ actorId: actor.id, action: `ticket_${data.action}`, targetId: data.ticketId, isOwner: !!(actor?.is_owner) });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// All subscriptions with joined user + plan info
// ---------------------------------------------------------------------------

export const adminGetAllSubscriptions = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaff();
    const { query } = await import("../db.server");
    const rows = (await query(
      `SELECT s.*, u.username, u.global_name, u.avatar_url, p.name AS plan_name
         FROM subscriptions s
         LEFT JOIN users u ON s.user_id = u.id
         LEFT JOIN plans p ON s.plan_id = p.id
         ORDER BY s.created_at DESC
         LIMIT 500`,
    )) as (SubscriptionRow & {
      username: string | null;
      global_name: string | null;
      avatar_url: string | null;
      plan_name: string | null;
    })[];
    return rows;
  },
);

// ---------------------------------------------------------------------------
// Per-user "mod view" — a single aggregated snapshot of everything an admin
// needs to moderate one user: subscription, daily usage vs. plan limits, live
// docker containers, proxies, warns, notes and the audit trail targeting them.
// ---------------------------------------------------------------------------

export interface AdminUserDetail {
  user: UserRow;
  subscription: (SubscriptionRow & { plan: PlanRow | null }) | null;
  subscriptions: (SubscriptionRow & { plan: PlanRow | null })[];
  plan: PlanRow | null;
  usage: {
    botsActive: number;
    botsTotal: number;
    maxBots: number; // -1 = unlimited, 0 = none
    hoursUsedToday: number;
    maxHoursPerDay: number; // -1 = unlimited
    proxiesUsed: number;
    maxProxies: number; // -1 = unlimited
  };
  containers: ContainerSummary[];
  proxies: ProxyRow[];
  warns: UserWarnRow[];
  notes: UserNoteRow[];
  ipCount: number;
  audit: {
    id: string;
    actor_id: string;
    action: string;
    target_id: string | null;
    detail: string | null;
    created_at: number;
  }[];
}

export const adminGetUserDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }): Promise<AdminUserDetail> => {
    await requireStaff();
    const { query } = await import("../db.server");

    const user = await usersRepo.byId(data.userId);
    if (!user) throw new Error("User not found");

    const [
      activeSub,
      allSubs,
      bots,
      activeRuns,
      hoursUsedMs,
      proxies,
      warns,
      notes,
      ips,
      audit,
    ] = await Promise.all([
      subscriptionsRepo.activeForUser(data.userId),
      subscriptionsRepo.listForUser(data.userId),
      botsRepo.forUser(data.userId),
      botRunsRepo.latestForUser(data.userId),
      botRunsRepo.usedMsToday(data.userId),
      proxiesRepo.forUser(data.userId),
      warnsRepo.byUser(data.userId),
      notesRepo.byUser(data.userId),
      userIpsRepo.forUser(data.userId),
      query(
        "SELECT * FROM admin_audit WHERE target_id = ? ORDER BY created_at DESC LIMIT 30",
        [data.userId],
      ) as Promise<AdminUserDetail["audit"]>,
    ]);

    // Resolve plans for the whole subscription list in one pass.
    const planRows = (await query("SELECT * FROM plans")) as PlanRow[];
    const planMap = Object.fromEntries(planRows.map((p) => [p.id, p]));
    const withPlan = (s: SubscriptionRow) => ({ ...s, plan: planMap[s.plan_id] ?? null });
    const plan = activeSub ? planMap[activeSub.plan_id] ?? null : null;

    // Live docker containers belonging to this user (best-effort).
    let containers: ContainerSummary[] = [];
    let dockerAvailable = false;
    try {
      const info = await getDockerInfo();
      if (info.available) {
        dockerAvailable = true;
        containers = (await listProjectContainers()).filter(
          (c) => c.userId === data.userId,
        );
      }
    } catch {
      containers = [];
    }

    // Active bots: when Docker is reachable, the running containers are the
    // source of truth (the run-status table can be stale). Otherwise fall back
    // to the recorded run statuses.
    const botsActive = dockerAvailable
      ? containers.filter((c) => c.state === "running").length
      : Object.values(activeRuns).filter((r) =>
          ["pending", "starting", "running"].includes(r.status),
        ).length;

    return {
      user,
      subscription: activeSub ? withPlan(activeSub) : null,
      subscriptions: allSubs.map(withPlan),
      plan,
      usage: {
        botsActive,
        botsTotal: bots.length,
        maxBots: plan?.max_bots ?? 0,
        hoursUsedToday: Math.round((hoursUsedMs / 3_600_000) * 100) / 100,
        maxHoursPerDay: plan?.bot_hours ?? -1,
        proxiesUsed: proxies.length,
        maxProxies: plan?.max_proxies ?? 0,
      },
      containers,
      proxies,
      warns,
      notes,
      ipCount: ips.length,
      audit,
    };
  });

// ---------------------------------------------------------------------------
// Mod actions — warns & notes (surfaced in the per-user mod view)
// ---------------------------------------------------------------------------

export const adminAddWarn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), reason: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const warn = await warnsRepo.add({
      userId: data.userId,
      issuedBy: actor.id,
      reason: data.reason,
    });
    await auditRepo.log({
      actorId: actor.id,
      action: "warn_user",
      targetId: data.userId,
      detail: data.reason.slice(0, 100),
      isOwner: !!(actor?.is_owner),
    });
    return warn;
  });

export const adminRemoveWarn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ warnId: z.string(), userId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await warnsRepo.remove(data.warnId);
    await auditRepo.log({
      actorId: actor.id,
      action: "remove_warn",
      targetId: data.userId,
      detail: data.warnId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

export const adminAddNote = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string(), content: z.string().min(1).max(1000) }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    const note = await notesRepo.add({
      userId: data.userId,
      authorId: actor.id,
      content: data.content,
    });
    await auditRepo.log({
      actorId: actor.id,
      action: "add_note",
      targetId: data.userId,
      isOwner: !!(actor?.is_owner),
    });
    return note;
  });

export const adminRemoveNote = createServerFn({ method: "POST" })
  .inputValidator(z.object({ noteId: z.string(), userId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await notesRepo.remove(data.noteId);
    await auditRepo.log({
      actorId: actor.id,
      action: "remove_note",
      targetId: data.userId,
      detail: data.noteId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Hard delete — permanently erase all data for a user account.
// Only staff (admin OR owner) may call this.
// ---------------------------------------------------------------------------

export const adminDeleteUserData = createServerFn({ method: "POST" })
  .inputValidator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireStaff();
    await usersRepo.hardDelete(data.userId);
    await auditRepo.log({
      actorId: actor.id,
      action: "hard_delete_user",
      targetId: data.userId,
      isOwner: !!(actor?.is_owner),
    });
    return { ok: true };
  });
