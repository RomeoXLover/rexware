/**
 * RexWare Discord Bot — main entry point.
 *
 * Run with:
 *   npx tsx src/bot/index.ts
 *
 * Required env vars:
 *   DISCORD_BOT_TOKEN
 *   DISCORD_CLIENT_ID
 *   DISCORD_GUILD_ID
 *
 * Optional env vars:
 *   APP_BASE_URL                — base URL for dashboard links
 *   DISCORD_TICKETS_CATEGORY    — category name for ticket channels (default: "Tickets")
 *   DISCORD_SUPPORT_ROLE_ID     — role that can see all ticket channels
 *   DISCORD_TICKET_ARCHIVE_PREFIX — prefix for archived ticket channel names (default: "closed-")
 *   DISCORD_TICKET_ARCHIVE_DELAY_MS — ms delay before archiving a closed ticket (default: 5000)
 *   DISCORD_WELCOME_CHANNEL_ID  — channel for public welcome messages
 *   DATABASE_PATH               — path to SQLite db (default: ./data/rexware.db)
 */

import "dotenv/config";
import process from "node:process";
import net from "node:net";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Message,
} from "discord.js";

import { COMMANDS } from "./commands.js";
import { ensureSchema } from "../lib/db.server.js";
import {
  ticketsRepo,
  dmQueueRepo,
  botRunsRepo,
  subscriptionsRepo,
  plansRepo,
  botSettingsRepo,
  userWebhooksRepo,
} from "../lib/repos.server.js";
import { getGlobalChatConfig } from "../lib/config.server.js";
import { isDockerAvailable, stopAndRemoveContainer } from "../lib/docker.server.js";
import { isOwnerId } from "../lib/config.server.js";

// Ensure DB schema is initialized before any repos are used
void ensureSchema();

import {
  handlePing,
  handleInfo,
  handlePlan,
  handleHelp,
  handleFaq,
  handleTos,
  handleReview,
  handleReviewApprove,
  handleReviewReject,
  handleAdminPostTos,
  handleAdminPostPricelist,
  handleAdminPostRules,
  handleTicketOpen,
  handleTicketClose,
  handleTicketStatus,
  handleTicketReopen,
  handleWelcomeSetup,
  handleAdminTicketPanel,
  handleAdminStats,
  handleAdminUserInfo,
  handleAdminBan,
  handleAdminUnban,
  handleAdminModKick,
  handleAdminModMute,
  handleAdminModUnmute,
  handleAdminModPurge,
  handleAdminGrantAdmin,
  handleAdminRevokeAdmin,
  handleAdminSubscription,
  handleAdminWarn,
  handleAdminWarns,
  handleAdminNoteAdd,
  handleAdminNotes,
  handleAdminSubscriptionSet,
  handleAdminSubscriptionRevoke,
  handleAdminTicketList,
  handleAdminTicketClose,
  handleAdminTicketClaim,
  handleAdminTicketPriority,
  handleAdminIpBan,
  handleAdminIpUnban,
  handleAdminIpList,
  handleAdminAnnounce,
  handleAdminBroadcast,
  handleAdminAudit,
  handleAdminServer,
  handleAdminProxyAdd,
  handleAdminProxyRemove,
  handleAdminProxyList,
  handleAdminProxyAssign,
  handleButtonTicketClose,
  handleButtonAdminClaim,
  handleButtonAdminClose,
  handleButtonTicketOpenModal,
  handleModalTicketOpen,
  handleGuildMemberAdd,
  handleTrialRoleAssign,
  handleExpiredTrialRoles,
} from "./handlers.js";

import {
  handleOtpConfirmButton,
  handleOtpCancelButton,
  handleOtpModal,
} from "./otp.js";

import {
  handleMediaOnlyMessage,
  handleSuggestionMessage,
  handleSuggestionVote,
} from "./channels.js";

import { setupMainBot } from "./mainbot-handlers.js";

// ---------------------------------------------------------------------------
// Validate required env vars
// ---------------------------------------------------------------------------

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("[bot] DISCORD_BOT_TOKEN is not set. Exiting.");
  process.exit(1);
}

/**
 * Check if a Discord user ID is an owner (bypasses all permission checks).
 */
function isOwner(userId: string): boolean {
  return isOwnerId(userId);
}

