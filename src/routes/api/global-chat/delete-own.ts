import { createFileRoute } from "@tanstack/react-router";

import { globalChatRepo } from "@/lib/repos.server";
import { getSessionUser } from "@/lib/auth.server";
import { notifyGlobalChat } from "@/routes/api/runner/global-chat";

// POST /api/global-chat/delete-own — authenticated, deletes own message
export const Route = createFileRoute("/api/global-chat/delete-own")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = getSessionUser();
        if (!user) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        let body: { messageId: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const { messageId } = body;
        if (!messageId || typeof messageId !== "string") {
          return Response.json({ error: "invalid messageId" }, { status: 400 });
        }

        const message = await globalChatRepo.byId(messageId);
        if (!message) {
          return Response.json({ error: "message not found" }, { status: 404 });
        }

        if (message.user_id !== user.id) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        await globalChatRepo.deleteMessage(messageId);

        notifyGlobalChat({
          type: "moderation",
          action: "delete",
          messageId,
        });

        return Response.json({ success: true });
      },
    },
  },
});
