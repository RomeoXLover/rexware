import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser, requireAdmin, getClientIp } from "../auth.server";
import {
  notificationsRepo,
  settingsRepo,
  plansRepo,
  paymentsRepo,
  subscriptionsRepo,
  proxiesRepo,
  trialRepo,
  ticketsRepo,
  usersRepo,
  botsRepo,
  referralCreditsRepo,
  grantReferralReward,
  REFERRAL_RATE,
  newId,
  query,
  queryOne,
  execute,
  type ProxyRow,
  type TicketRow,
  type TicketMessageRow,
  type ReviewRow,
  reviewsRepo,
} from "../repos.server";
import { TOTP_PERIOD, TOTP_DIGITS } from "../totp";
import {
  createPaymentAddress,
  convertUsdToCrypto,
  isCoin,
  type Coin,
} from "../cryptapi.server";
import { getCryptApiConfig } from "../config.server";

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const getNotifications = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return await notificationsRepo.listForUser(user.id, 50);
  },
);

export const getUnreadCount = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return { count: await notificationsRepo.unreadCount(user.id) };
  },
);

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export interface ReferralFriend {
  id: string;
  name: string;
  avatarUrl: string | null;
  joinedAt: number;
}

export interface ReferralCreditEntry {
  id: string;
  amountUsd: number;
  createdAt: number;
}

export interface MyReferral {
  code: string;
  ratePct: number;
  creditUsd: number;
  totalEarned: number;
  friendCount: number;
  friends: ReferralFriend[];
  history: ReferralCreditEntry[];
}

export const getMyReferral = createServerFn({ method: "GET" }).handler(
  async (): Promise<MyReferral> => {
    const user = await requireUser();
    const code = await usersRepo.ensureReferralCode(user.id);
    const [me, friends, history, totalEarned] = await Promise.all([
      usersRepo.byId(user.id),
      usersRepo.referredUsers(user.id),
      referralCreditsRepo.historyForUser(user.id, 20),
      referralCreditsRepo.totalEarned(user.id),
    ]);
    return {
      code,
      ratePct: Math.round(REFERRAL_RATE * 100),
      creditUsd: me?.credit_usd ?? 0,
      totalEarned,
      friendCount: friends.length,
      friends: friends.slice(0, 50).map((f) => ({
        id: f.id,
        name: f.global_name || f.username,
        avatarUrl: f.avatar_url,
        joinedAt: f.created_at,
      })),
      history: history.map((h) => ({
        id: h.id,
        amountUsd: h.amount_usd,
        createdAt: h.created_at,
      })),
    };
  },
);

export const markAllNotificationsRead = createServerFn({
  method: "POST",
}).handler(async () => {
  const user = await requireUser();
  await notificationsRepo.markAllRead(user.id);
  return { ok: true };
});

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await notificationsRepo.markRead(data.id, user.id);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const getSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return await settingsRepo.get(user.id);
  },
);

export const updateSettings = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      notify_payments: z.number().optional(),
      notify_bots: z.number().optional(),
      notify_announcements: z.number().optional(),
      theme: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return await settingsRepo.update(user.id, data);
  });

// ---------------------------------------------------------------------------
// Admin OTP — rotating second factor for critical bot actions.
//
// Returns the admin's own TOTP secret so the browser can render the live,
// rotating 6-digit code locally (smooth countdown, no per-tick round trips).
// Admin-only: requireAdmin throws for everyone else, so the secret is never
// exposed outside the admin's authenticated web session.
// ---------------------------------------------------------------------------

export const getAdminOtp = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ secret: string; period: number; digits: number }> => {
    const admin = await requireAdmin();
    const secret = await usersRepo.getOrCreateAdminOtpSecret(admin.id);
    return { secret, period: TOTP_PERIOD, digits: TOTP_DIGITS };
  },
);

// ---------------------------------------------------------------------------
// Plans & Purchase flow
// ---------------------------------------------------------------------------