// ---------------------------------------------------------------------------
// Create client
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
  ],
  // Partials are REQUIRED to receive DM events: direct-message channels (and
  // their messages) are often uncached, so without these the MessageCreate
  // event never fires for DMs.
  partials: [Partials.Channel, Partials.Message],
});

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Global Chat webhook — create and store the bot's own webhook for the global
// chat Discord channel so the web app can mirror messages there.
// Called on startup and then every 6h to handle Discord webhook rotation.
// ---------------------------------------------------------------------------

const _GLOBAL_CHAT_WEBHOOK_BOT_USER_ID = "rexware-bot"; // sentinel user_id in user_webhooks

async function _ensureGlobalChatWebhook(client: Client) {
  const chatConfig = getGlobalChatConfig();
  if (!chatConfig) return;

  try {
    const channel = await client.channels.fetch(chatConfig.channelId);
    if (!channel || !channel.isTextBased()) {
      console.warn("[bot] Global chat channel not found or not text-based:", chatConfig.channelId);
      return;
    }

    // Check if we already have a valid webhook stored
    const existing = await userWebhooksRepo.getForChannel(chatConfig.channelId);
    if (existing && existing.user_id === _GLOBAL_CHAT_WEBHOOK_BOT_USER_ID) {
      // Still valid — Discord doesn't expire webhooks, so we're done
      return;
    }

    // Create a new webhook for the channel
    let webhook;
    try {
      webhook = await (channel as { createWebhook?: (o: object) => Promise<unknown> }).createWebhook!({
        name: "RexWare Global",
        avatar: client.user?.displayAvatarURL({ size: 128 }),
      });
    } catch (createErr: unknown) {
      const errCode = (createErr as { code?: number } | null)?.code;
      // If we lack permission to create, try to find an existing one
      if (errCode === 50013) {
        const hooks = await (channel as { fetchWebhooks?: () => Promise<unknown> }).fetchWebhooks?.().catch(() => null);
        if (hooks) {
          const hookMap = hooks as Map<string, { id: string; name?: string; url?: string }>;
          webhook = [...hookMap.values()].find((h) => h.name === "RexWare Global") ?? [...hookMap.values()][0];
        }
      }
      if (!webhook) throw createErr;
    }

    const webhookUrl = (webhook as { url?: string }).url ?? "";
    // Discord webhook URLs: https://discord.com/api/webhooks/<id>/<token>
    const urlParts = webhookUrl.replace("https://discord.com/api/webhooks/", "").split("/");
    const webhookId = urlParts[0];
    const webhookToken = urlParts[1] ?? "";

    await userWebhooksRepo.set(_GLOBAL_CHAT_WEBHOOK_BOT_USER_ID, chatConfig.channelId, webhookUrl, webhookToken);
    console.log("[bot] Global chat webhook stored:", webhookUrl.slice(0, 60) + "...");
  } catch (err) {
    console.error("[bot] Failed to set up global chat webhook:", err);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag} (${c.user.id})`);
  console.log(`[bot] Serving ${c.guilds.cache.size} guild(s)`);

  // Set up global chat webhook so the web app can mirror messages to Discord
  await _ensureGlobalChatWebhook(c);
  setInterval(() => { void _ensureGlobalChatWebhook(c); }, 6 * 60 * 60 * 1000);
  console.log("[bot] Global chat webhook poller started (every 6h).");

  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!clientId || !guildId) {
    console.warn("[bot] DISCORD_CLIENT_ID or DISCORD_GUILD_ID not set — skipping command registration.");
    return;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(token);

    // Wipe every existing command (global + this guild) before re-registering,
    // so stale or duplicated commands never linger in the slash-command picker.
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log("[bot] Cleared all global commands.");

    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
    console.log(`[bot] Cleared all guild commands for ${guildId}.`);

    // Re-register the current command set fresh.
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS });
    console.log(`[bot] Re-registered ${COMMANDS.length} slash commands to guild ${guildId}.`);
  } catch (err) {
    console.error("[bot] Failed to register slash commands:", err);
  }

  // Start polling the DM queue for premium ticket notifications.
  setInterval(() => {
    drainDmQueue().catch((err) => console.error("[bot] drainDmQueue error:", err));
  }, 5000);
  console.log("[bot] DM queue poller started (every 5s).");

  // RexWare AI: /ai toggle, @mention replies, and DM chat
  await setupMainBot(client);

  // Watchdog: stop bots that have exceeded their plan's daily bot-hours limit.
  setInterval(() => {
    enforceHourLimits().catch((err) => console.error("[bot] enforceHourLimits error:", err));
  }, 60_000);
  void enforceHourLimits().catch((err) => console.error("[bot] enforceHourLimits error:", err));
  console.log("[bot] Daily hour-limit watchdog started (every 60s).");

  // Trial role expiry: periodically remove trial roles from expired members.
  const guild = c.guilds.cache.first();
  if (guild) {
    setInterval(async () => {
      try {
        await handleExpiredTrialRoles(guild);
      } catch (err) {
        console.error("[bot] Trial role expiry check error:", err);
      }
    }, 60_000);
    console.log("[bot] Trial role expiry watchdog started (every 60s).");
  }
});

// ---------------------------------------------------------------------------
// Daily hour-limit watchdog — kills running bots whose owner has used up their
// plan's daily bot-hours allowance (plans.bot_hours; -1 = unlimited).
// ---------------------------------------------------------------------------

async function enforceHourLimits() {
  const runs = await botRunsRepo.activeRuns();
  if (runs.length === 0) return;

  // Cache per-user daily limits so we don't re-query the plan for each run.
  const limitCache = new Map<string, number>();
  async function limitFor(userId: string): Promise<number> {
    if (limitCache.has(userId)) return limitCache.get(userId)!;
    let hours = -1;
    const sub = await subscriptionsRepo.activeForUser(userId);
    if (!sub) {
      hours = 0; // no active plan => not allowed to run
    } else {
      const plan = await plansRepo.byId(sub.plan_id);
      hours = plan?.bot_hours ?? -1;
    }
    limitCache.set(userId, hours);
    return hours;
  }

  const dockerUp = await isDockerAvailable();

  for (const run of runs) {
    const limitHours = await limitFor(run.user_id);
    if (limitHours < 0) continue; // unlimited

    // Daily quota: total bot-hours the user has accumulated since UTC midnight
    // across ALL their runs. This count survives bot deletion (bot_runs rows
    // are kept, see migration in db.server.ts), so deleting + recreating a bot
    // no longer hands the user a fresh allowance.
    const usedMs = await botRunsRepo.usedMsToday(run.user_id);
    if (usedMs < limitHours * 3_600_000) continue; // still within quota

    console.log(
      `[bot] Hour limit reached for user ${run.user_id} (${limitHours}h) — stopping run ${run.id}.`,
    );
    if (run.container_id && dockerUp) {
      try {
        await stopAndRemoveContainer(run.container_id);
      } catch (err) {
        console.error(`[bot] Failed to stop container for run ${run.id}:`, err);
      }
    }
    await botRunsRepo.setStatus(run.id, "stopped", {
      error: "Daily bot-hours limit reached",
    });
  }
}

// ---------------------------------------------------------------------------
// DM queue drain — delivers premium ticket reply notifications to users.
// The web app enqueues rows into dm_queue; the bot polls and sends Components
// V2 DMs to the target Discord user.
// ---------------------------------------------------------------------------

async function drainDmQueue() {
  const pending = await dmQueueRepo.pending(10);
  if (pending.length === 0) {
    console.log("[bot] DM queue: empty");
    return;
  }
  console.log(`[bot] DM queue: processing ${pending.length} message(s)`);
  for (const dm of pending) {
    try {
      const user = await client.users.fetch(dm.discord_id);
      const components: Record<string, unknown>[] = [
        { type: 10, content: `## ${dm.title}` },
        { type: 14, divider: true },
        { type: 10, content: dm.body },
      ];
      if (dm.url) {
        components.push({ type: 14, divider: false });
        components.push({
          type: 1,
          components: [{ type: 2, style: 5, label: "Open Dashboard", url: dm.url }],
        });
      }
      await user.send({
        flags: 32768, // IsComponentsV2
        components: [{ type: 17, accent_color: 0x5865f2, components }],
      } as never);
      await dmQueueRepo.markSent(dm.id);
      console.log(`[bot] DM delivered → ${dm.discord_id}: ${dm.title}`);
    } catch (err) {
      console.error(`[bot] Failed to deliver DM ${dm.id} to ${dm.discord_id}:`, err);
      await dmQueueRepo.markFailed(dm.id);
    }
  }
}

