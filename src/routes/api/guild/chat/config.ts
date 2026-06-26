import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { guildChatRepo } from "@/lib/repos.server";
import { optionalEnv } from "@/lib/config.server";

// GET  /api/guild/chat/config  → { configs: GuildChatConfigRow[] }
// POST /api/guild/chat/config  → { config: GuildChatConfigRow }
//      Body: { guildId, channelId }
//      Server auto-creates webhook, stores guild/channel.
// DELETE /api/guild/chat/config?guildId=...  → { ok: true }
export const Route = createFileRoute("/api/guild/chat/config")({
  server: {
    handlers: {
      GET: async () => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        const configs = await guildChatRepo.byUserId(user.id);
        // Never expose webhook tokens to the client
        const safe = configs.map(({ webhook_token: _wt, ...rest }) => rest);
        return Response.json({ configs: safe });
      },

      POST: async ({ request }) => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: { guildId?: string; channelId?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const { guildId, channelId } = body;
        if (!guildId || !channelId) {
          return Response.json({ error: "missing guildId or channelId" }, { status: 400 });
        }

        const botToken = optionalEnv("DISCORD_BOT_TOKEN");
        if (!botToken) {
          return Response.json({ error: "Discord bot not configured" }, { status: 503 });
        }

        const DISCORD_API = "https://discord.com/api/v10";
        const headers = {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json",
          "User-Agent": "RexWare/1.0",
        };

        try {
          // Fetch guild info + channel info in parallel
          const [guildRes, channelRes] = await Promise.all([
            fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, { headers }),
            fetch(`${DISCORD_API}/channels/${channelId}`, { headers }),
          ]);

          if (!guildRes.ok) {
            const t = await guildRes.text();
            return Response.json({ error: `Guild fetch failed (${guildRes.status}): ${t}` }, { status: 502 });
          }
          if (!channelRes.ok) {
            const t = await channelRes.text();
            return Response.json({ error: `Channel fetch failed (${channelRes.status}): ${t}` }, { status: 502 });
          }

          const guild = await guildRes.json();
          const channel = await channelRes.json();

          // Auto-create webhook in this channel (name = RexWare)
          const webhookRes = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "RexWare", avatar: null }),
          });

          if (!webhookRes.ok) {
            // If webhook already exists, try to find it
            const existingRes = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, { headers });
            if (existingRes.ok) {
              const webhooks = await existingRes.json();
              const existing = (webhooks as Array<{ id: string; token: string; url: string }>).find(
                (w) => w.name === "RexWare",
              );
              if (existing) {
                const config = await guildChatRepo.upsert({
                  userId: user.id,
                  guildId,
                  guildName: guild.name,
                  guildIcon: guild.icon,
                  channelId,
                  channelName: channel.name,
                  webhookId: existing.id,
                  webhookToken: existing.token,
                  webhookUrl: existing.url,
                });
                const { webhook_token: _wt, ...safe } = config;
                return Response.json({ config: safe });
              }
            }
            const t = await webhookRes.text();
            return Response.json({ error: `Webhook creation failed (${webhookRes.status}): ${t}` }, { status: 502 });
          }

          const webhook = await webhookRes.json();

          // Save config
          const config = await guildChatRepo.upsert({
            userId: user.id,
            guildId,
            guildName: guild.name,
            guildIcon: guild.icon,
            channelId,
            channelName: channel.name,
            webhookId: webhook.id,
            webhookToken: webhook.token,
            webhookUrl: webhook.url,
          });

          // Never expose webhook token to client
          const { webhook_token: _wt, ...safe } = config;
          return Response.json({ config: safe });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "setup failed" },
            { status: 500 },
          );
        }
      },

      DELETE: async ({ request }) => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const guildId = url.searchParams.get("guildId");
        if (!guildId) return Response.json({ error: "missing guildId" }, { status: 400 });

        await guildChatRepo.delete(user.id, guildId);
        return Response.json({ ok: true });
      },
    },
  },
});
