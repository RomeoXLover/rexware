/**
 * RexWare AI handlers — /ai toggle + @mention + DM message handling.
 *
 * Call setupMainBot(client) in the ready handler of src/bot/index.ts.
 *
 * Features:
 *   /ai           — Toggles AI replies on/off for the user (DMs + @mentions).
 *                   The toggle is persisted in the DB, so it survives restarts.
 *   @RexWare ... — AI replies in server channels (only if user has toggled AI on)
 *   DMs           — AI replies in DMs (only if user has toggled AI on)
 *   Moderation    — When an admin chats with the AI in a server, it can perform
 *                   moderation actions (mute, unmute, kick, ban, warn, purge)
 *                   through tool calling.
 *   Auto-cleanup  — AI replies (and the prompts that triggered them) are deleted
 *                   from server channels after a short delay to keep chat tidy.
 */

import type { Client, Message, TextChannel } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { Events } from "discord.js";
import {
  generateReply,
  isAiEnabled,
  toggleAi,
  loadAiState,
  type ModExecutor,
} from "./mainbot-ai.js";
import {
  usersRepo,
  auditRepo,
  warnsRepo,
  notificationsRepo,
  botSettingsRepo,
} from "../lib/repos.server.js";
import { isOwnerId } from "../lib/config.server.js";

// ---------------------------------------------------------------------------
// Static auto-reply config — read from bot_settings so the TS bot can reply
// without needing a Docker container for simple static replies.
// ---------------------------------------------------------------------------
interface StaticReplyConfig {
  message: string;
  enabled: boolean;
}

let staticReply: StaticReplyConfig = { message: "", enabled: false };

async function loadStaticReplyConfig() {
  const [msg, enabled] = await Promise.all([
    botSettingsRepo.get("autoreply_message"),
    botSettingsRepo.get("autoreply_enabled"),
  ]);
  staticReply = { message: msg ?? "", enabled: enabled === "1" };
  console.log(`[mainbot] Static auto-reply loaded: enabled=${staticReply.enabled} message=${JSON.stringify(staticReply.message.slice(0, 40))}`);
}
void loadStaticReplyConfig();

// Re-check bot_settings every 30s so dashboard saves take effect immediately.
setInterval(() => { void loadStaticReplyConfig(); }, 30_000);

// How long AI replies + their prompts live in a server channel before being
// auto-deleted. DM messages are never auto-deleted (the bot can't delete the
// user's own DMs, and DM history is private anyway).
const AI_MESSAGE_TTL_MS = 2 * 60 * 1000; // 2 minutes

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delete a message after `ttl` ms, swallowing any errors. */
function scheduleDelete(message: Message, ttl = AI_MESSAGE_TTL_MS) {
  setTimeout(() => {
    message.delete().catch(() => null);
  }, ttl).unref?.();
}

/** Send a (possibly chunked) reply and return every message we created. */
async function sendReply(message: Message, content: string): Promise<Message[]> {
  const CHUNK_SIZE = 1900;
  const sent: Message[] = [];
  if (content.length <= CHUNK_SIZE) {
    const m = await message.reply(content).catch(() => null);
    if (m) sent.push(m);
  } else {
    const first = await message.reply(content.slice(0, CHUNK_SIZE)).catch(() => null);
    if (first) sent.push(first);
    const channel = message.channel;
    for (let offset = CHUNK_SIZE; offset < content.length; offset += CHUNK_SIZE) {
      const chunk = content.slice(offset, offset + CHUNK_SIZE);
      if (!channel.isSendable()) break;
      const m = await channel.send(chunk).catch(() => null);
      if (m) sent.push(m);
    }
  }
  return sent;
}

/**
 * Build the moderation executor for a given message. The AI calls these tools
 * by name; each performs the real Discord side-effect and returns a short
 * human-readable result that is fed back to the model.
 */