export const getPlans = createServerFn({ method: "GET" }).handler(async () => {
  return await plansRepo.allActive();
});

export const getMySubscription = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const active = await subscriptionsRepo.activeForUser(user.id);
    if (!active) return null;
    const plan = await plansRepo.byId(active.plan_id);
    return { subscription: active, plan: plan ?? null };
  },
);

export const getMyPayments = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return await paymentsRepo.listForUser(user.id);
  },
);

export const getMyTickets = createServerFn({ method: "GET" }).handler(
  async (): Promise<TicketRow[]> => {
    const user = await requireUser();
    return await ticketsRepo.byUser(user.id);
  },
);

// ---------------------------------------------------------------------------
// Ticket transcript helper (shared by user + admin transcript endpoints)
// ---------------------------------------------------------------------------

export function buildTicketTranscript(
  ticket: TicketRow,
  messages: TicketMessageRow[],
): { filename: string; content: string } {
  const fmt = (ts: number) =>
    new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const code = ticket.id.slice(-6).toUpperCase();
  const lines: string[] = [];
  lines.push("skyutils — Ticket Transcript");
  lines.push("=".repeat(40));
  lines.push(`Ticket:    #${code} (${ticket.id})`);
  lines.push(`Subject:   ${ticket.subject}`);
  lines.push(`Category:  ${ticket.category}`);
  lines.push(`Priority:  ${ticket.priority}`);
  lines.push(`Status:    ${ticket.status}`);
  lines.push(`Source:    ${ticket.source}`);
  lines.push(`Opened by: ${ticket.discord_user_tag}`);
  lines.push(`Created:   ${fmt(ticket.created_at)}`);
  if (ticket.closed_at) lines.push(`Closed:    ${fmt(ticket.closed_at)}`);
  lines.push("=".repeat(40));
  lines.push("");
  if (messages.length === 0) {
    lines.push("(no messages)");
  } else {
    for (const m of messages) {
      const author = m.is_staff ? `${m.author_tag} [STAFF]` : m.author_tag;
      lines.push(`[${fmt(m.created_at)}] ${author}:`);
      lines.push(m.content);
      lines.push("");
    }
  }
  lines.push("=".repeat(40));
  lines.push(`Generated ${fmt(Date.now())} · ${messages.length} message(s)`);
  return { filename: `transcript-${code}.txt`, content: lines.join("\n") };
}

// Open a web ticket (Pro/Enterprise only)
export const openTicketWeb = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      subject: z.string().min(1).max(200),
      category: z
        .enum(["general", "billing", "technical", "account", "feature"])
        .default("general"),
      priority: z.enum(["normal", "high", "urgent"]).default("normal"),
      message: z.string().max(2000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    // Web support is a Pro/Enterprise perk — enforce on the server too.
    const sub = await subscriptionsRepo.activeForUser(user.id);
    if (!sub || (sub.plan_id !== "pro" && sub.plan_id !== "enterprise")) {
      throw new Error("WEB_SUPPORT_REQUIRES_UPGRADE");
    }
    // One open web ticket at a time per user.
    const existing = (await ticketsRepo.bySource(user.id, "web")).find(
      (t) => t.status !== "closed",
    );
    if (existing) throw new Error("TICKET_ALREADY_OPEN");

    const ticket = await ticketsRepo.createWeb({
      userId: user.id,
      discordUserId: user.id,
      discordUserTag: user.username,
      subject: data.subject,
      category: data.category,
      priority: data.priority,
    });

    // Save opening message if provided
    if (data.message?.trim()) {
      await ticketsRepo.addMessage({
        ticketId: ticket.id,
        authorId: user.id,
        authorTag: user.username,
        content: data.message.trim(),
        isStaff: false,
      });
    }

    return ticket;
  });

// Get messages for a ticket the user owns
export const getTicketMessages = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket || ticket.user_id !== user.id)
      throw new Error("Ticket not found");
    return await ticketsRepo.messages(data.ticketId);
  });

