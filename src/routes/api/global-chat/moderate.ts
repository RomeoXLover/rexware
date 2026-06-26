import { createFileRoute } from "@tanstack/react-router";

import { globalChatRepo } from "@/lib/repos.server";
import { requireStaff } from "@/lib/api/admin.functions";
import { notifyGlobalChat } from "@/routes/api/runner/global-chat";

type ModerateAction = "delete" | "timeout";

// POST /api/global-chat/moderate  — admin only, deletes messages or timeouts users
export const Route = createFileRoute("/api/global-chat/moderate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // requireStaff throws on failure, so we just let it propagate
        await requireStaff();

        let body: { action: ModerateAction; messageId: string; durationMinutes?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const { action, messageId, durationMinutes } = body;

        if (!messageId || typeof messageId !== "string") {
          return Response.json({ error: "invalid messageId" }, { status: 400 });
        }

        if (action === "delete") {
          const message = await globalChatRepo.byId(messageId);
          if (!message) {
            return Response.json({ error: "message not found" }, { status: 404 });
          }

          await globalChatRepo.deleteMessage(messageId);

          notifyGlobalChat({
            type: "moderation",
            action: "delete",
            messageId,
          });

          return Response.json({ success: true });
        }

        if (action === "timeout") {
          const message = await globalChatRepo.byId(messageId);
          if (!message) {
            return Response.json({ error: "message not found" }, { status: 404 });
          }

          const duration = typeof durationMinutes === "number" && durationMinutes > 0
            ? Math.floor(durationMinutes)
            : 15;

          await globalChatRepo.setTimeout(message.user_id, duration);

          notifyGlobalChat({
            type: "moderation",
            action: "timeout",
            userId: message.user_id,
            durationMinutes: duration,
          });

          return Response.json({ success: true, durationMinutes: duration });
        }

        return Response.json({ error: "invalid action" }, { status: 400 });
      },
    },
  },
});
