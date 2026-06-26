import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/auth.server";
import { stopAndRemoveContainer, isDockerAvailable } from "@/lib/docker.server";
import { botsRepo, botRunsRepo } from "@/lib/repos.server";

// POST /api/bots/stop
export const Route = createFileRoute("/api/bots/stop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();
        const { id } = await request.json();
        if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

        const bot = await botsRepo.byIdForUser(id, user.id);
        if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });

        const active = await botRunsRepo.activeForBot(bot.id);
        if (!active) return Response.json({ ok: true });

        if (active.container_id && (await isDockerAvailable())) {
          try {
            await stopAndRemoveContainer(active.container_id);
          } catch {
            // best-effort
          }
        }

        await botRunsRepo.setStatus(active.id, "stopped");
        return Response.json({ ok: true });
      },
    },
  },
});
