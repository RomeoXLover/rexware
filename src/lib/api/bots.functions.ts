import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth.server";
import {
  botsRepo,
  botRunsRepo,
  subscriptionsRepo,
  plansRepo,
  notificationsRepo,
  settingsRepo,
  proxiesRepo,
  usersRepo,
  type BotRow,
  type BotRunRow,
  type ProxyRow,
} from "../repos.server";
import {
  startBotContainer,
  stopAndRemoveContainer,
  isDockerAvailable,
  getContainerState,
  DockerUnavailableError,
} from "../docker.server";

// ---------------------------------------------------------------------------
// Bots — deployable Minecraft accounts (one container per running bot).
//
// Each bot is a saved account + server target. Starting a bot persists a
// `bot_runs` row, builds the Rust `Config` JSON, and launches a container from
// the bot image with that config injected via `BOT_CONFIG_JSON`. The live
// console is streamed straight from `docker logs --follow` (see
// /api/runner/stream) — nothing is persisted, so it's a true real-time feed.
// When Docker is unreachable (hosted preview) the run stays `pending`.
// ---------------------------------------------------------------------------

const MC_VERSIONS = [
  "1.21.4",
  "1.21.1",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.18.2",
  "1.16.5",
  "1.12.2",
  "1.8.9",
] as const;

const botInputSchema = z.object({
  name: z.string().min(1).max(40),
  // The in-game username is auto-detected from the authenticated profile
  // (Microsoft / SSID), so it's optional. It only matters for offline (cracked)
  // mode, where it IS the in-game name.
  mcUsername: z.string().max(40).optional(),
  serverHost: z.string().min(1).max(120),
  serverPort: z.number().int().min(1).max(65535).default(25565),
  mcVersion: z.enum(MC_VERSIONS).default("1.21.1"),
  authMode: z.enum(["offline", "microsoft", "ssid"]).default("offline"),
  // I token MSA/Minecraft sono JWT lunghi: lo ssid reale supera spesso 1000
  // caratteri, quindi teniamo limiti larghi (solo anti-abuso, non funzionali).
  accessToken: z.string().max(8192).optional(),
  ssid: z.string().max(8192).optional(),
  uuid: z.string().max(64).optional(),
  proxy: z.string().max(200).optional(),

  // --- Behaviour config.
  message: z.string().max(256).optional(),
  reply: z.array(z.string().max(256)).max(20).optional(),
  replyActions: z.array(z.string().max(256)).max(20).optional(),
  triggerKeyword: z.string().max(64).optional(),
  webhookUrl: z.string().max(300).optional(),
  messageInterval: z.number().int().min(1).max(3600).optional(),
  replyDelay: z.number().int().min(0).max(600).optional(),
  replyCooldown: z.number().int().min(0).max(3600).optional(),
  afkInterval: z.number().int().min(1).max(3600).optional(),
  reconnectDelay: z.number().int().min(1).max(3600).optional(),
  inactivityTimeout: z.number().int().min(0).max(86400).optional(),
});

export const BOT_MC_VERSIONS = MC_VERSIONS;

// --- Helpers ----------------------------------------------------------------

/**
 * Resolve the user's bot cap from their active plan (-1 = unlimited, 0 = none),
 * plus any à-la-carte extra bot slots they've purchased (lifetime). Slots only
 * raise a finite cap — an unlimited plan stays unlimited, and no plan = no bots.
 */
async function maxBotsForUser(userId: string): Promise<number> {
  const sub = await subscriptionsRepo.activeForUser(userId);
  if (!sub) return 0;
  const plan = await plansRepo.byId(sub.plan_id);
  const base = plan?.max_bots ?? 0;
  if (base === -1) return -1; // unlimited — extra slots are irrelevant
  if (base === 0) return 0; // plan grants no bots at all
  const extra = await usersRepo.extraBotSlots(userId);
  return base + extra;
}

/** Resolve the user's daily bot-hours cap from their plan (-1 = unlimited). */
export async function dailyHoursForUser(userId: string): Promise<number> {
  const sub = await subscriptionsRepo.activeForUser(userId);
  if (!sub) return 0;
  const plan = await plansRepo.byId(sub.plan_id);
  return plan?.bot_hours ?? -1;
}

const ACTIVE_RUN_STATUSES = new Set(["pending", "starting", "running"]);