// Build a plain-text transcript of a ticket the user owns
export const getTicketTranscript = createServerFn({ method: "GET" })
  .inputValidator(z.object({ ticketId: z.string() }))
  .handler(async ({ data }): Promise<{ filename: string; content: string }> => {
    const user = await requireUser();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket || ticket.user_id !== user.id)
      throw new Error("Ticket not found");
    const messages = await ticketsRepo.messages(data.ticketId);
    return buildTicketTranscript(ticket, messages);
  });

// Send a message in a web ticket the user owns
export const sendTicketMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ ticketId: z.string(), content: z.string().min(1).max(2000) }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const ticket = await ticketsRepo.byId(data.ticketId);
    if (!ticket || ticket.user_id !== user.id)
      throw new Error("Ticket not found");
    if (ticket.source !== "web")
      throw new Error("Cannot reply to Discord tickets from dashboard");
    if (ticket.status === "closed") throw new Error("Ticket is closed");
    return await ticketsRepo.addMessage({
      ticketId: data.ticketId,
      authorId: user.id,
      authorTag: user.username,
      content: data.content,
      isStaff: false,
    });
  });

export const getMyTrialStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const ip = getClientIp() ?? "unknown";
    return {
      redeemedByAccount: await trialRepo.hasRedeemedByUser(user.id),
      redeemedByIp: await trialRepo.hasRedeemedByIp(ip),
    };
  },
);

export const redeemFreeTrial = createServerFn({ method: "POST" }).handler(
  async () => {
    let user;
    try {
      user = await requireUser();
    } catch (e) {
      throw new Error("You must be signed in to claim the free trial.");
    }
    const ip = getClientIp() ?? "unknown";

    if (await trialRepo.hasRedeemedByUser(user.id)) {
      throw new Error("TRIAL_ALREADY_REDEEMED_ACCOUNT");
    }
    if (ip !== "unknown" && await trialRepo.hasRedeemedByIp(ip)) {
      throw new Error("TRIAL_ALREADY_REDEEMED_IP");
    }

    const plan = await plansRepo.byId("free_trial");
    if (!plan) throw new Error("Trial plan not found");

    // Record redemption first (before any side effects)
    await trialRepo.record(user.id, ip);

    // Create a 12-hour subscription
    const sub = await subscriptionsRepo.create(user.id, plan.id);
    await subscriptionsRepo.activate(sub.id, 12 * 60 * 60 * 1000);

    // Notify the user
    const settings = await settingsRepo.get(user.id);
    if (settings.notify_payments !== 0) {
      await notificationsRepo.create({
        userId: user.id,
        type: "payment",
        title: "Free trial activated",
        body: "Your 12-hour free trial is now active. Enjoy skyutils!",
      });
    }

    return { ok: true };
  },
);

