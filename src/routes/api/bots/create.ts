import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { requireUser } from "@/lib/auth.server";
import { botsRepo, subscriptionsRepo, plansRepo, usersRepo } from "@/lib/repos.server";
import { validateDiscordWebhook } from "@/lib/discord-webhooks.server";

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

function publicBot(bot: Parameters<typeof botsRepo.create>[0] extends infer T ? T : never) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = bot as any;
  return {
    id: b.id ?? "",
    name: b.name,
    mcUsername: b.mc_username ?? b.mcUsername ?? "",
    serverHost: b.server_host ?? b.serverHost,
    serverPort: b.server_port ?? b.serverPort,
    mcVersion: b.mc_version ?? b.mcVersion ?? "",
    authMode: b.auth_mode ?? b.authMode,
    accessToken: b.access_token ?? b.accessToken ?? null,
    ssid: b.ssid ?? null,
    uuid: b.uuid ?? null,
    message: b.message ?? "",
    reply: typeof b.reply === "string" ? JSON.parse(b.reply) : (b.reply ?? []),
    replyActions: typeof b.reply_actions === "string" ? JSON.parse(b.reply_actions) : (b.replyActions ?? []),
    triggerKeyword: b.trigger_keyword ?? b.triggerKeyword ?? null,
    webhookUrl: b.webhook_url ?? b.webhookUrl ?? "",
    proxy: b.proxy ?? "",
    messageInterval: b.message_interval ?? b.messageInterval ?? "",
    replyDelay: b.reply_delay ?? b.replyDelay ?? "",
    replyCooldown: b.reply_cooldown ?? b.replyCooldown ?? "",
    afkInterval: b.afk_interval ?? b.afkInterval ?? "",
    reconnectDelay: b.reconnect_delay ?? b.reconnectDelay ?? "",
    inactivityTimeout: b.inactivity_timeout ?? b.inactivityTimeout ?? "",
    createdAt: b.created_at ?? b.createdAt,
    updatedAt: b.updated_at ?? b.updatedAt,
  };
}

// POST /api/bots/create
export const Route = createFileRoute("/api/bots/create")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();

        const schema = z.object({
          name: z.string().min(1).max(64),
          mcUsername: z.string().max(64).optional(),
          serverHost: z.string().max(255),
          serverPort: z.coerce.number().int().min(1).max(65565),
          mcVersion: z.string().max(32),
          authMode: z.enum(["offline", "microsoft", "ssid"]).default("offline"),
          accessToken: z.string().max(512).optional(),
          ssid: z.string().max(512).optional(),
          uuid: z.string().max(64).optional(),
          reply: z.array(z.string()).optional(),
          replyActions: z.array(z.string()).optional(),
          triggerKeyword: z.string().optional(),
          webhookUrl: z.string().max(2048).optional().or(z.literal("")),
          proxy: z.string().max(512).optional(),
          messageInterval: z.coerce.number().optional(),
          replyDelay: z.coerce.number().optional(),
          replyCooldown: z.coerce.number().optional(),
          afkInterval: z.coerce.number().optional(),
          reconnectDelay: z.coerce.number().optional(),
          inactivityTimeout: z.coerce.number().optional(),
        });

        let data: z.infer<typeof schema>;
        try {
          data = schema.parse(await request.json());
        } catch (err) {
          if (err instanceof z.ZodError) {
            return Response.json(
              { error: err.issues[0].message, issues: err.issues },
              { status: 400 },
            );
          }
          throw err;
        }

        const maxBots = await maxBotsForUser(user.id);
        if (maxBots === 0) {
          return Response.json(
            { error: "Your plan does not include any bots. Upgrade to deploy bots." },
            { status: 403 },
          );
        }
        if (maxBots !== -1) {
          const count = await botsRepo.countForUser(user.id);
          if (count >= maxBots) {
            return Response.json(
              { error: `You've reached your plan's limit of ${maxBots} bot(s). Upgrade for more.` },
              { status: 403 },
            );
          }
        }

          // Validate webhook URL before saving (see update.ts for details).
          if (data.webhookUrl && data.webhookUrl.trim()) {
            const valid = await validateDiscordWebhook(data.webhookUrl.trim());
            if (!valid.ok) {
              return Response.json({ error: valid.error, issues: [{ message: valid.error }] }, { status: 422 });
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
          reply: data.reply && data.reply.length > 0
            ? JSON.stringify(data.reply.map((s) => s.trim()).filter(Boolean))
            : null,
          replyActions: data.replyActions && data.replyActions.length > 0
            ? JSON.stringify(data.replyActions.map((s) => s.trim()).filter(Boolean))
            : null,
          triggerKeyword: data.triggerKeyword || null,
          webhookUrl: data.webhookUrl || null,
          proxy: data.proxy || null,
          messageInterval: data.messageInterval ?? null,
          replyDelay: data.replyDelay ?? null,
          replyCooldown: data.replyCooldown ?? null,
          afkInterval: data.afkInterval ?? null,
          reconnectDelay: data.reconnectDelay ?? null,
          inactivityTimeout: data.inactivityTimeout ?? null,
        });

        return Response.json({ ok: true, bot: publicBot(bot) });
      },
    },
  },
});
