import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { botsRepo, usersRepo } from "@/lib/repos.server";
import { queryOne } from "@/lib/db.server";

// POST /api/runner/identity
// As soon as a bot container authenticates, it reports the in-game username it
// detected from its profile (Microsoft / SSID auto-detect it at runtime). We
// persist it onto the bot row so the website knows whose skin/bust to render,
// and onto the user row so the payment DM system knows who to message.
// Authenticated by the same shared RUNNER_TOKEN as the status/logs callbacks.

export const Route = createFileRoute("/api/runner/identity")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNNER_TOKEN?.trim() || "";
        const provided = request.headers.get("x-runner-token")?.trim() || "";
        if (expected && provided !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        let body: { botId?: string; mcUsername?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const botId = body.botId?.trim();
        const mcUsername = body.mcUsername?.trim();
        if (!botId || !mcUsername) {
          return new Response("invalid", { status: 400 });
        }

        // No-ops on an invalid name or when it already matches what's stored.
        await botsRepo.setDetectedUsername(botId, mcUsername);

        // Also persist on the user so payment DM lookups can find it.
        const botRow = await queryOne<{ user_id: string }>(
          "SELECT user_id FROM bots WHERE id = ?",
          [botId],
        );
        if (botRow) {
          await usersRepo.setMcUsername(botRow.user_id, mcUsername);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
