import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { requireUser } from "@/lib/auth.server";
import { botsRepo } from "@/lib/repos.server";
import { validateDiscordWebhook } from "@/lib/discord-webhooks.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function publicBot(b: any) {
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

// POST /api/bots/update
export const Route = createFileRoute("/api/bots/update")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();

        const schema = z.object({
          id: z.string().uuid(),
          name: z.string().min(1).max(64).optional(),
          mcUsername: z.string().max(64).optional(),
          serverHost: z.string().max(255).optional(),
          serverPort: z.coerce.number().int().min(1).max(65565).optional(),
          mcVersion: z.string().max(32).optional(),
          authMode: z.enum(["offline", "microsoft", "ssid"]).optional(),
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

        // Validate webhook URL before saving — Discord returns 403 when the URL is
        // stale (webhook deleted or channel removed), giving the user a clear error
        // instead of silent failures in the bot container logs.
        if (data.webhookUrl && data.webhookUrl.trim()) {
          const valid = await validateDiscordWebhook(data.webhookUrl.trim());
          if (!valid.ok) {
            return Response.json({ error: valid.error, issues: [{ message: valid.error }] }, { status: 422 });
          }
        }

        const patch: Parameters<typeof botsRepo.update>[2] = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.mcUsername !== undefined) patch.mc_username = data.mcUsername?.trim() || "";
        if (data.serverHost !== undefined) patch.server_host = data.serverHost;
        if (data.serverPort !== undefined) patch.server_port = data.serverPort;
        if (data.mcVersion !== undefined) patch.mc_version = data.mcVersion;
        if (data.authMode !== undefined) patch.auth_mode = data.authMode;
        if (data.accessToken !== undefined) patch.access_token = data.accessToken || null;
        if (data.ssid !== undefined) patch.ssid = data.ssid || null;
        if (data.uuid !== undefined) patch.uuid = data.uuid || null;
        if (data.reply !== undefined) {
          patch.reply = data.reply && data.reply.length > 0
            ? JSON.stringify(data.reply.map((s) => s.trim()).filter(Boolean))
            : null;
        }
        if (data.replyActions !== undefined) {
          patch.reply_actions = data.replyActions && data.replyActions.length > 0
            ? JSON.stringify(data.replyActions.map((s) => s.trim()).filter(Boolean))
            : null;
        }
        if (data.triggerKeyword !== undefined) patch.trigger_keyword = data.triggerKeyword || null;
        if (data.webhookUrl !== undefined) patch.webhook_url = data.webhookUrl || null;
        if (data.proxy !== undefined) patch.proxy = data.proxy || null;
        if (data.messageInterval !== undefined) patch.message_interval = data.messageInterval ?? null;
        if (data.replyDelay !== undefined) patch.reply_delay = data.replyDelay ?? null;
        if (data.replyCooldown !== undefined) patch.reply_cooldown = data.replyCooldown ?? null;
        if (data.afkInterval !== undefined) patch.afk_interval = data.afkInterval ?? null;
        if (data.reconnectDelay !== undefined) patch.reconnect_delay = data.reconnectDelay ?? null;
        if (data.inactivityTimeout !== undefined) patch.inactivity_timeout = data.inactivityTimeout ?? null;

        const bot = await botsRepo.update(data.id, user.id, patch);

        return Response.json({ ok: true, bot: publicBot(bot) });
      },
    },
  },
});
