import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth.server";
import {
  pluginsRepo,
  paymentsRepo,
  notificationsRepo,
  settingsRepo,
  botSettingsRepo,
  newId,
  type PluginRunRow,
} from "../repos.server";
import {
  createPaymentAddress,
  convertUsdToCrypto,
  isCoin,
  type Coin,
} from "../cryptapi.server";
import { getCryptApiConfig } from "../config.server";
import {
  startPluginContainer,
  stopAndRemoveContainer,
  isDockerAvailable,
  getContainerState,
  DockerUnavailableError,
  } from "../docker.server";

// ---------------------------------------------------------------------------
// Plugins (Discord Spam / Discord Auto-Reply)
//
// Docker orchestration: `runPlugin` persists a `plugin_runs` row, then launches
// a dedicated container from the bot image (one container per run). The
// container reports its lifecycle back via /api/runner/callback. When no Docker
// engine is reachable (e.g. the hosted preview) the run stays `pending` and we
// surface `dockerAvailable: false` to the UI instead of failing.
// ---------------------------------------------------------------------------

export const PLUGIN_IDS = ["discord-spam", "discord-autoreply", "discord-guild-chat"] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

// Per-plugin lifetime price (USD).
export const PLUGIN_PRICE_USD: Record<PluginId, number> = {
  "discord-spam": 10,
  "discord-autoreply": 6.5,
  "discord-guild-chat": 8,
};

// All plugins are live and purchasable.
export const PLUGIN_AVAILABLE: Record<PluginId, boolean> = {
  "discord-spam": true,
  "discord-autoreply": true,
  "discord-guild-chat": true,
};

// Human-friendly plugin names, reused across payments + notifications.
export const PLUGIN_LABEL: Record<PluginId, string> = {
  "discord-spam": "Discord Spam",
  "discord-autoreply": "Discord Auto-Reply",
  "discord-guild-chat": "Guild Chat",
};

const pluginIdSchema = z.enum(PLUGIN_IDS);

// --- Config schemas ---------------------------------------------------------
// Kept permissive (strings for tokens/ids) so the UI can save partial drafts.

// Shared AI-reply block (Groq). When enabled the runner generates a reply with
// an LLM instead of sending the static template. Falls back to the static text
// on any error so a run never stalls.
const aiReplySchema = {
  aiEnabled: z.boolean().default(false),
  aiApiKey: z.string().default(""),
  aiModel: z.string().default("llama-3.3-70b-versatile"),
  aiPrompt: z
    .string()
    .default(
      "You are a friendly Discord user. Reply casually and briefly to the message.",
    ),
};

// Shared safety / notification block.
const sharedExtrasSchema = {
  // Words that, if present in an incoming DM, cause the bot to skip replying.
  blockedWords: z.array(z.string()).default([]),
  // User IDs that are never DMed or auto-replied to.
  blacklistUserIds: z.array(z.string()).default([]),
  // A distinct first-contact message (e.g. for new friends) — sent once.
  firstMessage: z.string().default(""),
  // Discord webhook used for ban/timeout alerts and (optionally) DM logging.
  webhookUrl: z.string().default(""),
  notifyOnBan: z.boolean().default(false),
  logDms: z.boolean().default(false),
  // Custom status text set on the account after login.
  customStatus: z.string().default(""),
};