export const initPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      planId: z.string(),
      coin: z.enum(["ltc", "btc"]),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();

    try {
      const plan = await plansRepo.byId(data.planId);
      if (!plan) throw new Error("Plan not found");
      // Prevent purchasing hidden/admin plans or the trial through this endpoint
      if (plan.is_hidden || plan.is_trial)
        throw new Error("This plan cannot be purchased directly");
      if (!isCoin(data.coin)) throw new Error("Invalid coin");

      // Block if user already has a pending payment waiting to be paid
      const existing = await paymentsRepo.pendingForUser(user.id);
      if (existing) {
        throw new Error(`PENDING_INVOICE:${existing.id}`);
      }

      const sub = await subscriptionsRepo.create(user.id, plan.id);
      const payId = newId("pay");

      // Spend any available account credit (e.g. referral rewards) first.
      const balance = await usersRepo.creditBalance(user.id);
      const creditApplied = Math.min(
        Math.round(balance * 100) / 100,
        plan.price_usd,
      );
      const amountDue = Math.round((plan.price_usd - creditApplied) * 100) / 100;
      if (creditApplied > 0) {
        // Reserve the credit now; refunded automatically if the invoice is cancelled.
        await usersRepo.addCredit(user.id, -creditApplied);
      }

      await paymentsRepo.create({
        id: payId,
        userId: user.id,
        planId: plan.id,
        subscriptionId: sub.id,
        coin: data.coin as Coin,
        amountUsd: amountDue,
        creditApplied,
      });

      const userSettings = await settingsRepo.get(user.id);

      // Credit fully covers the price — activate instantly, no crypto needed.
      if (amountDue <= 0) {
        await paymentsRepo.updateStatus(payId, "paid");
        const durationMs =
          plan.interval === "lifetime"
            ? 100 * 365 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000;
        await subscriptionsRepo.activate(sub.id, durationMs);
        // amountDue is 0 here, so no referral reward is earned on credit-only buys.
        await grantReferralReward({ id: payId, user_id: user.id, amount_usd: amountDue });
        if (userSettings.notify_payments !== 0) {
          await notificationsRepo.create({
            userId: user.id,
            type: "success",
            title: "Plan activated",
            body: `Your ${plan.name} plan is now active, paid with account credit.`,
          });
        }
        return {
          paymentId: payId,
          address: "",
          amountCrypto: "0",
          coin: data.coin,
          amountUsd: amountDue,
          planName: plan.name,
          creditApplied,
          fullyCovered: true,
        };
      }

      const config = getCryptApiConfig();
      const baseUrl = config.appBaseUrl || "http://localhost:3000";

      const [address, amountCrypto] = await Promise.all([
        createPaymentAddress({
          coin: data.coin as Coin,
          paymentId: payId,
          baseUrl,
        }),
        convertUsdToCrypto(data.coin as Coin, amountDue),
      ]);

      await paymentsRepo.setAddress(payId, address, amountCrypto);

      // Notifica la creazione dell'invoice (rispetta le preferenze utente)
      if (userSettings.notify_payments !== 0) {
        await notificationsRepo.create({
          userId: user.id,
          type: "payment",
          title: "Invoice created",
          body: `Send ${amountCrypto} ${data.coin.toUpperCase()} to activate your ${plan.name} plan.`,
        });
      }

      return {
        paymentId: payId,
        address,
        amountCrypto,
        coin: data.coin,
        amountUsd: amountDue,
        planName: plan.name,
        creditApplied,
        fullyCovered: false,
      };
    } catch (err) {
      throw err;
    }
  });

// ---------------------------------------------------------------------------
// Extra bot slots — à la carte, $5 each, lifetime. Only paying subscribers
// (active, non-trial, paid plan) may buy them; each slot raises the deployable
// bot cap by one. Granted by the payments webhook on confirmation — never here.
// ---------------------------------------------------------------------------

export const SLOT_PRICE_USD = 5;
const MAX_SLOTS_PER_PURCHASE = 25;

/** A user is eligible to buy slots only with an active, paid (non-trial) plan. */
async function isSlotEligible(userId: string): Promise<boolean> {
  const sub = await subscriptionsRepo.activeForUser(userId);
  if (!sub) return false;
  const plan = await plansRepo.byId(sub.plan_id);
  if (!plan) return false;
  return !plan.is_trial && plan.price_usd > 0;
}

export const getMySlotInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    eligible: boolean;
    extraSlots: number;
    pricePerSlot: number;
  }> => {
    const user = await requireUser();
    const [eligible, extraSlots] = await Promise.all([
      isSlotEligible(user.id),
      usersRepo.extraBotSlots(user.id),
    ]);
    return { eligible, extraSlots, pricePerSlot: SLOT_PRICE_USD };
  },
);

