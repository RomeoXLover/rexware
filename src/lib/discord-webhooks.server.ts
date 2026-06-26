import { getDiscordGuildConfig } from "@/lib/config.server";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Validates that a Discord webhook URL is active by attempting to fetch it with the bot token.
 */
export async function validateDiscordWebhook(webhookUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { botToken } = getDiscordGuildConfig();
    const url = new URL(webhookUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[2] !== "webhooks") {
      return { ok: false, error: "Invalid Discord webhook URL" };
    }
    const webhookId = parts[3];
    const webhookToken = parts[4];
    if (!webhookId || !webhookToken) {
      return { ok: false, error: "Invalid Discord webhook URL" };
    }
    const res = await fetch(`${DISCORD_API}/webhooks/${webhookId}/${webhookToken}`, {
      headers: botToken ? { Authorization: `Bot ${botToken}` } : {},
    });
    if (res.ok) return { ok: true };
    if (res.status === 404) return { ok: false, error: "Webhook not found or has been deleted" };
    return { ok: false, error: "Could not validate webhook" };
  } catch {
    return { ok: false, error: "Invalid webhook URL" };
  }
}