const spamConfigSchema = z.object({
  tokens: z.array(z.string()).default([]),
  channelId: z.string().default(""),
  // Multi-channel: each entry spams its own channel; falls back to channelId
  // for backwards compatibility when empty.
  channels: z
    .array(
      z.object({
        channelId: z.string().default(""),
        intervalMinutes: z.number().min(0.05).default(0.5),
      }),
    )
    .default([]),
  intervalMinutes: z.number().min(0.05).default(0.5),
  messages: z.array(z.string()).default([]),
  replaceMode: z.boolean().default(false),
  maxSendFailures: z.number().min(1).default(3),
  autoDelete: z.boolean().default(true),
  autoDeleteSeconds: z.number().min(1).default(20),
  proxy: z.string().default(""),
  // Bot mode: "dm" = channel spam + auto-reply, "friend" = accept incoming
  // friend requests (captcha-aware) then DM them.
  mode: z.enum(["dm", "friend"]).default("dm"),
  // Auto-reply to incoming DMs.
  autoReplyEnabled: z.boolean().default(false),
  autoReply: z.string().default(""),
  autoReplyLines: z.array(z.string()).default([]),
  autoReplyLinesRandom: z.boolean().default(true),
  dmDelaySeconds: z.number().min(0).default(20),
  maxConcurrentReplies: z.number().min(1).default(10),
  // Smart-send: only post when at least `minOnline` members are online.
  smartSend: z.boolean().default(false),
  minOnline: z.number().min(0).default(5),
  // Scheduled one-off messages: { time: "HH:MM" (UTC), message }.
  schedule: z
    .array(z.object({ time: z.string().default(""), message: z.string().default("") }))
    .default([]),
  // One-time mass DM blast fired once at startup.
  massDmEnabled: z.boolean().default(false),
  massDmUserIds: z.array(z.string()).default([]),
  massDmMessage: z.string().default(""),
  ...aiReplySchema,
  ...sharedExtrasSchema,
});

// Auto-Reply plugin: no spam loop. The user picks a mode (DM vs Friend) and an
// auto-reply message; the bot only replies to incoming DMs.
const autoReplyConfigSchema = z.object({
  tokens: z.array(z.string()).default([]),
  // "dm" = just auto-reply to anyone who DMs; "friend" = also accept incoming
  // friend requests, then auto-reply once they message.
  mode: z.enum(["dm", "friend"]).default("dm"),
  autoReply: z.string().default(""),
  autoReplyLines: z.array(z.string()).default([]),
  autoReplyLinesRandom: z.boolean().default(true),
  dmDelaySeconds: z.number().min(0).default(20),
  maxConcurrentReplies: z.number().min(1).default(10),
  friendAcceptDelay: z.number().min(0).default(12),
  group1Count: z.number().min(0).default(0),
  singleReply: z.boolean().default(false),
  friendOneAtATime: z.boolean().default(false),
  proxy: z.string().default(""),
  ...aiReplySchema,
  ...sharedExtrasSchema,
});

// Guild Chat: bridges a Discord guild channel with the SkyUtils dashboard in real time.
// The bot token lives in the server-side env; no token from the user is needed.
// The server auto-creates a webhook when the user selects a channel.
const guildChatConfigSchema = z.object({
  guildId: z.string().default(""),
  channelId: z.string().default(""),
});

function validateConfig(pluginId: PluginId, raw: unknown) {
  if (pluginId === "discord-spam") return spamConfigSchema.parse(raw);
  if (pluginId === "discord-autoreply") {
    const parsed = autoReplyConfigSchema.parse(raw);
    // The whole plugin IS auto-reply, so force the flag on for the runner.
    return { ...parsed, autoReplyEnabled: true };
  }
  if (pluginId === "discord-guild-chat") return guildChatConfigSchema.parse(raw);
  throw new Error("Unknown plugin.");
}

/**
 * Reconcile a run the DB still considers active against its real container.
 * If the container has crashed, exited, or vanished, mark the run stopped/error
 * (and clean up any leftover container) so it stops blocking new runs.
 *
 * Returns `true` if the run is genuinely still alive (caller should block),
 * `false` if it was reconciled away (caller may proceed).
 */
async function reconcileRun(run: PluginRunRow): Promise<boolean> {
  // No container recorded yet (still 'pending'): if it never got a container
  // and is stale, clear it; otherwise treat as alive to avoid double-launch.
  if (!run.container_id) {
    const ageMs = Date.now() - run.created_at;
    // A pending run older than 2 minutes never actually launched.
    if (ageMs > 2 * 60 * 1000) {
      await pluginsRepo.setRunStatus(run.id, "error", {
        error: "Run never started a container (timed out).",
      });
      return false;
    }
    return true;
  }

  const state = await getContainerState(run.container_id);
  if (state === "running") return true;
  // Docker unreachable — don't destroy DB state on a transient failure.
  if (state === "unknown") return true;

  // Container exited or is gone: mark stopped and best-effort clean up.
  await pluginsRepo.setRunStatus(run.id, "stopped");
  if (state === "stopped") {
    try {
      await stopAndRemoveContainer(run.container_id);
    } catch {
      // already gone / best-effort
    }
  }
  return false;
}