export const initSlotPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      coin: z.enum(["ltc", "btc"]),
      quantity: z.number().int().min(1).max(MAX_SLOTS_PER_PURCHASE),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();

    if (!(await isSlotEligible(user.id))) {
      throw new Error(
        "Extra slots are only available with an active paid subscription.",
      );
    }
    if (!isCoin(data.coin)) throw new Error("Invalid coin");

    // One open invoice at a time (shared with subscription/plugin invoices).
    const existing = await paymentsRepo.pendingForUser(user.id);
    if (existing) {
      throw new Error(`PENDING_INVOICE:${existing.id}`);
    }

    const qty = data.quantity;
    const price = Math.round(SLOT_PRICE_USD * qty * 100) / 100;
    const label =
      qty === 1 ? "1 extra bot slot" : `${qty} extra bot slots`;

    const payId = newId("pay");
    await paymentsRepo.create({
      id: payId,
      userId: user.id,
      kind: "slot",
      coin: data.coin as Coin,
      amountUsd: price,
      slotQty: qty,
    });

    const config = getCryptApiConfig();
    const baseUrl = config.appBaseUrl || "http://localhost:3000";

    const [address, amountCrypto] = await Promise.all([
      createPaymentAddress({
        coin: data.coin as Coin,
        paymentId: payId,
        baseUrl,
      }),
      convertUsdToCrypto(data.coin as Coin, price),
    ]);

    await paymentsRepo.setAddress(payId, address, amountCrypto);

    const settings = await settingsRepo.get(user.id);
    if (settings.notify_payments !== 0) {
      await notificationsRepo.create({
        userId: user.id,
        type: "payment",
        title: "Invoice created",
        body: `Send ${amountCrypto} ${data.coin.toUpperCase()} to unlock ${label}.`,
      });
    }

    return {
      paymentId: payId,
      address,
      amountCrypto,
      coin: data.coin,
      amountUsd: price,
      planName: label,
    };
  });

export const getPaymentStatus = createServerFn({ method: "GET" })
  .inputValidator(z.object({ paymentId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const payment = await paymentsRepo.byIdForUser(data.paymentId, user.id);
    if (!payment) throw new Error("Payment not found");
    return payment;
  });

export const getMyPendingPayment = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return await paymentsRepo.pendingForUser(user.id) ?? null;
  },
);

// Cancel a waiting invoice (only status='waiting', not 'confirming')
export const cancelMyPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({ paymentId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const cancelled = await paymentsRepo.cancelWaiting(data.paymentId, user.id);
    if (!cancelled) {
      throw new Error(
        "Invoice cannot be cancelled. It may already be confirming, paid, or not found.",
      );
    }
    // Notify user
    const settings = await settingsRepo.get(user.id);
    if (settings.notify_payments !== 0) {
      await notificationsRepo.create({
        userId: user.id,
        type: "payment",
        title: "Invoice cancelled",
        body: "Your open invoice has been cancelled.",
      });
    }
    return { ok: true };
  });

export const getMyProxies = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    return await proxiesRepo.forUser(user.id);
  },
);

// Plan-gated: user can add their own proxies if their plan allows it (max_proxies > 0)
export const addMyProxy = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      protocol: z.enum(["http", "socks5"]).default("http"),
      username: z.string().optional(),
      password: z.string().optional(),
      label: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const active = await subscriptionsRepo.activeForUser(user.id);
    if (!active) throw new Error("No active subscription");
    const plan = await plansRepo.byId(active.plan_id);
    const maxProxies = plan?.max_proxies ?? 0;
    if (maxProxies <= 0) throw new Error("Your plan does not support proxies");
    const existing = await proxiesRepo.forUser(user.id);
    if (existing.length >= maxProxies)
      throw new Error(`Proxy limit reached (${maxProxies})`);
    const proxy = await proxiesRepo.create({
      host: data.host,
      port: data.port,
      protocol: data.protocol,
      username: data.username ?? null,
      password: data.password ?? null,
      label: data.label ?? null,
      assignedUserId: user.id,
    });
    return proxy;
  });

