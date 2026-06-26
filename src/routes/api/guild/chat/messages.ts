import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { guildChatRepo } from "@/lib/repos.server";
import { optionalEnv } from "@/lib/config.server";

// GET /api/guild/chat/messages?guildId=...
// SSE stream: polls Discord message history and pushes new messages to the client.
// Bot token comes from server-side env; guildId is looked up from the user's config.
export const Route = createFileRoute("/api/guild/chat/messages")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = getSessionUser();
        if (!user) return new Response("unauthorized", { status: 401 });

        const url = new URL(request.url);
        const guildId = url.searchParams.get("guildId");
        if (!guildId) return new Response("missing guildId", { status: 400 });

        const config = await guildChatRepo.byGuild(user.id, guildId);
        if (!config) return new Response("guild not configured", { status: 404 });

        const botToken = optionalEnv("DISCORD_BOT_TOKEN");
        if (!botToken) return new Response("Discord bot not configured", { status: 503 });

        const channelId = config.channel_id;
        const DISCORD_API = "https://discord.com/api/v10";

        const fetchMessages = async (before?: string): Promise<unknown[]> => {
          try {
            let endpoint = `${DISCORD_API}/channels/${channelId}/messages?limit=50`;
            if (before) endpoint += `&before=${before}`;
            const res = await fetch(endpoint, {
              headers: {
                Authorization: `Bot ${botToken}`,
                "Content-Type": "application/json",
                "User-Agent": "SkyUtils/1.0",
              },
            });
            return res.ok ? await res.json() : [];
          } catch {
            return [];
          }
        };

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            // Initial load: last 50 messages + guild info
            const [initMsgs, guildRes] = await Promise.all([
              fetchMessages(),
              fetch(`${DISCORD_API}/guilds/${guildId}?with_counts=true`, {
                headers: { Authorization: `Bot ${botToken}`, "User-Agent": "SkyUtils/1.0" },
              }),
            ]);

            const msgs = (initMsgs as unknown[]).reverse();
            const guild = guildRes.ok ? await guildRes.json() : null;

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "init",
                  messages: msgs,
                  guild,
                  channelName: config.channel_name,
                })}\n\n`,
              ),
            );

            let lastId: string | null =
              msgs.length > 0 ? String((msgs[msgs.length - 1] as { id: string }).id) : null;

            // Keepalive
            const ping = setInterval(() => {
              try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { clearInterval(ping); }
            }, 20000);

            // Poll every 3s for new messages
            const poll = setInterval(async () => {
              try {
                if (!lastId) return;
                const fetched = (await fetchMessages()) as { id: string }[];
                const newMsgs = fetched.filter((m) => Number(m.id) > Number(lastId!));
                if (newMsgs.length > 0) {
                  lastId = String(newMsgs[newMsgs.length - 1].id);
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: "messages", messages: newMsgs })}\n\n`,
                    ),
                  );
                }
              } catch { /* ignore */ }
            }, 3000);

            request.signal.addEventListener("abort", () => {
              clearInterval(ping);
              clearInterval(poll);
              try { controller.close(); } catch { /* closed */ }
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