/**
 * Enforce the plan's daily bot-hours cap for a user. If they've hit the limit,
 * any still-running bots are force-stopped (containers removed) and a single
 * notification is created. Safe to call on every poll — it no-ops when the user
 * is under the limit or has nothing running. Returns whether any run was stopped
 * and whether the limit is currently reached.
 */
export async function enforceDailyHoursLimit(
  userId: string,
): Promise<{ limitReached: boolean; stopped: number }> {
  const limitHours = await dailyHoursForUser(userId);
  if (limitHours < 0) return { limitReached: false, stopped: 0 }; // unlimited

  const usedMs = await botRunsRepo.usedMsToday(userId);
  if (usedMs < limitHours * 3_600_000) {
    return { limitReached: false, stopped: 0 };
  }

  // Over budget: tear down every active run for this user.
  const latest = await botRunsRepo.latestForUser(userId);
  const active = Object.values(latest).filter((r) =>
    ACTIVE_RUN_STATUSES.has(r.status),
  );
  if (active.length === 0) return { limitReached: true, stopped: 0 };

  const dockerUp = await isDockerAvailable();
  let stopped = 0;
  for (const run of active) {
    if (run.container_id && dockerUp) {
      try {
        await stopAndRemoveContainer(run.container_id);
      } catch {
        // best-effort
      }
    }
    await botRunsRepo.setStatus(run.id, "stopped");
    stopped++;
  }

  // Tell the user why their bots were shut down (best-effort, respects prefs).
  try {
    const settings = await settingsRepo.get(userId);
    if (settings.notify_bots !== 0) {
      await notificationsRepo.create({
        userId,
        type: "bot",
        title: "Bots stopped — daily limit reached",
        body: `Your ${limitHours} daily bot-hour(s) ran out, so ${stopped} running bot(s) were stopped. The limit resets at midnight UTC.`,
      });
    }
  } catch {
    // best-effort
  }

  return { limitReached: true, stopped };
}