// Plan-gated bulk add (one per line: host:port [protocol] [user:pass] [label])
export const addMyProxiesBulk = createServerFn({ method: "POST" })
  .inputValidator(z.object({ lines: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const active = await subscriptionsRepo.activeForUser(user.id);
    if (!active) throw new Error("No active subscription");
    const plan = await plansRepo.byId(active.plan_id);
    const maxProxies = plan?.max_proxies ?? 0;
    if (maxProxies <= 0) throw new Error("Your plan does not support proxies");
    const existing = await proxiesRepo.forUser(user.id);
    const slotsLeft = maxProxies - existing.length;
    if (slotsLeft <= 0) throw new Error(`Proxy limit reached (${maxProxies})`);

    const rawLines = data.lines
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, slotsLeft);

    const results: {
      host: string;
      port: number;
      ok: boolean;
      error?: string;
    }[] = [];
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
          if (part === "http" || part === "socks5") protocol = part;
          else if (part.includes(":")) {
            const [u, p] = part.split(":");
            username = u;
            password = p ?? null;
          } else label = part;
        }
        await proxiesRepo.create({
          host,
          port,
          protocol,
          username,
          password,
          label,
          assignedUserId: user.id,
        });
        results.push({ host, port, ok: true });
      } catch (err) {
        results.push({ host: line, port: 0, ok: false, error: String(err) });
      }
    }
    return { results, slotsLeft };
  });

// ---------------------------------------------------------------------------
// Bot Hours — purchases ($0.50/hr, 20% off at 5h+)
// ---------------------------------------------------------------------------

export const BOT_HOURS_PRICE_PER_HOUR = 0.50;
export const BOT_HOURS_DISCOUNT_THRESHOLD = 5;
export const BOT_HOURS_DISCOUNT_RATE = 0.20; // 20% off

export function botHoursPrice(hours: number): number {
  const rate = hours >= BOT_HOURS_DISCOUNT_THRESHOLD
    ? BOT_HOURS_PRICE_PER_HOUR * (1 - BOT_HOURS_DISCOUNT_RATE)
    : BOT_HOURS_PRICE_PER_HOUR;
  return Math.round(rate * hours * 100) / 100;
}

// Bot hours balance row type
export interface BotHourBalanceRow {
  id: string;
  hours: number;
  hours_used: number;
  expires_at: number;
  source: "purchase" | "key";
}

interface BotHourBalanceResult {
  balances: BotHourBalanceRow[];
  totalAvailable: number;
  pricePerHour: number;
  discountThreshold: number;
  discountRate: number;
}

// Get the user's bot hours balance
export const getMyBotHourBalance = createServerFn({ method: "GET" }).handler(
  async (): Promise<BotHourBalanceResult> => {
    const user = await requireUser();
    const rows = await query<BotHourBalanceRow>(
      `SELECT id, hours, hours_used, expires_at, 'purchase' as source
       FROM bot_hour_balances WHERE user_id = ? ORDER BY expires_at DESC`,
      [user.id],
    );
    const now = Date.now();
    const active = rows.filter((r) => r.hours - r.hours_used > 0 && r.expires_at > now);
    const totalAvailable = active.reduce((s, r) => s + (r.hours - r.hours_used), 0);
    return {
      balances: rows,
      totalAvailable,
      pricePerHour: BOT_HOURS_PRICE_PER_HOUR,
      discountThreshold: BOT_HOURS_DISCOUNT_THRESHOLD,
      discountRate: BOT_HOURS_DISCOUNT_RATE,
    };
  },
);

// Initialize a bot hours payment
export const initBotHoursPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      coin: z.enum(["ltc", "btc"]),
      hours: z.number().min(0.5).max(24),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!isCoin(data.coin)) throw new Error("Invalid coin");

    const existing = await paymentsRepo.pendingForUser(user.id);
    if (existing) throw new Error(`PENDING_INVOICE:${existing.id}`);

    const payId = newId("pay");
    const amountUsd = botHoursPrice(data.hours);

    await paymentsRepo.create({
      id: payId,
      userId: user.id,
      planId: String(data.hours),
      kind: "bot_hours",
      coin: data.coin as Coin,
      amountUsd,
    });

    // Get a payment address for this invoice
    const config = getCryptApiConfig();
    const baseUrl = config.appBaseUrl || "http://localhost:3000";

    const [address, amountCrypto] = await Promise.all([
      createPaymentAddress({ coin: data.coin as Coin, paymentId: payId, baseUrl }),
      convertUsdToCrypto(data.coin as Coin, amountUsd),
    ]);

    await paymentsRepo.setAddress(payId, address ?? "", amountCrypto ?? "0");

    return {
      paymentId: payId,
      address: address ?? "",
      amountCrypto: amountCrypto ?? "0",
      coin: data.coin,
      amountUsd,
      planName: `${data.hours} Bot Hours`,
    };
  });

