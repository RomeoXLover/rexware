import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { pluginsRepo } from "@/lib/repos.server";

// POST /api/runner/logs
// Each bot container ships its structured stdout here so the website's live
// console can display it WITHOUT the web process needing Docker socket access.
// Authenticated by the same shared RUNNER_TOKEN as the status callback.

interface IncomingLine {
  ts?: string;
  level?: string;
  msg?: string;
}

export const Route = createFileRoute("/api/runner/logs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNNER_TOKEN?.trim() || "";
        const provided = request.headers.get("x-runner-token")?.trim() || "";
        if (expected && provided !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        let body: { runId?: string; lines?: IncomingLine[] };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const runId = body.runId;
        if (!runId || !Array.isArray(body.lines)) {
          return new Response("invalid", { status: 400 });
        }

        // Only accept logs for a run that actually exists.
        const run = await pluginsRepo.runById(runId);
        if (!run) {
          return new Response("not found", { status: 404 });
        }

        const lines = body.lines
          .filter((l) => l && typeof l.msg === "string")
          .slice(0, 500)
          .map((l) => ({
            ts: typeof l.ts === "string" ? l.ts : "",
            level: typeof l.level === "string" ? l.level : "INFO",
            msg: String(l.msg).slice(0, 2000),
          }));

        if (lines.length > 0) {
          await pluginsRepo.appendRunLogs(runId, lines);
        }

        return new Response("*ok*", { status: 200 });
      },
    },
  },
});
