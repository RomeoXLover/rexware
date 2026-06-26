import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/auth.server";
import { startBotContainer as doStartBot, DockerUnavailableError } from "@/lib/docker.server";
import { botsRepo } from "@/lib/repos.server";

// POST /api/bots/start
export const Route = createFileRoute("/api/bots/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();
        const { id } = await request.json();
        if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

        const bot = await botsRepo.byIdForUser(id, user.id);
        if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });

        try {
          const run = await doStartBot(bot);
          return Response.json({ ok: true, run });
        } catch (err) {
          if (err instanceof DockerUnavailableError) {
            return Response.json({ error: "Docker is not available on this server" }, { status: 503 });
          }
          throw err;
        }
      },
    },
  },
});
