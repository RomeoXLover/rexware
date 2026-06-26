import { createFileRoute } from "@tanstack/react-router";

import { globalChatRepo, userWebhooksRepo } from "@/lib/repos.server";
import { getSessionUser } from "@/lib/auth.server";
import { getGlobalChatConfig } from "@/lib/config.server";
import { notifyGlobalChat } from "@/routes/api/runner/global-chat";

// ---------------------------------------------------------------------------
// In-memory rate limiter: 5 messages per 10 seconds per user.
// ---------------------------------------------------------------------------

interface RateLimitEntry { count: number; windowStart: number; }
const _rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(
  userId: string,
  limit = 5,
  windowMs = 10_000,
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = _rateLimits.get(userId);
  if (!entry || now - entry.windowStart > windowMs) {
    _rateLimits.set(userId, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((entry.windowStart + windowMs - now) / 1000) };
  }
  entry.count++;
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Post a message to Discord via the ONE bot webhook for the global chat channel.
// The bot creates and stores this webhook at startup (stored in user_webhooks
// with user_id="rexware-bot"). Messages are sent AS the user by overriding
// username and avatar_url — so they appear as real Discord users.
// ---------------------------------------------------------------------------

async function postToDiscord(
  webhookUrl: string,
  username: string,
  avatarUrl: string | null,
  content: string,
): Promise<void> {
  try {
    const body: Record<string, string> = {
      content,
      username,
    };
    if (avatarUrl) body["avatar_url"] = avatarUrl;

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[global-chat] Webhook post failed: ${res.status}`);
    }
  } catch (err) {
    console.error("[global-chat] Error posting to Discord webhook:", err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/global-chat/send
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/api/global-chat/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = getSessionUser();
        if (!user) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const rateCheck = checkRateLimit(user.id);
        if (!rateCheck.allowed) {
          return Response.json(
            { error: "slow down", retryAfter: rateCheck.retryAfter },
            { status: 429 },
          );
        }

        let body: { content?: string; replyToId?: string; replyToUsername?: string };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "bad json" }, { status: 400 });
        }

        const content = typeof body.content === "string" ? body.content.trim() : "";
        if (!content || content.length > 1000) {
          return Response.json({ error: "invalid content" }, { status: 400 });
        }

        // Save to DB
        const message = await globalChatRepo.post({
          userId: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
          content,
          replyToId: typeof body.replyToId === "string" ? body.replyToId : null,
          replyToUsername: typeof body.replyToUsername === "string" ? body.replyToUsername : null,
          source: "web",
        });

        // Broadcast to all connected website clients immediately
        notifyGlobalChat({ type: "message", message });

        // Mirror to Discord via the bot's single webhook (stored with user_id="rexware-bot").
        // Discord shows the message with the user's name and avatar via webhook override.
        const chatConfig = getGlobalChatConfig();
        if (chatConfig) {
          const botWebhook = await userWebhooksRepo.getForChannel(chatConfig.channelId);
          if (botWebhook) {
            void postToDiscord(
              botWebhook.webhook_url,
              user.username,
              user.avatarUrl,
              content,
            );
          }
        }

        return Response.json({ message });
      },
    },
  },
});