// ---------------------------------------------------------------------------
// GuildMemberAdd — send welcome DM + optional public message
// ---------------------------------------------------------------------------

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await handleGuildMemberAdd(member);
    await handleTrialRoleAssign(member);
  } catch (err) {
    console.error("[bot] GuildMemberAdd error:", err);
  }
});

// ---------------------------------------------------------------------------
// InteractionCreate — commands, buttons, modals
// ---------------------------------------------------------------------------

// Each Discord interaction token is single-use. If the same interaction is
// dispatched twice (duplicate event listeners after a hot reload, or two bot
// processes sharing one token), the second response fails with
// "Unknown interaction" (10062) or "already acknowledged" (40060). Track the
// IDs we've already started handling and ignore repeats.
const handledInteractions = new Set<string>();

function alreadyHandled(id: string): boolean {
  if (handledInteractions.has(id)) return true;
  handledInteractions.add(id);
  // Tokens are valid for ~15 minutes; drop the id well after it can't be reused.
  setTimeout(() => handledInteractions.delete(id), 15 * 60 * 1000).unref?.();
  return false;
}

// Discord interaction tokens are single-use and expire after ~3s. When another
// bot instance (or a stale token) wins the race to respond, this instance gets
// "Unknown interaction" (10062) or "already acknowledged" (40060). These are
// expected during a duplicate-instance situation and should not spam the logs.
function isInteractionRaceError(err: unknown): boolean {
  const code = (err as { code?: number } | null)?.code;
  return code === 10062 || code === 40060;
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (alreadyHandled(interaction.id)) {
    console.warn(`[bot] Ignoring duplicate interaction ${interaction.id}`);
    return;
  }

  // --- Slash commands ---
  if (interaction.isChatInputCommand()) {
    const cmd = interaction as ChatInputCommandInteraction;
    const name = cmd.commandName;
    const sub = cmd.options.getSubcommand(false);
    const subGroup = cmd.options.getSubcommandGroup(false);

    try {
      // /ping
      if (name === "ping") {
        await handlePing(cmd);
        return;
      }

      // /review
      if (name === "review") {
        if (!cmd.guild) {
          await cmd.reply({ content: "This command can only be used in a server.", ephemeral: true });
          return;
        }
        await handleReview(cmd, cmd.guild);
        return;
      }

      // /info
      if (name === "info") {
        await handleInfo(cmd);
        return;
      }

      // /plan
      if (name === "plan") {
        await handlePlan(cmd);
        return;
      }

      // /help
      if (name === "help") {
        await handleHelp(cmd);
        return;
      }

      // /faq
      if (name === "faq") {
        await handleFaq(cmd);
        return;
      }

      // /tos
      if (name === "tos") {
        await handleTos(cmd);
        return;
      }

      // /ticket
      if (name === "ticket") {
        if (!cmd.guild) {
          await cmd.reply({ content: "This command can only be used in a server.", ephemeral: true });
          return;
        }
        if (sub === "open") await handleTicketOpen(cmd, cmd.guild);
        else if (sub === "close") await handleTicketClose(cmd);
        else if (sub === "status") await handleTicketStatus(cmd);
        else if (sub === "reopen") await handleTicketReopen(cmd);
        return;
      }

      // /welcome (top-level, for users)
      if (name === "welcome") {
        if (sub === "setup") await handleWelcomeSetup(cmd);
        return;
      }

      // /admin
      if (name === "admin") {
        // Owners bypass all permission checks for admin commands
        const isAdminOwner = isOwner(cmd.user.id);

        // --- /admin ticket ---
        if (subGroup === "ticket") {
          if (sub === "panel") await handleAdminTicketPanel(cmd);
          else if (sub === "list") await handleAdminTicketList(cmd);
          else if (sub === "close") await handleAdminTicketClose(cmd);
          else if (sub === "claim") await handleAdminTicketClaim(cmd);
          else if (sub === "priority") await handleAdminTicketPriority(cmd);
          return;
        }

        // --- /admin user ---
        if (subGroup === "user") {
          if (sub === "info") await handleAdminUserInfo(cmd);
          else if (sub === "ban") await handleAdminBan(cmd);
          else if (sub === "unban") await handleAdminUnban(cmd);
          else if (sub === "grant-admin") await handleAdminGrantAdmin(cmd);
          else if (sub === "revoke-admin") await handleAdminRevokeAdmin(cmd);
          else if (sub === "subscription") await handleAdminSubscription(cmd);
          else if (sub === "warn") await handleAdminWarn(cmd);
          else if (sub === "warns") await handleAdminWarns(cmd);
          else if (sub === "note-add") await handleAdminNoteAdd(cmd);
          else if (sub === "notes") await handleAdminNotes(cmd);
          else if (sub === "gift") {
            // Handled inside handleAdminSubscriptionSet
            await handleAdminSubscriptionSet(cmd);
          }
          return;
        }

        // --- /admin subscription ---
        if (subGroup === "subscription") {
          if (sub === "set") await handleAdminSubscriptionSet(cmd);
          else if (sub === "revoke") await handleAdminSubscriptionRevoke(cmd);
          return;
        }

        // --- /admin mod ---
        if (subGroup === "mod") {
          if (sub === "kick") await handleAdminModKick(cmd);
          else if (sub === "mute") await handleAdminModMute(cmd);
          else if (sub === "unmute") await handleAdminModUnmute(cmd);
          else if (sub === "purge") await handleAdminModPurge(cmd);
          return;
        }

        // --- /admin welcome ---
        if (subGroup === "welcome") {
          if (sub === "setup") await handleWelcomeSetup(cmd);
          return;
        }

        // --- /admin ip ---
        if (subGroup === "ip") {
          if (sub === "ban") await handleAdminIpBan(cmd);
          else if (sub === "unban") await handleAdminIpUnban(cmd);
          else if (sub === "list") await handleAdminIpList(cmd);
          return;
        }

        // --- /admin proxy ---
        if (subGroup === "proxy") {
          if (sub === "add") await handleAdminProxyAdd(cmd);
          else if (sub === "remove") await handleAdminProxyRemove(cmd);
          else if (sub === "list") await handleAdminProxyList(cmd);
          else if (sub === "assign") await handleAdminProxyAssign(cmd);
          return;
        }

        // --- /admin post ---
        if (subGroup === "post") {
          if (sub === "tos") await handleAdminPostTos(cmd);
          else if (sub === "pricelist") await handleAdminPostPricelist(cmd);
          else if (sub === "rules") await handleAdminPostRules(cmd);
          return;
        }

        // --- /admin top-level subcommands ---
        if (sub === "stats") await handleAdminStats(cmd);
        else if (sub === "server") await handleAdminServer(cmd);
        else if (sub === "audit") await handleAdminAudit(cmd);
        else if (sub === "broadcast") await handleAdminBroadcast(cmd);
        else if (sub === "announce") await handleAdminAnnounce(cmd);
        else if (sub === "ticket-panel") await handleAdminTicketPanel(cmd);
        return;
      }

      // /owner — owner-only commands (bypass Discord admin permission)
      if (name === "owner") {
        // Only owners can use these commands
        if (!isOwner(cmd.user.id)) {
          await cmd.reply({ content: "Only bot owners can use this command.", ephemeral: true });
          return;
        }

        const subGroup = cmd.options.getSubcommandGroup(false);
        const sub = cmd.options.getSubcommand(false);

        // --- /owner user ---
        if (subGroup === "user") {
          if (sub === "info") await handleAdminUserInfo(cmd);
          else if (sub === "ban") await handleAdminBan(cmd);
          else if (sub === "unban") await handleAdminUnban(cmd);
          else if (sub === "grant-admin") await handleAdminGrantAdmin(cmd);
          else if (sub === "revoke-admin") await handleAdminRevokeAdmin(cmd);
          return;
        }

        // --- /owner top-level subcommands ---
        if (sub === "stats") await handleAdminStats(cmd);
        else if (sub === "audit") await handleAdminAudit(cmd);
        else if (sub === "broadcast") await handleAdminBroadcast(cmd);
        else if (sub === "announce") await handleAdminAnnounce(cmd);
        return;
      }
    } catch (err) {
      if (isInteractionRaceError(err)) {
        console.warn(`[bot] Skipped /${name}: interaction already handled by another instance.`);
        return;
      }
      console.error(`[bot] Error in /${name}:`, err);
      const errPayload = {
        flags: 32832, // IsComponentsV2 | Ephemeral
        components: [
          {
            type: 17,
            accent_color: 0xed4245,
            components: [
              { type: 10, content: "## Internal Error" },
              { type: 14, divider: false },
              { type: 10, content: "An unexpected error occurred. Please try again or contact support." },
            ],
          },
        ],
      };
      if (cmd.deferred || cmd.replied) {
        await cmd.editReply(errPayload).catch(() => null);
      } else {
        await cmd.reply({ ...errPayload, ephemeral: true } as never).catch(() => null);
      }
    }
    return;
  }

  // --- Button interactions ---
  if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    const [action, ...parts] = btn.customId.split(":");
    const arg = parts.join(":");

    try {
      if (action === "ticket_close") {
        await handleButtonTicketClose(btn, arg);
        return;
      }
      if (action === "admin_ticket_claim") {
        await handleButtonAdminClaim(btn, arg);
        return;
      }
      if (action === "admin_ticket_close") {
        await handleButtonAdminClose(btn, arg);
        return;
      }
      if (action === "ticket_open_modal") {
        await handleButtonTicketOpenModal(btn);
        return;
      }
      if (action === "otp_confirm") {
        await handleOtpConfirmButton(btn, arg);
        return;
      }
      if (action === "otp_cancel") {
        await handleOtpCancelButton(btn, arg);
        return;
      }
      if (action === "sugg_vote") {
        const [suggestionId, dir] = parts;
        await handleSuggestionVote(btn, suggestionId, dir);
        return;
      }
      if (action === "review_approve") {
        await handleReviewApprove(btn, arg);
        return;
      }
      if (action === "review_reject") {
        await handleReviewReject(btn, arg);
        return;
      }
    } catch (err) {
      if (isInteractionRaceError(err)) {
        console.warn(`[bot] Skipped button ${btn.customId}: interaction already handled by another instance.`);
        return;
      }
      console.error(`[bot] Button error (${btn.customId}):`, err);
      await btn.reply({ content: "An error occurred.", ephemeral: true }).catch(() => null);
    }
    return;
  }

  // --- Modal submissions ---
  if (interaction.isModalSubmit()) {
    const modal = interaction as ModalSubmitInteraction;

    try {
      if (modal.customId === "modal_ticket_open") {
        await handleModalTicketOpen(modal);
        return;
      }
      const [modalAction, ...modalParts] = modal.customId.split(":");
      if (modalAction === "otp_modal") {
        await handleOtpModal(modal, modalParts.join(":"));
        return;
      }
    } catch (err) {
      if (isInteractionRaceError(err)) {
        console.warn(`[bot] Skipped modal ${modal.customId}: interaction already handled by another instance.`);
        return;
      }
      console.error(`[bot] Modal error (${modal.customId}):`, err);
      await modal.reply({ content: "An error occurred.", ephemeral: true }).catch(() => null);
    }
    return;
  }
});

