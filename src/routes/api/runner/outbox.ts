import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { pluginsRepo, botRunsRepo } from "@/lib/repos.server";
import { PENDING_CHATS } from "./world";

// /api/runner/outbox
// GET ?runId=...: the container fetches manual replies the user queued from the
//       dashboard and immediately marks them claimed so they're delivered once.
// Shares the RUNNER_TOKEN auth used by the other runner endpoints.

function authed(request: Request): boolean {
  const expected = process.env.RUNNER_TOKEN?.trim() || "";
  const provided = request.headers.get("x-runner-token")?.trim() || "";
  return !expected || provided === expected;
}

export const Route = createFileRoute("/api/runner/outbox")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authed(request)) return new Response("forbidden", { status: 403 });

        const url = new URL(request.url);
        const runId = url.searchParams.get("runId");
        if (!runId) return new Response("missing runId", { status: 400 });

        // Try Discord plugin runs first, then fall back to Minecraft bot runs.
        let run = await pluginsRepo.runById(runId);
        if (!run) {
          // Check if this is a Minecraft bot run (runId starts with "brun_").
          const botRun = await botRunsRepo.byId(runId);
          if (!botRun) return new Response("not found", { status: 404 });

          // Minecraft bot: drain pending AI chat messages from world-view store.
          const aiChats: { id: string; targetId: null; sender: string | null; content: string }[] = [];
          const pendingChat = PENDING_CHATS.get(runId);
          if (pendingChat) {
            PENDING_CHATS.delete(runId);
            aiChats.push({
              id: `ai-${runId}-${pendingChat.ts}`,
              targetId: null,
              sender: pendingChat.sender,
              content: pendingChat.text,
            });
          }

          return Response.json({
            messages: aiChats,
          });
        }

        const pending = await pluginsRepo.pendingOutgoing(runId, 50);
        // Claim them so the same reply is never delivered twice.
        if (pending.length > 0) {
          await pluginsRepo.markOutgoingSent(pending.map((p) => p.id));
        }

        // Also drain any pending AI chat messages for this run.
        const aiChats: { id: string; targetId: null; sender: string | null; content: string }[] = [];
        const pendingChat = PENDING_CHATS.get(runId);
        if (pendingChat) {
          PENDING_CHATS.delete(runId);
          aiChats.push({
            id: `ai-${runId}-${pendingChat.ts}`,
            targetId: null,
            sender: pendingChat.sender,
            content: pendingChat.text,
          });
        }

        return Response.json({
          messages: [
            ...pending.map((p) => ({
              id: p.id,
              targetId: p.target_id,
              content: p.content,
            })),
            ...aiChats,
          ],
        });
      },
    },
  },
});