// --- Queries ----------------------------------------------------------------

/** Returns purchase + config + active-run state for every plugin for this user. */
export const getMyPlugins = createServerFn({ method: "GET" }).handler(
  async () => {
    const user = await requireUser();
    const purchased = await pluginsRepo.purchasedIds(user.id);
    return Promise.all(
      PLUGIN_IDS.map(async (id) => {
        const cfg = await pluginsRepo.getConfig(user.id, id);
        // Prefer a live run; otherwise fall back to the most recent run so the
        // UI can keep showing its final status (stopped/error) instead of
        // snapping back to "idle".
        const active = await pluginsRepo.activeRun(user.id, id);
        const display = active ?? (await pluginsRepo.latestRun(user.id, id));
        return {
          pluginId: id,
          purchased: purchased.includes(id),
          // Raw JSON string (or null). Parsed on the client — keeps the payload
          // strictly serializable for the server-function boundary.
          configJson: cfg ? cfg.config : null,
          activeRun: display ?? null,
        };
      }),
    );
  },
);

// --- Purchase (real crypto payment, same flow as subscriptions) -------------

/**
 * Creates a crypto invoice (CryptAPI) for a lifetime plugin purchase.
 * The plugin is only granted by the payments webhook on confirmation — never
 * here. Mirrors `initPayment` for plans.
 */