/** Format a stored proxy row into a `protocol://user:pass@host:port` URL. */
function formatProxyUrl(p: ProxyRow): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@`
    : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

/** Pick a random proxy from a pool. Throws if the pool is empty. */
function randomProxy(pool: ProxyRow[]): string {
  if (pool.length === 0) throw new Error("No proxies available in pool");
  return formatProxyUrl(pool[Math.floor(Math.random() * pool.length)]);
}

/**
 * Resolve which proxy a bot must use. Returns an empty string when no proxy
 * is available, letting the bot fall back to a direct connection — proxy is
 * optional.
 * Priority: bot's own explicit proxy → user's custom proxies → system pool.
 */
async function resolveBotProxy(bot: BotRow): Promise<string> {
  if (bot.proxy && bot.proxy.trim()) return bot.proxy.trim();
  const custom = await proxiesRepo.forUser(bot.user_id);
  if (custom.length > 0) return randomProxy(custom);
  const system = await proxiesRepo.systemPool();
  if (system.length > 0) return randomProxy(system);
  return "";
}

/** Safely parse the stored reply_actions JSON column into a string[]. */
function parseReplyActions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Safely parse the stored messages JSON column into a string[]. */
function parseMessages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Build the Rust bot `Config` JSON from a stored bot row (single account). */
function buildBotConfig(bot: BotRow, resolvedProxy: string): string {
  const account: Record<string, unknown> = {
    // For Microsoft/SSID this is only used as the MSA cache key — the real
    // in-game name is detected from the authenticated profile (see
    // bot/src/main.rs + bot/src/auth.rs). When the user didn't type a username
    // we fall back to the bot id so the auth cache still has a stable key.
    // For offline (cracked) mode this IS the in-game name.
    username: bot.mc_username && bot.mc_username.trim() ? bot.mc_username : bot.id,
    // `your_username` (the in-game name) is intentionally NOT sent: the Rust bot
    // detects it automatically from the authenticated profile (MSA/SSID).
    auth_mode: bot.auth_mode,
  };
  if (resolvedProxy) {
    account.proxy = resolvedProxy;
  }
  if (bot.access_token) account.access_token = bot.access_token;
  if (bot.uuid) account.uuid = bot.uuid;
  if (bot.ssid) account.ssid = bot.ssid;

  const config: Record<string, unknown> = {
    host: bot.server_host,
    port: bot.server_port,
    version: bot.mc_version,
    auth_mode: bot.auth_mode,
    accounts: [account],
    // Persist the MSA/login cache on the shared state volume (mounted at
    // /app/state, see docker.server.ts) so the bot does NOT have to log in again
    // on every restart. Namespaced per bot to avoid cross-container write races.
    auth_cache: `/app/state/auth_${bot.id}.json`,
  };
  if (resolvedProxy) {
    config.proxy = resolvedProxy;
  }

  // Only send fields the user actually set; otherwise Rust serde applies its
  // own default (see bot/src/config.rs), so we never overwrite with blanks.
  if (bot.message) config.message = bot.message;
  // `reply` is stored as a JSON array in the DB; Rust expects a plain String
  // so we send just the first reply (legacy single-reply behaviour).
  if (bot.reply) {
    const replyArr =
      typeof bot.reply === "string" && bot.reply.startsWith("[")
        ? parseMessages(bot.reply)
        : typeof bot.reply === "string"
          ? [bot.reply]
          : bot.reply;
    if (Array.isArray(replyArr) && replyArr.length > 0) {
      config.reply = String(replyArr[0]);
    }
  }
  // Parse the stored JSON array of reply-action templates (best-effort).
  const actions = parseReplyActions(bot.reply_actions);
  if (actions.length > 0) config.reply_actions = actions;
  if (bot.trigger_keyword) config.trigger_keyword = bot.trigger_keyword;
  if (bot.webhook_url) config.webhook_url = bot.webhook_url;
  if (bot.message_interval != null) config.message_interval = bot.message_interval;
  if (bot.reply_delay != null) config.reply_delay = bot.reply_delay;
  if (bot.reply_cooldown != null) config.reply_cooldown = bot.reply_cooldown;
  if (bot.afk_interval != null) config.afk_interval = bot.afk_interval;
  if (bot.reconnect_delay != null) config.reconnect_delay = bot.reconnect_delay;
  // Rust field is `inattivita_timeout` (legacy name) — map our column to it.
  if (bot.inactivity_timeout != null)
    config.inattivita_timeout = bot.inactivity_timeout;

  return JSON.stringify(config);
}

/**
 * Reconcile a run the DB thinks is alive against its real container, clearing
 * crashed/vanished runs so they stop blocking restarts. Returns whether the
 * run is genuinely still alive.
 */
async function reconcileRun(run: BotRunRow): Promise<boolean> {
  if (!run.container_id) {
    const ageMs = Date.now() - run.created_at;
    if (ageMs > 2 * 60 * 1000) {
      await botRunsRepo.setStatus(run.id, "error", {
        error: "Run never started a container (timed out).",
      });
      return false;
    }
    return true;
  }
  const state = await getContainerState(run.container_id);
  if (state === "running") return true;
  if (state === "unknown") return true;
  await botRunsRepo.setStatus(run.id, "stopped");
  if (state === "stopped") {
    try {
      await stopAndRemoveContainer(run.container_id);
    } catch {
      // best-effort
    }
  }
  return false;
}

export function publicBot(bot: BotRow) {
  return {
    id: bot.id,
    name: bot.name,
    mcUsername: bot.mc_username,
    serverHost: bot.server_host,
    serverPort: bot.server_port,
    mcVersion: bot.mc_version,
    authMode: bot.auth_mode,
    hasAccessToken: !!bot.access_token,
    hasSsid: !!bot.ssid,
    uuid: bot.uuid,
    proxy: bot.proxy,
    message: bot.message,
    reply: bot.reply
      ? (() => {
          const v = typeof bot.reply === "string" ? bot.reply : "";
          if (v.startsWith("[")) {
            const parsed = parseMessages(v);
            return parsed.length > 0 ? parsed : v ? [v] : [];
          }
          return v ? [v] : [];
        })()
      : [],
    replyActions: parseReplyActions(bot.reply_actions),
    triggerKeyword: bot.trigger_keyword ?? null,
    webhookUrl: bot.webhook_url,
    messageInterval: bot.message_interval,
    replyDelay: bot.reply_delay,
    replyCooldown: bot.reply_cooldown,
    afkInterval: bot.afk_interval,
    reconnectDelay: bot.reconnect_delay,
    inactivityTimeout: bot.inactivity_timeout,
    createdAt: bot.created_at,
    updatedAt: bot.updated_at,
  };
}

export type PublicBot = ReturnType<typeof publicBot>;

// --- Queries ----------------------------------------------------------------

export const getMyBots = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();

  // Enforce the daily bot-hours cap first: this force-stops any bots that have
  // outrun the limit, so the list/usage we return below is already accurate.
  const enforcement = await enforceDailyHoursLimit(user.id);

  const [bots, runs, maxBots, hoursLimit, usedMsToday, dockerAvailable] =
    await Promise.all([
      botsRepo.forUser(user.id),
      botRunsRepo.latestForUser(user.id),
      maxBotsForUser(user.id),
      dailyHoursForUser(user.id),
      botRunsRepo.usedMsToday(user.id),
      isDockerAvailable(),
    ]);
  return {
    maxBots,
    dockerAvailable,
    // Daily bot-hours budget (-1 = unlimited) and how many hours have already
    // been consumed today, so the client can warn when the limit is hit.
    hoursLimit,
    hoursUsedToday: Math.round((usedMsToday / 3_600_000) * 100) / 100,
    // True when the daily limit is currently reached; `hoursJustStopped` counts
    // bots that were force-stopped on this request so the UI can explain it.
    hoursLimitReached: enforcement.limitReached,
    hoursJustStopped: enforcement.stopped,
    bots: bots.map((b) => ({
      ...publicBot(b),
      run: runs[b.id] ?? null,
    })),
  };
});

/** Lightweight usage stats — no bot list, safe to poll frequently on the dashboard. */
export const getMyUsage = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const enforcement = await enforceDailyHoursLimit(user.id);
  const [hoursLimit, usedMsToday] = await Promise.all([
    dailyHoursForUser(user.id),
    botRunsRepo.usedMsToday(user.id),
  ]);
  return {
    hoursLimit,
    hoursUsedToday: Math.round((usedMsToday / 3_600_000) * 100) / 100,
    hoursLimitReached: enforcement.limitReached,
  };
});

// --- Mutations --------------------------------------------------------------

export const createBot = createServerFn({ method: "POST" })
  .inputValidator(botInputSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const maxBots = await maxBotsForUser(user.id);
    if (maxBots === 0) {
      throw new Error("Your plan does not include any bots. Upgrade to deploy bots.");
    }
    if (maxBots !== -1) {
      const count = await botsRepo.countForUser(user.id);
      if (count >= maxBots) {
        throw new Error(
          `You've reached your plan's limit of ${maxBots} bot(s). Upgrade for more.`,
        );
      }
    }
    const bot = await botsRepo.create({
      userId: user.id,
      name: data.name,
      mcUsername: data.mcUsername?.trim() || "",
      serverHost: data.serverHost,
      serverPort: data.serverPort,
      mcVersion: data.mcVersion,
      authMode: data.authMode,
      accessToken: data.accessToken || null,
      ssid: data.ssid || null,
      uuid: data.uuid || null,
      proxy: data.proxy || null,
      message: data.message || null,
      reply:
        data.reply && data.reply.length > 0
          ? JSON.stringify(data.reply.map((s: string) => s.trim()).filter(Boolean))
          : null,
      replyActions:
        data.replyActions && data.replyActions.length > 0
          ? JSON.stringify(data.replyActions.map((s) => s.trim()).filter(Boolean))
          : null,
      triggerKeyword: data.triggerKeyword || null,
      webhookUrl: data.webhookUrl || null,
      messageInterval: data.messageInterval ?? null,
      replyDelay: data.replyDelay ?? null,
      replyCooldown: data.replyCooldown ?? null,
      afkInterval: data.afkInterval ?? null,
      reconnectDelay: data.reconnectDelay ?? null,
      inactivityTimeout: data.inactivityTimeout ?? null,
    });
    return { ok: true, bot: publicBot(bot) };
  });

export const updateBot = createServerFn({ method: "POST" })
  .inputValidator(botInputSchema.extend({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const updated = await botsRepo.update(data.id, user.id, {
      name: data.name,
      mc_username: data.mcUsername?.trim() || "",
      server_host: data.serverHost,
      server_port: data.serverPort,
      mc_version: data.mcVersion,
      auth_mode: data.authMode,
      // Secrets are never sent back to the client, so an empty field on edit
      // means "keep the stored value" (undefined), not "clear it" (null).
      access_token: data.accessToken ? data.accessToken : undefined,
      ssid: data.ssid ? data.ssid : undefined,
      uuid: data.uuid || null,
      proxy: data.proxy || null,
      message: data.message || null,
      reply:
        data.reply && data.reply.length > 0
          ? JSON.stringify(data.reply.map((s: string) => s.trim()).filter(Boolean))
          : null,
      reply_actions:
        data.replyActions && data.replyActions.length > 0
          ? JSON.stringify(data.replyActions.map((s) => s.trim()).filter(Boolean))
          : null,
      trigger_keyword: data.triggerKeyword || null,
      webhook_url: data.webhookUrl || null,
      message_interval: data.messageInterval ?? null,
      reply_delay: data.replyDelay ?? null,
      reply_cooldown: data.replyCooldown ?? null,
      afk_interval: data.afkInterval ?? null,
      reconnect_delay: data.reconnectDelay ?? null,
      inactivity_timeout: data.inactivityTimeout ?? null,
    });
    if (!updated) throw new Error("Bot not found");
    return { ok: true, bot: publicBot(updated) };
  });

export const deleteBot = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const bot = await botsRepo.byIdForUser(data.id, user.id);
    if (!bot) throw new Error("Bot not found");

    // Stop a live run + clean up its container before deleting the bot.
    const active = await botRunsRepo.activeForBot(bot.id);
    if (active?.container_id && (await isDockerAvailable())) {
      try {
        await stopAndRemoveContainer(active.container_id);
      } catch {
        // best-effort
      }
    }
    if (active) await botRunsRepo.setStatus(active.id, "stopped");
    await botsRepo.delete(bot.id, user.id);
    return { ok: true };
  });

// --- Run lifecycle ----------------------------------------------------------

export const startBot = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; run: BotRunRow; dockerAvailable: boolean }> => {
      const user = await requireUser();
      const bot = await botsRepo.byIdForUser(data.id, user.id);
      if (!bot) throw new Error("Bot not found");

      // Block double-launch, but reconcile a stale "active" run first.
      const existing = await botRunsRepo.activeForBot(bot.id);
      if (existing) {
        const stillAlive = await reconcileRun(existing);
        if (stillAlive) {
          throw new Error("This bot is already running. Stop it first.");
        }
      }

      // Enforce the plan's daily bot-hours limit (-1 = unlimited).
      const limitHours = await dailyHoursForUser(user.id);
      if (limitHours >= 0) {
        const usedMs = await botRunsRepo.usedMsToday(user.id);
        const limitMs = limitHours * 3_600_000;
        if (usedMs >= limitMs) {
          throw new Error(
            `You've used your plan's daily limit of ${limitHours} bot-hour(s). It resets at midnight UTC.`,
          );
        }
      }

      let run: BotRunRow | undefined;
      try {
        run = await botRunsRepo.create({ botId: bot.id, userId: user.id });
        const resolvedProxy = await resolveBotProxy(bot);
        const configJson = buildBotConfig(bot, resolvedProxy);
        const containerId = await startBotContainer({
          runId: run.id,
          userId: user.id,
          botId: bot.id,
          configJson,
        });
        await botRunsRepo.setStatus(run.id, "starting", { containerId });
        run = (await botRunsRepo.byId(run.id)) ?? run;

        const settings = await settingsRepo.get(user.id);
        if (settings.notify_bots !== 0) {
          await notificationsRepo.create({
            userId: user.id,
            type: "bot",
            title: "Bot started",
            body: `"${bot.name}" is starting in a container.`,
          });
        }
        return { ok: true, run, dockerAvailable: true };
      } catch (err) {
        if (err instanceof DockerUnavailableError) {
          return { ok: true, run: run!, dockerAvailable: false };
        }
        const message =
          err instanceof Error ? err.message : "Failed to start container";
        if (run) await botRunsRepo.setStatus(run.id, "error", { error: message });
        throw new Error(message);
      }
    },
  );

export const stopBot = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const bot = await botsRepo.byIdForUser(data.id, user.id);
    if (!bot) throw new Error("Bot not found");

    const active = await botRunsRepo.activeForBot(bot.id);
    if (!active) return { ok: true };

    if (active.container_id && (await isDockerAvailable())) {
      try {
        await stopAndRemoveContainer(active.container_id);
      } catch {
        // best-effort
      }
    }
    await botRunsRepo.setStatus(active.id, "stopped");
    return { ok: true };
  });

export const getBotRunStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const bot = await botsRepo.byIdForUser(data.id, user.id);
    if (!bot) throw new Error("Bot not found");
    const run = await botRunsRepo.latestForBot(bot.id);
    return { run: run ?? null };
  });
