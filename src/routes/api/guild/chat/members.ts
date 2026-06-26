import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { guildChatRepo } from "@/lib/repos.server";
import { optionalEnv } from "@/lib/config.server";

// GET /api/guild/chat/members?guildId=...
// Returns guild info + roles + the current user's member data (roles, nickname)
// so the UI can do channel permission filtering.
export const Route = createFileRoute("/api/guild/chat/members")({
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
          "User-Agent": "SkyUtils/1.0",
        };

        try {
          const [guildRes, rolesRes, memberRes] = await Promise.all([
            fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, { headers }),
            fetch(`${DISCORD_API}/guilds/${guildId}/roles`, { headers }),
            user.discordId
              ? fetch(`${DISCORD_API}/guilds/${guildId}/members/${user.discordId}`, { headers })
              : Promise.resolve(null),
          ]);

          if (!guildRes.ok) {
            return Response.json({ error: `Discord error: ${guildRes.status}` }, { status: 502 });
          }

          const guild = await guildRes.json();
          const roles: unknown[] = guildRes.ok && rolesRes.ok ? await rolesRes.json() : [];
          const member = memberRes && memberRes.ok ? await memberRes.json() : null;

          // Sort roles by position (highest first = most permissions)
          const sortedRoles = [...(roles as Array<{ position: number }>)].sort(
            (a, b) => b.position - a.position,
          );

          return Response.json({
            guild: {
              id: guild.id,
              name: guild.name,
              icon: guild.icon
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
                : null,
              approximate_member_count: guild.approximate_member_count,
              approximate_presence_count: guild.approximate_presence_count,
            },
            roles: sortedRoles,
            // The current user's roles in this guild (for permission filtering)
            myRoles: member?.roles ?? [],
            myNick: member?.nick ?? null,
            myPermissions: member ? null : null, // raw permission integer if needed
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