export const initPluginPayment = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      pluginId: pluginIdSchema,
      coin: z.enum(["ltc", "btc"]),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();

    if (!PLUGIN_AVAILABLE[data.pluginId]) {
      throw new Error("This plugin is coming soon and cannot be purchased yet.");
    }
    if (await pluginsRepo.isPurchased(user.id, data.pluginId)) {
      throw new Error("You already own this plugin.");
    }
    if (!isCoin(data.coin)) throw new Error("Invalid coin");

    // One open invoice at a time (shared with subscription invoices).
    const existing = await paymentsRepo.pendingForUser(user.id);
    if (existing) {
      throw new Error(`PENDING_INVOICE:${existing.id}`);
    }

    const price = PLUGIN_PRICE_USD[data.pluginId];
    const label = PLUGIN_LABEL[data.pluginId];

    const payId = newId("pay");
    await paymentsRepo.create({
      id: payId,
      userId: user.id,
      pluginId: data.pluginId,
      kind: "plugin",
      coin: data.coin as Coin,
      amountUsd: price,
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
        body: `Send ${amountCrypto} ${data.coin.toUpperCase()} to unlock the ${label} plugin.`,
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

// --- Save config ------------------------------------------------------------

export const savePluginConfig = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      pluginId: pluginIdSchema,
      config: z.unknown(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (!await pluginsRepo.isPurchased(user.id, data.pluginId)) {
      throw new Error("Plugin not purchased");
    }
    const parsed = validateConfig(data.pluginId, data.config);
    const saved = await pluginsRepo.saveConfig(
      user.id,
      data.pluginId,
      JSON.stringify(parsed),
    );
    // Keep the bot's own static settings store in sync so the TypeScript bot
    // can read autoReply without needing to spin up a Docker container.
    if (data.pluginId === "discord-autoreply" && typeof parsed === "object") {
      const cfg = parsed as Record<string, unknown>;
      await botSettingsRepo.set("autoreply_message", String(cfg.autoReply ?? ""));
      await botSettingsRepo.set("autoreply_enabled", cfg.autoReplyEnabled ? "1" : "0");
    }
    return { ok: true, updatedAt: saved.updated_at };
  });

// --- Run (Docker-backed) ----------------------------------------------------

export const runPlugin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      pluginId: pluginIdSchema,
      config: z.unknown(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{
      ok: true;
      run: PluginRunRow;
      dockerAvailable: boolean;
    }> => {
      const user = await requireUser();
      if (!await pluginsRepo.isPurchased(user.id, data.pluginId)) {
        throw new Error("Plugin not purchased");
      }

      // One concurrent run per (user, plugin). Before blocking, reconcile:
      // a run can be marked active in the DB while its container already
      // crashed/exited and the status callback never arrived (e.g. network
      // hiccup). In that case we auto-clear it instead of blocking forever.
      const existing = await pluginsRepo.activeRun(user.id, data.pluginId);
      if (existing) {
        const stillAlive = await reconcileRun(existing);
        if (stillAlive) {
          throw new Error("This plugin already has an active run. Stop it first.");
        }
      }

      // Validate + persist the config first so the run uses the latest values.
      const parsed = validateConfig(data.pluginId, data.config);

      // Guard: discord-spam must have at least one token before starting.
      if (data.pluginId === "discord-spam") {
        const tokens: unknown[] = (parsed as { tokens?: unknown[] }).tokens ?? [];
        if (tokens.length === 0 || tokens.every((t) => !String(t).trim())) {
          throw new Error("Add at least one Discord token before starting.");
        }
      }

      const configJson = JSON.stringify(parsed);
      await pluginsRepo.saveConfig(user.id, data.pluginId, configJson);

      // Create the run record in 'pending'.
      let run = await pluginsRepo.createRun({
        userId: user.id,
        pluginId: data.pluginId,
        configSnapshot: configJson,
      });

      // Launch the container. If Docker is unreachable, leave it pending.
      try {
        const containerId = await startPluginContainer({
          runId: run.id,
          userId: user.id,
          pluginId: data.pluginId,
          configJson,
        });
        await pluginsRepo.setRunStatus(run.id, "starting", { containerId });
        run = await pluginsRepo.runById(run.id) ?? run;

        const settings = await settingsRepo.get(user.id);
        if (settings.notify_bots !== 0) {
          await notificationsRepo.create({
            userId: user.id,
            type: "bot",
            title: "Bot started",
            body: `Your ${data.pluginId} run is starting in a container.`,
          });
        }

        return { ok: true, run, dockerAvailable: true };
      } catch (err) {
        if (err instanceof DockerUnavailableError) {
          // Keep the run pending; orchestrator/host can pick it up later.
          return { ok: true, run, dockerAvailable: false };
        }
        const message = err instanceof Error ? err.message : "Failed to start container";
        await pluginsRepo.setRunStatus(run.id, "error", { error: message });
        run = await pluginsRepo.runById(run.id) ?? run;
        throw new Error(message);
      }
    },
  );

export const stopPluginRun = createServerFn({ method: "POST" })
  .inputValidator(z.object({ runId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    // Stop + remove the container if we have one. Failures here shouldn't
    // block flipping the DB status — the container may already be gone.
    if (run.container_id && (await isDockerAvailable())) {
      try {
        await stopAndRemoveContainer(run.container_id);
      } catch {
        // ignore — best effort
      }
    }

    await pluginsRepo.setRunStatus(run.id, "stopped");
    return { ok: true };
  });

// --- Live console: structured logs pushed by the run's container -----------

export interface RunLogLine {
  id: number;
  ts: string;
  level: string;
  msg: string;
}

/**
 * Returns log lines for a run the caller owns, fetched from the DB. The bot
 * container pushes its structured stdout to /api/runner/logs, so this works
 * WITHOUT the web process needing Docker socket access. Supports incremental
 * polling via `afterId` (pass the last id you've seen, 0 for the first call).
 */
export const getPluginRunLogs = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      afterId: z.number().min(0).optional(),
      limit: z.number().min(10).max(1000).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    const rows = await pluginsRepo.runLogsAfter(
      data.runId,
      data.afterId ?? 0,
      data.limit ?? 500,
    );
    const lines: RunLogLine[] = rows.map((r) => ({
      id: Number(r.id),
      ts: r.ts,
      level: r.level,
      msg: r.msg,
    }));
    const lastId =
      lines.length > 0 ? lines[lines.length - 1].id : (data.afterId ?? 0);
    return { available: true, lines, lastId };
  });

// --- Live DM feed (Discord-style panel) ------------------------------------

export interface RunEvent {
  id: number;
  kind: string;
  author: string;
  authorId: string;
  content: string;
  ts: string;
}