function buildModExecutor(message: Message, client: Client): ModExecutor {
  return async (name, args) => {
    const guild = message.guild;
    if (!guild) return "No server context — moderation only works in a server channel.";

    const actorRow = await usersRepo.byDiscordId(message.author.id);
    const actorId = actorRow?.id ?? message.author.id;
    const targetId = String(args.user_id ?? "").trim();
    const reason = (typeof args.reason === "string" && args.reason.trim()) || "Via RexWare AI";

    switch (name) {
      case "timeout_member": {
        if (!targetId) return "Missing target user.";
        const minutes = clamp(Number(args.minutes) || 10, 1, 10080);
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (!member) return "Member not found in this server.";
        try {
          await member.timeout(minutes * 60 * 1000, reason);
        } catch {
          return "Failed to mute — check the bot's permissions and role hierarchy.";
        }
        await auditRepo.log({ actorId, action: "discord_mute", targetId, detail: `${minutes}m via AI: ${reason}` });
        return `Muted ${member.user.tag} for ${minutes} minute(s).`;
      }

      case "remove_timeout": {
        if (!targetId) return "Missing target user.";
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (!member) return "Member not found in this server.";
        try {
          await member.timeout(null);
        } catch {
          return "Failed to remove the timeout — check the bot's permissions.";
        }
        await auditRepo.log({ actorId, action: "discord_unmute", targetId, detail: "via AI" });
        return `Removed timeout from ${member.user.tag}.`;
      }

      case "kick_member": {
        if (!targetId) return "Missing target user.";
        const member = await guild.members.fetch(targetId).catch(() => null);
        if (!member) return "Member not found in this server.";
        try {
          await member.kick(reason);
        } catch {
          return "Failed to kick — check the bot's permissions and role hierarchy.";
        }
        await auditRepo.log({ actorId, action: "discord_kick", targetId, detail: `via AI: ${reason}` });
        return `Kicked ${member.user.tag}.`;
      }

      case "ban_member": {
        if (!targetId) return "Missing target user.";
        const member = await guild.members.fetch(targetId).catch(() => null);
        const tag = member?.user.tag ?? targetId;
        try {
          await guild.members.ban(targetId, { reason });
        } catch {
          return "Failed to ban — check the bot's permissions and role hierarchy.";
        }
        // Also suspend the RexWare account if one exists.
        const targetUser = await usersRepo.byDiscordId(targetId);
        if (targetUser) {
          await usersRepo.setBanned(targetUser.id, true).catch(() => null);
          await notificationsRepo.create({
            userId: targetUser.id,
            type: "system",
            title: "Account suspended",
            body: `Your account has been suspended. Reason: ${reason}`,
          }).catch(() => null);
        }
        await auditRepo.log({ actorId, action: "ban", targetId, detail: `via AI: ${reason}` });
        return `Banned ${tag}.`;
      }

      case "warn_member": {
        if (!targetId) return "Missing target user.";
        await warnsRepo.add({ userId: targetId, issuedBy: actorId, reason });
        await auditRepo.log({ actorId, action: "warn", targetId, detail: `via AI: ${reason}` });
        const count = await warnsRepo.count(targetId).catch(() => 0);
        return `Warned the member. They now have ${count} warning(s).`;
      }

      case "purge_messages": {
        const channel = message.channel as TextChannel;
        if (typeof channel.bulkDelete !== "function") return "Can't purge messages in this channel type.";
        const amount = clamp(Number(args.amount) || 10, 1, 100);
        let deleted = 0;
        try {
          const msgs = await channel.bulkDelete(amount, true);
          deleted = msgs.size;
        } catch {
          return "Failed to purge — messages older than 14 days can't be bulk-deleted.";
        }
        await auditRepo.log({ actorId, action: "discord_purge", targetId: message.channelId, detail: `${deleted} via AI` });
        return `Deleted ${deleted} message(s).`;
      }

      default:
        return `Unknown action: ${name}`;
    }
  };
}

