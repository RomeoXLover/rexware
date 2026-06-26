import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { optionalEnv } from "@/lib/config.server";

// GET /api/guild/chat/guilds
// Returns all guilds the bot is a member of, with basic info.
export const Route = createFileRoute("/api/guild/chat/guilds")({
  server: {
    handlers: {
      GET: async () => {
        const user = getSessionUser();
        if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

        const botToken = optionalEnv("DISCORD_BOT_TOKEN");
        if (!botToken) {
          return Response.json({ error: "Discord bot not configured" }, { status: 503 });
        }

        const DISCORD_API = "https://discord.com/api/v10";
        try {
          const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
            headers: {
              Authorization: `Bot ${botToken}`,
              "Content-Type": "application/json",
              "User-Agent": "RexWare/1.0",
            },
          });

          if (!res.ok) {
            return Response.json({ error: `Discord error: ${res.status}` }, { status: 502 });
          }

          const guilds = await res.json();
          // Filter to only guilds where the bot has appropriate permissions
          const filtered = (guilds as Array<{
            id: string;
            name: string;
            icon: string | null;
            owner: boolean;
            permissions_new: string;
          }>).filter((g) => {
            // Bit 1024 = MANAGE_WEBHOOKS (needed to auto-create webhooks)
            const perms = Number(g.permissions_new);
            return (perms & 0x40000000) !== 0 || g.owner;
          });

          return Response.json({
            guilds: filtered.map((g) => ({
              id: g.id,
              name: g.name,
              icon: g.icon
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
                : null,
              owner: g.owner,
            })),
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
