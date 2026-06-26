import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { pluginsRepo } from "@/lib/repos.server";

// POST /api/runner/events
// Each bot container ships structured DM / relationship events here so the
// website's Discord-style live panel can render them in real time. Shares the
// same RUNNER_TOKEN auth as the log + status callbacks.

interface IncomingEvent {
  kind?: string;
  author?: string;
  authorId?: string;
  content?: string;
  ts?: string;
}

const VALID_KINDS = new Set(["incoming", "outgoing", "friend", "system"]);

export const Route = createFileRoute("/api/runner/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNNER_TOKEN?.trim() || "";
        const provided = request.headers.get("x-runner-token")?.trim() || "";
        if (expected && provided !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        let body: { runId?: string; events?: IncomingEvent[] };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const runId = body.runId;
        if (!runId || !Array.isArray(body.events)) {
          return new Response("invalid", { status: 400 });
        }

        const run = await pluginsRepo.runById(runId);
        if (!run) {
          return new Response("not found", { status: 404 });
        }

        const events = body.events
          .filter((e) => e && typeof e.content === "string")
          .slice(0, 200)
          .map((e) => ({
            kind: VALID_KINDS.has(String(e.kind)) ? String(e.kind) : "incoming",
            author: String(e.author ?? "").slice(0, 100),
            authorId: String(e.authorId ?? "").slice(0, 32),
            content: String(e.content ?? "").slice(0, 2000),
            ts: typeof e.ts === "string" ? e.ts : "",
          }));

        if (events.length > 0) {
          await pluginsRepo.appendRunEvents(runId, events);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
