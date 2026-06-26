import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/auth.server";
import { botsRepo, botRunsRepo, subscriptionsRepo, plansRepo, usersRepo } from "@/lib/repos.server";
import { isDockerAvailable } from "@/lib/docker.server";

type BotRunRow = Awaited<ReturnType<typeof botRunsRepo.latestForUser>>[string];

function publicBot(bot: Awaited<ReturnType<typeof botsRepo.forUser>>[number]) {
  return {
    id: bot.id,
    name: bot.name,
    mcUsername: bot.mc_username ?? "",
    serverHost: bot.server_host,
    serverPort: bot.server_port,
    mcVersion: bot.mc_version ?? "",
    authMode: bot.auth_mode,
    accessToken: bot.access_token ?? null,
    ssid: bot.ssid ?? null,
    uuid: bot.uuid ?? null,
    message: bot.message ?? "",
    reply: bot.reply ? JSON.parse(bot.reply) : [],
    replyActions: bot.reply_actions ? JSON.parse(bot.reply_actions) : [],
    triggerKeyword: bot.trigger_keyword ?? null,
    webhookUrl: bot.webhook_url ?? "",
    proxy: bot.proxy ?? "",
    messageInterval: bot.message_interval ?? "",
    replyDelay: bot.reply_delay ?? "",
    replyCooldown: bot.reply_cooldown ?? "",
    afkInterval: bot.afk_interval ?? "",
    reconnectDelay: bot.reconnect_delay ?? "",
    inactivityTimeout: bot.inactivity_timeout ?? "",
    createdAt: bot.created_at,
    updatedAt: bot.updated_at,
  };
}

async function maxBotsForUser(userId: string): Promise<number> {
  const sub = await subscriptionsRepo.activeForUser(userId);
  if (!sub) return 0;
  const plan = await plansRepo.byId(sub.plan_id);
  const base = plan?.max_bots ?? 0;
  if (base === -1) return -1;
  if (base === 0) return 0;
  const extra = await usersRepo.extraBotSlots(userId);
  return base + extra;
}

async function dailyHoursForUser(userId: string): Promise<number> {
  const sub = await subscriptionsRepo.activeForUser(userId);
  if (!sub) return 0;
  const plan = await plansRepo.byId(sub.plan_id);
  return plan?.bot_hours ?? -1;
}

async function enforceDailyHoursLimit(userId: string) {
  const limitHours = await dailyHoursForUser(userId);
  if (limitHours < 0) return { limitReached: false, stopped: 0 };

  const usedMs = await botRunsRepo.usedMsToday(userId);
  const usedHours = usedMs / 3_600_000;

  if (usedHours < limitHours) return { limitReached: false, stopped: 0 };

  const runs = await botRunsRepo.activeForUser(userId);
  let stopped = 0;
  for (const run of runs) {
    if (stopped >= 5) break;
    if (run.container_id) {
      try {
        const { stopAndRemoveContainer } = await import("@/lib/docker.server");
        await stopAndRemoveContainer(run.container_id);
      } catch {
        // best-effort
      }
    }
    await botRunsRepo.setStatus(run.id, "error", { error: "Daily bot-hours limit reached" });
    stopped++;
  }
  return { limitReached: true, stopped };
}

// GET /api/bots
export const Route = createFileRoute("/api/bots")({
  server: {
    handlers: {
      GET: async () => {
        const user = await requireUser();

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

        return Response.json({
          maxBots,
          dockerAvailable,
          hoursLimit,
          hoursUsedToday: Math.round((usedMsToday / 3_600_000) * 100) / 100,
          hoursLimitReached: enforcement.limitReached,
          hoursJustStopped: enforcement.stopped,
          bots: bots.map((bot) => ({
            ...publicBot(bot),
            run: runs[bot.id] ?? null,
          })),
        });
      },
    },
  },
});
