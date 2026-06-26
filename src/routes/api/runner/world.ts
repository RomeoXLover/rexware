import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { botRunsRepo } from "@/lib/repos.server";

// In-memory snapshot store: latest world state per runId.
// The Rust mcbot container (when built with world_view support) POSTs here
// every ~500 ms. The GET handler streams the latest snapshot via SSE.
const SNAPSHOTS = new Map<string, { ts: number; bot: unknown; entities: unknown[] }>();

// Pending AI chat messages queued by the bot (action=chat POSTs).
const PENDING_CHATS = new Map<string, { sender: string | null; text: string; ts: number }>();

export { PENDING_CHATS };

export const Route = createFileRoute("/api/runner/world")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNNER_TOKEN?.trim() || "";
        const provided = request.headers.get("x-runner-token")?.trim() || "";
        if (expected && provided !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        let body: { botId?: string; bot?: unknown; entities?: unknown[]; action?: string; sender?: string; text?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const botId = body.botId?.trim();
        if (!botId) {
          return new Response("invalid", { status: 400 });
        }

        const run = await botRunsRepo.activeForBot(botId);
        if (!run) {
          return new Response("no active run", { status: 404 });
        }

        // Handle AI chat enqueue: the bot asks the runner to send a chat message.
        if (body.action === "chat" && body.text) {
          // Store a pending chat message for this run; the runner will pick it up.
          PENDING_CHATS.set(run.id, { sender: body.sender ?? null, text: String(body.text), ts: Date.now() });
          return new Response("ok", { status: 200 });
        }

        // World snapshot update
        SNAPSHOTS.set(run.id, {
          ts: Date.now(),
          bot: body.bot ?? null,
          entities: Array.isArray(body.entities) ? body.entities.slice(0, 40) : [],
        });

        return new Response("ok", { status: 200 });
      },

      GET: async ({ request }) => {
        const user = getSessionUser();
        if (!user) {
          return new Response("unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const runId = url.searchParams.get("runId");
        if (!runId) {
          return new Response("missing runId", { status: 400 });
        }

        const run = await botRunsRepo.byIdForUser(runId, user.id);
        if (!run) {
          return new Response("not found", { status: 404 });
        }

        const encoder = new TextEncoder();
        const sse = (event: string, data: string) =>
          encoder.encode(`event: ${event}\ndata: ${data}\n\n`);

        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            let lastTs = 0;
            let pingTimer: ReturnType<typeof setInterval> | null = null;

            const sendCurrent = () => {
              if (closed) return;
              const entry = SNAPSHOTS.get(runId);
              if (entry && entry.ts !== lastTs) {
                lastTs = entry.ts;
                try {
                  controller.enqueue(
                    sse("state", JSON.stringify({ bot: entry.bot, entities: entry.entities })),
                  );
                } catch {
                  // controller closed
                }
              }
            };

            const close = () => {
              if (closed) return;
              closed = true;
              if (pingTimer) clearInterval(pingTimer);
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
                controller.enqueue(sse("end", "{}"));
                controller.close();
              } catch {
                // already closed
              }
            };

            sendCurrent();

            const poll = setInterval(sendCurrent, 300);
            pingTimer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                clearInterval(poll);
                clearInterval(pingTimer);
                close();
              }
            }, 15000);

            (request as { signal: { addEventListener: (type: string, fn: () => void) => void } }).signal.addEventListener(
              "abort",
              () => {
                clearInterval(poll);
                if (pingTimer) clearInterval(pingTimer);
                close();
              },
            );
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
