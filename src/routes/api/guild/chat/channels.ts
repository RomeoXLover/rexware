import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { optionalEnv } from "@/lib/config.server";

// GET /api/guild/chat/channels?guildId=...
// Returns text channels in the guild. Also returns roles + member's roles so the
// UI can filter which channels the user can see based on their Discord roles.
export const Route = createFileRoute("/api/guild/chat/channels")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        const url = new URL(request.url);
        const guildId = url.searchParams.get("guildId");
        if (!guildId) return Response.json({ error: "missing guildId" }, { status: 400 });

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
          // Fetch channels + guild in parallel
          const [channelsRes, guildRes, rolesRes] = await Promise.all([
            fetch(`${DISCORD_API}/guilds/${guildId}/channels`, { headers }),
            fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, { headers }),
            fetch(`${DISCORD_API}/guilds/${guildId}/roles`, { headers }),
          ]);

          if (!channelsRes.ok) {
            return Response.json({ error: `Discord error: ${channelsRes.status}` }, { status: 502 });
          }

          const allChannels = await channelsRes.json();

          // Filter to only GUILD_TEXT (0) channels; also keep categories
          const categories = allChannels.filter(
            (c: { type: number }) => c.type === 4,
          );
          const textChannels = allChannels.filter(
            (c: { type: number; parent_id: string | null }) =>
              c.type === 0 && c.parent_id != null,
          );
          const topChannels = allChannels.filter(
            (c: { type: number; parent_id: string | null }) =>
              c.type === 0 && !c.parent_id,
          );

          const guild = guildRes.ok ? await guildRes.json() : null;
          const roles: unknown[] = guildRes.ok && rolesRes.ok ? await rolesRes.json() : [];

          // Sort roles by position (highest first = most important)
          const sortedRoles = [...(roles as Array<{ position: number }>)].sort(
            (a, b) => b.position - a.position,
          );

          return Response.json({
            guild: guild
              ? {
                  id: guild.id,
                  name: guild.name,
                  icon: guild.icon
                    ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
                    : null,
                  approximate_member_count: guild.approximate_member_count,
                  approximate_presence_count: guild.approximate_presence_count,
                }
              : null,
            categories,
            textChannels,
            topChannels,
            roles: sortedRoles,
          });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "fetch failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
