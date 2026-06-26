import { createFileRoute } from "@tanstack/react-router";
import { globalChatRepo, usersRepo } from "@/lib/repos.server";
import { notifyGlobalChat } from "@/routes/api/runner/global-chat";

// POST /api/global-chat/bot-sync — called by the main bot process when a
// Discord message is posted in the configured global chat channel.
// Authenticated via X-RUNNER-TOKEN header (matches RUNNER_TOKEN env var).
export const Route = createFileRoute("/api/global-chat/bot-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-runner-token");
        const expectedToken = process.env.RUNNER_TOKEN;
        if (!expectedToken || token !== expectedToken) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        let body: {
          userId?: string;
          username?: string;
          avatarUrl?: string | null;
          content?: string;
          replyToId?: string | null;
          replyToUsername?: string | null;
          source?: "web" | "discord";
          discordMessageId?: string | null;
        };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const userId = typeof body.userId === "string" ? body.userId : "";
        const username = typeof body.username === "string" ? body.username : "Unknown";
        const avatarUrl = typeof body.avatarUrl === "string" ? body.avatarUrl : null;
        const content = typeof body.content === "string" ? body.content.trim() : "";

        if (!userId || !content) {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }

        // Enrich with SkyUtils user data if this Discord user has an account.
        // Prefer the SkyUtils avatar/username over the raw Discord data.
        const skyutilsUser = await usersRepo.byDiscordId(userId).catch(() => null);
        const resolvedUsername = skyutilsUser?.username ?? username;
        const resolvedAvatarUrl = skyutilsUser?.avatar_url ?? avatarUrl;

        const message = await globalChatRepo.post({
          userId,
          username: resolvedUsername,
          avatarUrl: resolvedAvatarUrl,
          content,
          replyToId: typeof body.replyToId === "string" ? body.replyToId : null,
          replyToUsername: typeof body.replyToUsername === "string" ? body.replyToUsername : null,
          source: "discord",
          discordMessageId: typeof body.discordMessageId === "string" ? body.discordMessageId : null,
        });

        notifyGlobalChat({ type: "message", message });

        return Response.json({ ok: true, message });
      },
    },
  },
});
