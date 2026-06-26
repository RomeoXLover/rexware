/**
 * RexWare Discord Bot — channel-specific automations.
 *
 *   1. Media-only channel  — only image attachments are allowed. Anything else
 *      (plain text, links, non-image files) is deleted and the author is DM'd.
 *
 *   2. Suggestions channel — every message is converted into a clean suggestion
 *      card (Components v2) with upvote / downvote buttons and a discussion
 *      thread. The raw message is removed so the channel stays tidy.
 *
 * Channel IDs default to the production values but can be overridden via env.
 */

import type { ButtonInteraction, Message } from "discord.js";
import { ChannelType } from "discord.js";

import { suggestionsRepo } from "../lib/repos.server.js";
import {
  text,
  sep,
  row,
  btn,
  container,
  resetIds,
  COLOR,
  type AnyComponent,
} from "./components.js";

// ---------------------------------------------------------------------------
// Channel configuration
// ---------------------------------------------------------------------------

export const MEDIA_ONLY_CHANNEL_ID =
  process.env.DISCORD_MEDIA_CHANNEL_ID ?? "1514761130063429783";
export const SUGGESTIONS_CHANNEL_ID =
  process.env.DISCORD_SUGGESTIONS_CHANNEL_ID ?? "1515132596407767180";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when a Discord attachment is an image (by mime type or extension). */
function isImageAttachment(att: {
  contentType?: string | null;
  name?: string | null;
}): boolean {
  if (att.contentType?.startsWith("image/")) return true;
  const name = (att.name ?? "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/.test(name);
}

/** Best-effort DM to a user; never throws (DMs may be disabled). */
async function dm(message: Message, components: AnyComponent[]): Promise<void> {
  try {
    await message.author.send({ flags: 32768, components } as never);
  } catch {
    // User has DMs closed — nothing we can do, the delete still stands.
  }
}

// ---------------------------------------------------------------------------
// 1. Media-only channel enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce the image-only rule. Returns true if the message belonged to the
 * media channel (handled here), so the caller can stop further processing.
 */
export async function handleMediaOnlyMessage(message: Message): Promise<boolean> {
  if (message.channelId !== MEDIA_ONLY_CHANNEL_ID) return false;

  const attachments = [...message.attachments.values()];
  const hasImage = attachments.length > 0 && attachments.every((a) => isImageAttachment(a));

  // A valid post: at least one attachment and every attachment is an image.
  if (hasImage) return true;

  // Otherwise remove it and tell the author why.
  try {
    await message.delete();
  } catch {
    // Missing permissions or already deleted — ignore.
  }

  resetIds();
  await dm(message, [
    container(
      [
        text("## Only photos allowed"),
        sep(false),
        text(
          `Your message in <#${MEDIA_ONLY_CHANNEL_ID}> was removed.\n\n` +
            "This channel only accepts **image attachments** (photos). " +
            "Plain text, links, and non-image files aren't allowed here.",
        ),
        sep(false),
        text("Please re-post your content as an image. Thanks for keeping the channel clean!"),
      ],
      COLOR.warning,
    ),
  ]);

  return true;
}

// ---------------------------------------------------------------------------
// 2. Suggestions system
// ---------------------------------------------------------------------------

function buildSuggestionCard(
  s: { id: string; author_id: string; content: string; status: string },
  counts: { up: number; down: number },
): AnyComponent[] {
  resetIds();

  const score = counts.up - counts.down;
  const statusLine: Record<string, string> = {
    open: "🗳️ Open for voting",
    approved: "✅ Approved",
    denied: "⛔ Denied",
    implemented: "🚀 Implemented",
  };

  const accent =
    s.status === "approved" || s.status === "implemented"
      ? COLOR.success
      : s.status === "denied"
        ? COLOR.danger
        : COLOR.primary;

  return [
    container(
      [
        text("## 💡 New Suggestion"),
        sep(true),
        text(s.content),
        sep(false),
        text(
          `**Submitted by:** <@${s.author_id}>\n` +
            `**Status:** ${statusLine[s.status] ?? s.status}\n` +
            `**Score:** ${score >= 0 ? "+" : ""}${score}  (👍 ${counts.up} · 👎 ${counts.down})`,
        ),
        sep(false),
        row(
          btn(`Upvote (${counts.up})`, 3, {
            customId: `sugg_vote:${s.id}:up`,
            emoji: { name: "👍" },
          }),
          btn(`Downvote (${counts.down})`, 4, {
            customId: `sugg_vote:${s.id}:down`,
            emoji: { name: "👎" },
          }),
        ),
      ],
      accent,
    ),
  ];
}

/**
 * Convert a raw message in the suggestions channel into a suggestion card.
 * Returns true when the message belonged to the suggestions channel.
 */
export async function handleSuggestionMessage(message: Message): Promise<boolean> {
  if (message.channelId !== SUGGESTIONS_CHANNEL_ID) return false;

  const content = message.content.trim();

  // Ignore empty / attachment-only posts: a suggestion needs text.
  if (!content) {
    try {
      await message.delete();
    } catch {
      /* ignore */
    }
    resetIds();
    await dm(message, [
      container(
        [
          text("## Write your suggestion"),
          sep(false),
          text(
            `Posts in <#${SUGGESTIONS_CHANNEL_ID}> must contain text describing your idea. ` +
              "Please send your suggestion as a message and the bot will format it with voting buttons.",
          ),
        ],
        COLOR.warning,
      ),
    ]);
    return true;
  }

  // Persist first so we have a stable id for the button custom_ids.
  const suggestion = await suggestionsRepo.create({
    channelId: message.channelId,
    authorId: message.author.id,
    authorTag: message.author.tag,
    content: content.slice(0, 2000),
  });

  // Remove the raw message to keep the channel clean.
  try {
    await message.delete();
  } catch {
    /* ignore */
  }

  const channel = message.channel;
  if (!channel || !("send" in channel)) return true;

  const counts = { up: 0, down: 0 };
  const sent = await (channel as { send: (p: unknown) => Promise<Message> }).send({
    flags: 32768,
    components: buildSuggestionCard(suggestion, counts),
  });

  // Spin up a discussion thread so people can debate the idea.
  let threadId: string | null = null;
  try {
    if (channel.type === ChannelType.GuildText) {
      const thread = await sent.startThread({
        name: `Suggestion · ${message.author.username}`.slice(0, 90),
        autoArchiveDuration: 1440,
      });
      threadId = thread.id;
    }
  } catch {
    // Threads may be disabled / missing permission — non-fatal.
  }

  await suggestionsRepo.setMessage(suggestion.id, sent.id, threadId);
  return true;
}

/**
 * Handle an upvote / downvote button press on a suggestion card.
 * customId format: `sugg_vote:<suggestionId>:<up|down>`
 */
export async function handleSuggestionVote(
  i: ButtonInteraction,
  suggestionId: string,
  dir: string,
): Promise<void> {
  const suggestion = await suggestionsRepo.byId(suggestionId);
  if (!suggestion) {
    await i.reply({ content: "This suggestion no longer exists.", ephemeral: true }).catch(() => null);
    return;
  }

  const counts = await suggestionsRepo.vote(suggestionId, i.user.id, dir === "up" ? 1 : -1);

  // Edit the card in place to reflect the new tally.
  await i
    .update({
      flags: 32768,
      components: buildSuggestionCard(suggestion, counts),
    } as never)
    .catch(() => null);
}