// ---------------------------------------------------------------------------
// MessageCreate — save ticket transcript for Discord tickets
// ---------------------------------------------------------------------------

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot || !message.guild) return;

  // Global chat Discord → web sync
  const chatConfig = getGlobalChatConfig();
  if (chatConfig && message.channelId === chatConfig.channelId) {
    try {
      const appUrl = process.env.APP_BASE_URL;
      if (appUrl) {
        // Detect if this message was posted via a webhook (e.g. our own RexWare Global
        // webhook or a user's personal webhook). Webhook messages from our own bot would
        // otherwise cause a loop: web → webhook → bot → web.
        if (message.webhookId) {
          // Check if this is one of our own webhooks by checking if the webhook author
          // matches the bot's own username pattern. A webhook message has a different
          // author structure: message.author is a webhook User object (no member).
          // We skip it because the message was originally sent from our web app.
          console.log(`[bot] Skipping webhook-origin message (id=${message.id}) — loop prevention.`);
          return;
        }

        // Resolve reply metadata if the message is a reply
        let replyToId: string | null = null;
        let replyToUsername: string | null = null;
        if (message.reference?.messageId) {
          try {
            const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
            if (refMsg) {
              replyToId = refMsg.id;
              replyToUsername = refMsg.author.username;
            }
          } catch { /* ignore */ }
        }

        await fetch(`${appUrl}/api/global-chat/bot-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-runner-token": process.env.RUNNER_TOKEN ?? "",
          },
          body: JSON.stringify({
            userId: message.author.id,
            username: message.author.username,
            avatarUrl: message.author.displayAvatarURL({ size: 128 }),
            content: message.content,
            replyToId,
            replyToUsername,
            source: "discord",
            discordMessageId: message.id,
          }),
        });
      }
    } catch (err) {
      console.error("[bot] Global chat sync error:", err);
    }
    return;
  }

  // Channel-specific automations (media-only enforcement + suggestions). These
  // run BEFORE the empty-content guard below because they care about
  // attachment-only messages too. Each returns true when it owned the message.
  try {
    if (await handleMediaOnlyMessage(message)) return;
    if (await handleSuggestionMessage(message)) return;
  } catch (err) {
    console.error("[bot] Channel automation error:", err);
    return;
  }

  if (!message.content.trim()) return;

  const ticket = await ticketsRepo.byChannel(message.channelId);
  if (!ticket || ticket.status === "closed") return;

  const member = message.member;
  const isStaff = !!member && member.permissions.has("ManageChannels" as never);

  try {
    await ticketsRepo.addMessage({
      ticketId: ticket.id,
      authorId: message.author.id,
      authorTag: message.author.tag,
      content: message.content.slice(0, 4000),
      isStaff,
    });
  } catch {
    // Non-fatal: transcript saving must never crash the bot
  }
});

// ---------------------------------------------------------------------------
// Singleton lock — guarantees only ONE bot process connects per machine.
//
// `npm run dev` uses `concurrently` to start the web AND the bot. If the dev
// command is launched more than once (e.g. the preview environment respawns
// it), multiple bot processes would log in with the same token and Discord
// would deliver every event to each of them — causing duplicated welcome
// messages and doubled command replies.
//
// We grab an exclusive lock by binding a local TCP port. Binding is atomic and
// the OS releases the port automatically when the process dies, so a crashed
// instance never leaves a stale lock behind. If the port is already taken,
// another bot is alive and this process exits immediately.
// ---------------------------------------------------------------------------

const LOCK_PORT = Number(process.env.BOT_LOCK_PORT ?? 45219);

function acquireSingletonLock(): Promise<void> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.warn(
          `[bot] Another bot instance is already running (lock port ${LOCK_PORT} in use). Exiting this duplicate.`,
        );
        process.exit(0);
      }
      console.error("[bot] Unexpected error acquiring singleton lock:", err);
      process.exit(1);
    });
    server.listen(LOCK_PORT, "127.0.0.1", () => {
      // Keep the server reference alive for the lifetime of the process.
      server.unref();
      console.log(`[bot] Acquired singleton lock on port ${LOCK_PORT}.`);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// The TCP lock above only coordinates processes on the SAME machine. The most
// common cause of duplicated welcome messages, doubled command replies, and
// ticket "Unknown interaction" (10062) errors is running the bot in TWO places
// at once with the same DISCORD_BOT_TOKEN — e.g. the v0 cloud sandbox AND your
// local machine. Discord delivers every gateway event to BOTH connections, so
// they race to answer each interaction and the loser fails.
//
// To guarantee a single instance, the bot only logs in where it is meant to
// run. By default it does NOT auto-start inside the v0 cloud sandbox (its
// working directory lives under /vercel/), leaving your local/production bot as
// the one true instance. Set BOT_FORCE_START=1 to run the bot from the sandbox
// instead (in which case you must stop your local bot).
const isV0Sandbox = process.cwd().replace(/\\/g, "/").startsWith("/vercel/");
const forceStart = process.env.BOT_FORCE_START === "1";

if (isV0Sandbox && !forceStart) {
  console.warn(
    "[bot] Running inside the v0 cloud sandbox — skipping login to avoid a second " +
      "bot instance competing with your local/production bot (same token = duplicated " +
      "events + ticket 10062 errors). Set BOT_FORCE_START=1 to override.",
  );
} else {
  acquireSingletonLock().then(() => {
    client.login(token).catch((err) => {
      console.error("[bot] Login failed:", err);
      process.exit(1);
    });
  });
}

// Export client for use by external callers (e.g. DM notify endpoint)
export { client };
