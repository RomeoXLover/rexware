import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "@/lib/auth.server";
import { botsRepo } from "@/lib/repos.server";

// POST /api/bots/delete
export const Route = createFileRoute("/api/bots/delete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();
        const { id } = await request.json();
        if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
        await botsRepo.deleteForUser(user.id, id);
        return Response.json({ ok: true });
      },
    },
  },
});