/**
 * Incremental fetch of the structured DM / relationship events a run's
 * container pushes to /api/runner/events. Drives the Discord-style live panel.
 * Also returns the latest still-pending captcha so the UI can pop the solver.
 */
export const getPluginRunEvents = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      afterId: z.number().min(0).optional(),
      limit: z.number().min(10).max(500).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    const rows = await pluginsRepo.runEventsAfter(
      data.runId,
      data.afterId ?? 0,
      data.limit ?? 300,
    );
    const events: RunEvent[] = rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      author: r.author,
      authorId: r.author_id,
      content: r.content,
      ts: r.ts,
    }));
    const lastId =
      events.length > 0 ? events[events.length - 1].id : (data.afterId ?? 0);

    const captcha = await pluginsRepo.pendingCaptcha(data.runId);

    return {
      events,
      lastId,
      captcha: captcha
        ? {
            id: captcha.id,
            sitekey: captcha.sitekey,
            service: captcha.service,
            createdAt: captcha.created_at,
          }
        : null,
    };
  });

/** Queue a manual reply that the run's container will deliver to a DM user. */
export const sendPluginReply = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      targetId: z.string().min(1),
      content: z.string().min(1).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    await pluginsRepo.queueOutgoing({
      runId: data.runId,
      targetId: data.targetId,
      content: data.content,
    });
    // Echo the outgoing message into the feed immediately so the UI shows it
    // without waiting for the container to confirm delivery.
    await pluginsRepo.appendRunEvents(data.runId, [
      {
        kind: "outgoing",
        author: "You",
        authorId: data.targetId,
        content: data.content,
        ts: new Date().toISOString().slice(11, 19),
      },
    ]);
    return { ok: true };
  });

/** Submit a captcha solution the user solved manually from the dashboard. */
export const solvePluginCaptcha = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      captchaId: z.string().min(1),
      solution: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    const captcha = await pluginsRepo.captchaById(data.captchaId);
    if (!captcha || captcha.run_id !== data.runId) {
      throw new Error("Captcha not found");
    }
    await pluginsRepo.solveCaptcha(data.captchaId, data.solution);
    return { ok: true };
  });

/** Dismiss a pending captcha challenge without solving it. */
export const cancelPluginCaptcha = createServerFn({ method: "POST" })
  .inputValidator(z.object({ runId: z.string(), captchaId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");
    await pluginsRepo.cancelCaptcha(data.captchaId);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Discord Chat — message fetch + send (uses same run_events table as plugins)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: number;
  author: string;
  authorId: string;
  content: string;
  ts: string;
  isOwn: boolean;
}

/**
 * Fetches new chat messages from the run's event feed since `afterId`.
 * Mirrors getPluginRunEvents but typed for the Chat panel UI.
 */
export const getChatMessages = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      afterId: z.number().min(0).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    const rows = await pluginsRepo.runEventsAfter(
      data.runId,
      data.afterId ?? 0,
      200,
    );
    const messages: ChatMessage[] = rows
      .filter((r) => r.kind === "message" || r.kind === "outgoing")
      .map((r) => ({
        id: Number(r.id),
        author: r.author,
        authorId: r.author_id,
        content: r.content,
        ts: r.ts,
        isOwn: r.kind === "outgoing",
      }));
    const lastId =
      messages.length > 0 ? messages[messages.length - 1].id : (data.afterId ?? 0);
    return { messages, lastId };
  });

/**
 * Sends a message to the guild channel via the container's outgoing queue.
 * The container reads this from the DB and delivers it to the target channel.
 */
export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      runId: z.string(),
      content: z.string().min(1).max(2000),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const run = await pluginsRepo.runByIdForUser(data.runId, user.id);
    if (!run) throw new Error("Run not found");

    // Store as outgoing event so the container picks it up
    await pluginsRepo.queueOutgoing({
      runId: data.runId,
      targetId: "guild-channel", // container resolves to actual channel
      content: data.content,
    });

    // Echo into the event feed immediately for the UI
    await pluginsRepo.appendRunEvents(data.runId, [
      {
        kind: "outgoing",
        author: "You",
        authorId: "panel",
        content: data.content,
        ts: new Date().toISOString().slice(11, 19),
      },
    ]);
    return { ok: true };
  });