// Redeem a bot hours key
export const redeemBotHourKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(1).max(50) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const code = data.code.trim().toUpperCase();

    const key = await queryOne<{
      id: string;
      type: string;
      plan_id: string | null;
      redeemed_by: string | null;
      redeemed_at: number | null;
    }>(`SELECT * FROM redeem_keys WHERE code = ?`, [code]);

    if (!key) throw new Error("Invalid key");
    if (key.redeemed_by) throw new Error("Key already redeemed");
    if (key.type !== "bot_hours") throw new Error("This key is not a bot hours key");

    // Parse hours from plan_id (stored as hours amount)
    const hours = parseFloat(key.plan_id ?? "0");
    if (!hours || hours <= 0) throw new Error("Invalid bot hours key");

    // Mark key redeemed
    await execute(
      `UPDATE redeem_keys SET redeemed_by = ?, redeemed_at = ? WHERE id = ?`,
      [user.id, Date.now(), key.id],
    );

    // Add balance
    const balId = newId("bhbal");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h expiry
    await execute(
      `INSERT INTO bot_hour_balances (id, user_id, hours, hours_used, expires_at, source)
       VALUES (?, ?, ?, 0, ?, 'key')`,
      [balId, user.id, hours, expiresAt],
    );

    return { hours, expiresAt };
  });

// ---------------------------------------------------------------------------
// Overview stats for dashboard
// ---------------------------------------------------------------------------

export const getMyOverviewStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    onlineBots: number;
    offlineBots: number;
    totalBots: number;
    weeklyHistory: { date: string; online: number }[];
  }> => {
    const user = await requireUser();

    // Count running bots (status in pending/starting/running)
    const activeRuns = await query<{ bot_id: string }>(
      `SELECT bot_id FROM bot_runs WHERE user_id = ? AND status IN ('pending','starting','running')`,
      [user.id],
    );
    const totalBots = await botsRepo.countForUser(user.id);
    const onlineBots = activeRuns.length;
    const offlineBots = Math.max(0, totalBots - onlineBots);

    // Weekly history — synthetic (last 7 days)
    const weeklyHistory: { date: string; online: number }[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      // Simulate history with decaying pattern
      const base = Math.max(0, onlineBots - (6 - i));
      weeklyHistory.push({ date: dateStr, online: base });
    }
    // Today always shows actual count
    if (weeklyHistory.length > 0) {
      weeklyHistory[weeklyHistory.length - 1].online = onlineBots;
    }

    return { onlineBots, offlineBots, totalBots, weeklyHistory };
  },
);

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface ApprovedReview {
  id: string;
  discordTag: string;
  stars: number;
  feedback: string;
  createdAt: number;
  starsDisplay: string;
}

export const getApprovedReviews = createServerFn({ method: "GET" }).handler(
  async (): Promise<ApprovedReview[]> => {
    const reviews = await reviewsRepo.approved();
    return reviews.map((r: ReviewRow) => {
      const filled = Math.max(1, Math.min(5, Math.round(r.stars)));
      const starsDisplay = "★".repeat(filled) + "☆".repeat(5 - filled);
      return {
        id: r.id,
        discordTag: r.discord_tag,
        stars: r.stars,
        feedback: r.feedback,
        createdAt: r.created_at,
        starsDisplay,
      };
    });
  },
);