async function handleAiMessage(message: Message, question: string, client: Client) {
  const userId = message.author.id;

  if (!isAiEnabled(userId)) return;

  try {
    if ("sendTyping" in message.channel) await message.channel.sendTyping();
  } catch { /* non-fatal */ }

  // Enable moderation tools only when the requester is an admin OR an owner chatting
  // in a server (moderation makes no sense in DMs).
  const inGuild = !message.channel.isDMBased() && Boolean(message.guild);
  let moderation: { execute: ModExecutor; contextNote?: string } | undefined;

  if (inGuild) {
    const actor = await usersRepo.byDiscordId(userId).catch(() => undefined);
    // Moderation access for admins OR owners
    const isModerator = actor?.is_admin === 1 || isOwnerId(userId);
    if (isModerator) {
      const targets = message.mentions.users
        .filter((u) => u.id !== client.user?.id && u.id !== userId)
        .map((u) => `- ${u.tag} (id: ${u.id})`);
      const contextNote = targets.length
        ? `\n\nAvailable moderation targets (mentioned in the request):\n${targets.join("\n")}`
        : "\n\nNo target users were mentioned. Ask the admin to @mention the member to act on.";
      moderation = { execute: buildModExecutor(message, client), contextNote };
    }
  }

  const { reply } = await generateReply(userId, question, { useHistory: true, moderation });
  const sent = await sendReply(message, reply);

  // Auto-cleanup in server channels: remove the AI replies and the prompt that
  // triggered them after a short delay. Skipped in DMs.
  if (inGuild) {
    for (const m of sent) scheduleDelete(m);
    scheduleDelete(message);
  }
}

// ---------------------------------------------------------------------------
// Public setup
// ---------------------------------------------------------------------------

export async function setupMainBot(client: Client) {
  // Restore persisted /ai toggles so users who enabled AI before a restart
  // keep it on.
  await loadAiState();

  // ── /ai toggle ──────────────────────────────────────────────────────────
  async function handleAiToggle(i: ChatInputCommandInteraction) {
    const enabled = await toggleAi(i.user.id);
    await i.reply(
      enabled
        ? "**AI replies enabled.** I'll now respond when you DM me or @mention me in a channel. This stays on across restarts."
        : "**AI replies disabled.** I won't respond to your DMs or mentions until you toggle back on with `/ai`.",
    );
  }

  // ── MessageCreate — DMs + @mentions ────────────────────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    // DM messages can arrive as partials — fetch the full message so its
    // content and author are populated before we read them.
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch {
        return;
      }
    }

    if (message.author.bot) return;

    const content = message.content.trim();
    if (!content || content.length < 2) return;

    // DM: static auto-reply (if configured) OR AI chat if enabled
    if (message.channel.isDMBased()) {
      // Static reply — fires regardless of /ai toggle, as long as it's configured
      if (staticReply.enabled && staticReply.message.trim()) {
        try {
          // Typing indicator + humanised delay
          if ("sendTyping" in message.channel) await message.channel.sendTyping();
          const delay = 1_500 + Math.random() * 1_500;
          await new Promise((r) => setTimeout(r, delay));
          await message.reply(staticReply.message);
          console.log(`[mainbot] Static reply sent to ${message.author.tag}`);
        } catch (err) {
          console.error("[mainbot] Static reply failed:", err);
        }
        return; // static reply wins; skip AI
      }
      // Fall through to AI if enabled
      await handleAiMessage(message, content, client);
      return;
    }

    // Server: only respond when @mentioned AND user has AI enabled
    if (!message.mentions.has(client.user!)) return;

    let question = content
      .replace(/<@!?\d+>/g, "")
      .replace(/@(?:everyone|here)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (!question) question = "hi";

    await handleAiMessage(message, question, client);
  });

  // ── InteractionCreate — /ai ─────────────────────────────────────────────
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === "ai") {
      await handleAiToggle(interaction).catch((err) => {
        console.error("[mainbot] /ai error:", err);
        interaction
          .reply({ content: "An error occurred. Please try again.", ephemeral: true })
          .catch(() => null);
      });
    }
  });

  console.log("[mainbot] Handlers attached — /ai, @mentions, DMs, and AI moderation are active.");
}
