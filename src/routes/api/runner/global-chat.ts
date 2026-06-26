import { createFileRoute } from "@tanstack/react-router";

import { globalChatRepo } from "@/lib/repos.server";
import { getSessionUser } from "@/lib/auth.server";

// ---------------------------------------------------------------------------
// In-memory pub/sub — one global channel for chat messages.
// Every SSE client subscribes; when a new message is posted we notify all.
// ---------------------------------------------------------------------------
type Subscriber = (msg: unknown) => void;
const _subscribers = new Set<Subscriber>();

export function notifyGlobalChat(message: unknown) {
  for (const cb of _subscribers) {
    try { cb(message); } catch { /* client gone */ }
  }
}

// GET /api/runner/global-chat — SSE stream of new messages (no auth needed for demo)
export const Route = createFileRoute("/api/runner/global-chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Optional session user so we can tag messages
        const user = getSessionUser();

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          start(controller) {
            const sub: Subscriber = (msg) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
              } catch {
                _subscribers.delete(sub);
              }
            };
            _subscribers.add(sub);

            // Send initial snapshot of last 50 messages
            globalChatRepo.recent(50).then((msgs) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "init", messages: msgs.reverse() })}\n\n`));
              } catch { /* closed */ }
            });

            // Keepalive ping
            const ping = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {
                clearInterval(ping);
                _subscribers.delete(sub);
              }
            }, 20000);

            request.signal.addEventListener("abort", () => {
              clearInterval(ping);
              _subscribers.delete(sub);
              try { controller.close(); } catch { /* already closed */ }
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
