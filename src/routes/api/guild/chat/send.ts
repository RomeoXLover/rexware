import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { guildChatRepo } from "@/lib/repos.server";
import { optionalEnv } from "@/lib/config.server";

// POST /api/guild/chat/send
// Sends a message to the Discord channel via the auto-created webhook,
// using the user's Discord display name and avatar.
export const Route = createFileRoute("/api/guild/chat/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: { guildId?: string; content?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const { guildId, content: rawContent } = body;
        const content = typeof rawContent === "string" ? rawContent.trim() : "";

        if (!guildId || !content) {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }
        if (content.length > 2000) {
          return Response.json({ error: "message too long" }, { status: 400 });
        }

        const config = await guildChatRepo.byGuild(user.id, guildId);
        if (!config) {
          return Response.json({ error: "guild not configured" }, { status: 404 });
        }
        if (!config.webhook_url) {
          return Response.json({ error: "no webhook configured" }, { status: 400 });
        }

        // Resolve the user's Discord display name from their OAuth token
        let displayName = user.username;
        let avatarUrl: string | null = user.avatarUrl;

        const botToken = optionalEnv("DISCORD_BOT_TOKEN");
        if (botToken) {
          try {
            const DISCORD_API = "https://discord.com/api/v10";
            // Get the user's Discord info via the bot's guild member endpoint
            const memberRes = await fetch(
              `${DISCORD_API}/guilds/${guildId}/members/${user.discordId ?? ""}`,
              {
                headers: {
                  Authorization: `Bot ${botToken}`,
                  "Content-Type": "application/json",
                  "User-Agent": "SkyUtils/1.0",
                },
              },
            );
            if (memberRes.ok) {
              const member = await memberRes.json();
              displayName = member.nick ?? member.user?.global_name ?? member.user?.username ?? user.username;
              if (member.user?.avatar) {
                avatarUrl = `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`;
              } else if (member.user) {
                const idx = Number(BigInt(member.user.id) >> 22n) % 5;
                avatarUrl = `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
              }
            }
          } catch { /* use defaults */ }
        }

        try {
          const res = await fetch(config.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content,
              username: displayName,
              ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
            }),
          });

          if (!res.ok) {
            const text = await res.text();
            return Response.json({ error: `Discord rejected: ${text}` }, { status: 502 });
          }

          return Response.json({ ok: true });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "send failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
