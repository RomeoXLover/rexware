import { createFileRoute } from "@tanstack/react-router";

import { getSessionUser } from "@/lib/auth.server";
import { botRunsRepo } from "@/lib/repos.server";
import {
  streamContainerLogs,
  stripDockerFrame,
  isDockerAvailable,
} from "@/lib/docker.server";

// GET /api/runner/stream?runId=...
// Server-Sent Events endpoint that pipes a bot run's container logs straight
// from `docker logs --follow` to the browser — a TRULY live console with no DB
// persistence. Authenticated by the user's own session (must own the run).

export const Route = createFileRoute("/api/runner/stream")({
  server: {
    handlers: {
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

        if (!run.container_id || !(await isDockerAvailable())) {
          // Nothing to stream — tell the client and close cleanly.
          const stream = new ReadableStream({
            start(controller) {
              let message: string;
              if (run.status === "error" && run.error) {
                // The container failed to start (Docker unavailable, image missing,
                // permission denied, …). Surface the actual error from the DB so the
                // user knows why, instead of the generic "not started yet" message.
                message = run.error;
              } else if (run.container_id) {
                message = "Docker engine is not reachable.";
              } else {
                message = "Bot has not started a container yet.";
              }
              controller.enqueue(sse("info", JSON.stringify({ message })));
              controller.enqueue(sse("end", "{}"));
              controller.close();
            },
          });
          return new Response(stream, { headers: sseHeaders() });
        }

        let dockerStream: NodeJS.ReadableStream;
        try {
          dockerStream = await streamContainerLogs(run.container_id, 200);
        } catch {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                sse("info", JSON.stringify({ message: "Container is gone." })),
              );
              controller.enqueue(sse("end", "{}"));
              controller.close();
            },
          });
          return new Response(stream, { headers: sseHeaders() });
        }

        const stream = new ReadableStream({
          start(controller) {
            let closed = false;
            const close = () => {
              if (closed) return;
              closed = true;
              try {
                (dockerStream as unknown as { destroy?: () => void }).destroy?.();
              } catch {
                // ignore
              }
              try {
                controller.enqueue(sse("end", "{}"));
                controller.close();
              } catch {
                // already closed
              }
            };

            // Keep the connection alive through proxies.
            const ping = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                clearInterval(ping);
              }
            }, 15000);

            dockerStream.on("data", (chunk: Buffer) => {
              const text = stripDockerFrame(chunk);
              if (!text) return;
              for (const line of text.split(/\r?\n/)) {
                if (line.length === 0) continue;
                try {
                  controller.enqueue(sse("log", JSON.stringify({ line })));
                } catch {
                  // controller closed
                }
              }
            });

            dockerStream.on("end", () => {
              clearInterval(ping);
              close();
            });
            dockerStream.on("error", () => {
              clearInterval(ping);
              close();
            });

            request.signal.addEventListener("abort", () => {
              clearInterval(ping);
              close();
            });
          },
        });

        return new Response(stream, { headers: sseHeaders() });
      },
    },
  },
});

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
