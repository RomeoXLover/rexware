/**
 * SkyUtils Discord Bot — All slash command & button handlers.
 * Every response uses Discord Components v2 (flags: 32768).
 *
 * TIER LOGIC:
 *   base / starter   → only Discord tickets (source = 'discord')
 *   pro / enterprise → Discord tickets + premium web support from dashboard
 *   admin            → all access
 */

import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  Guild,
  TextChannel,
  GuildMember,
} from "discord.js";
import {
  PermissionsBitField,
  ChannelType,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  usersRepo,
  plansRepo,
  subscriptionsRepo,
  ticketsRepo,
  bannedIpsRepo,
  auditRepo,
  notificationsRepo,
  botSettingsRepo,
  proxiesRepo,
  warnsRepo,
  notesRepo,
  reviewsRepo,
  queryOne,
  execute,
  type TicketRow,
} from "../lib/repos.server.js";

import { getTicketConfig } from "../lib/config.server.js";
import { getReviewsConfig } from "../lib/config.server.js";
import { getTrialRoleConfig } from "../lib/config.server.js";
import { isOwnerId } from "../lib/config.server.js";

import {
  text,
  sep,
  row,
  btn,
  section,
  sectionOrText,
  container,
  thumbnail,
  cv2Message,
  infoMessage,
  successMessage,
  errorMessage,
  statusBadge,
  priorityBadge,
  resetIds,
  COLOR,
  PRIORITY_COLOR,
  type AnyComponent,
} from "./components.js";

import { requestConfirmation } from "./otp.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = process.env.APP_BASE_URL ?? "https://skyutils.xyz";
const REVIEWS_CHANNEL_ID = process.env.DISCORD_REVIEWS_CHANNEL_ID ?? "";
const {
  categoryName: TICKETS_CATEGORY,
  supportRoleId: SUPPORT_ROLE_ID,
  archivePrefix: TICKET_ARCHIVE_PREFIX,
  archiveDelayMs: TICKET_ARCHIVE_DELAY_MS,
} = getTicketConfig();

const { trialRoleId: TRIAL_ROLE_ID } = getTrialRoleConfig();

/**
 * Check if a Discord user is staff: SkyUtils admin OR owner.
 */
async function isStaff(discordId: string): Promise<boolean> {
  const user = await usersRepo.byDiscordId(discordId);
  if (!user) return false;
  return user.is_admin === 1 || isOwnerId(discordId);
}

/**
 * Check if a Discord member has staff access: Discord Administrator permission OR owner.
 */
function hasStaffPermission(i: { memberPermissions?: { has: (perm: bigint) => boolean }; user: { id: string } }): boolean {
  // First check Discord Administrator permission
  if (i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  // Then check if they are an owner
  return isOwnerId(i.user.id);
}

function ts(epoch: number) {
  return `<t:${Math.floor(epoch / 1000)}:R>`;
}

async function getPlanId(userId: string): Promise<string | null> {
  const active = await subscriptionsRepo.activeForUser(userId);
  return active?.plan_id ?? null;
}

async function isPremium(userId: string): Promise<boolean> {
  const planId = await getPlanId(userId);
  return planId === "pro" || planId === "enterprise" || planId === "admin";
}

async function replyError(
  i: ChatInputCommandInteraction | ButtonInteraction,
  msg: string,
) {
  const payload = errorMessage(msg);
  if (i.deferred || i.replied) {
    await i.editReply(payload as never).catch(() => null);
  } else {
    await i.reply({ ...payload, ephemeral: true } as never).catch(() => null);
  }
}

async function replySuccess(
  i: ChatInputCommandInteraction | ButtonInteraction,
  title: string,
  body: string,
) {
  const payload = successMessage(title, body);
  if (i.deferred || i.replied) {
    await i.editReply(payload as never).catch(() => null);
  } else {
    await i.reply({ ...payload, ephemeral: true } as never).catch(() => null);
  }
}

// ---------------------------------------------------------------------------
// /review
// ---------------------------------------------------------------------------

export async function handleReview(
  i: ChatInputCommandInteraction,
  guild: import("discord.js").Guild,
) {
  await i.deferReply({ ephemeral: true });

  const discordId = i.user.id;
  const stars = i.options.getInteger("stars", true);
  const feedback = i.options.getString("feedback", true);

  const user = await usersRepo.byDiscordId(discordId);
  if (!user) {
    await i.editReply(
      errorMessage(`No SkyUtils account found. Register at ${BASE_URL}`) as never,
    );
    return;
  }

  // Save review to DB
  const review = await reviewsRepo.create({
    userId: user.id,
    discordId,
    discordTag: i.user.tag,
    stars,
    feedback,
  });

  // Try to post to the reviews channel
  if (REVIEWS_CHANNEL_ID) {
    try {
      const channel = await guild.channels.fetch(REVIEWS_CHANNEL_ID);
      if (channel && "send" in channel) {
        resetIds();
        const starStr = "⭐".repeat(stars) + "☆".repeat(5 - stars);
        const msg = await channel.send({
          flags: 32768,
          components: [
            container(
              [
                text(`## ★ Review from ${i.user.displayName}`),
                sep(false),
                text(`**Rating:** ${starStr} (${stars}/5)`),
                sep(false),
                text(`> ${feedback}`),
                sep(false),
                text(`*Plan: ${i.member ? "—" : "Unknown"} • Submitted ${ts(Date.now())}*`),
                sep(false),
                row(
                  btn("Approve", 3, {
                    customId: `review_approve:${review.id}:${channel.id}`,
                  }),
                  btn("Reject", 4, {
                    customId: `review_reject:${review.id}:${channel.id}`,
                  }),
                ),
              ],
              COLOR.primary,
            ),
          ],
        } as never);

        // Update DB with the channel message ID so we can edit it after approval/rejection
        await reviewsRepo.setStatus(review.id, "pending", msg.id);
      }
    } catch (err) {
      console.error("[bot] Failed to post review to channel:", err);
    }
  }

  await i.editReply(
    successMessage(
      "Review Submitted",
      `Your ${stars}-star review has been submitted and is pending approval. Thank you!`,
    ) as never,
  );
}

// ---------------------------------------------------------------------------
// /review approve (button)
// ---------------------------------------------------------------------------

export async function handleReviewApprove(
  i: ButtonInteraction,
  reviewId: string,
) {
  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await i.reply({ ...errorMessage("You need Manage Server permission."), ephemeral: true } as never);
    return;
  }

  await i.deferReply({ ephemeral: true });

  const review = await reviewsRepo.setStatus(reviewId, "approved");
  if (!review) {
    await i.editReply(errorMessage("Review not found.") as never);
    return;
  }

  resetIds();
  await i.editReply(successMessage("Review Approved", "The review has been approved and will appear on the web page.") as never);
}

// ---------------------------------------------------------------------------
// /review reject (button)
// ---------------------------------------------------------------------------

export async function handleReviewReject(
  i: ButtonInteraction,
  reviewId: string,
) {
  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await i.reply({ ...errorMessage("You need Manage Server permission."), ephemeral: true } as never);
    return;
  }

  await i.deferReply({ ephemeral: true });

  const review = await reviewsRepo.setStatus(reviewId, "rejected");
  if (!review) {
    await i.editReply(errorMessage("Review not found.") as never);
    return;
  }

  resetIds();
  await i.editReply(successMessage("Review Rejected", "The review has been rejected.") as never);
}

// ---------------------------------------------------------------------------
// /ping
// ---------------------------------------------------------------------------

export async function handlePing(i: ChatInputCommandInteraction) {
  resetIds();
  const latency = i.client.ws.ping;
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = Math.floor(uptime % 60);

  await i.reply({
    ...cv2Message([
      container(
        [
          text("## Pong!"),
          sep(false),
          text(`**Latency:** \`${latency}ms\`\n**Uptime:** \`${h}h ${m}m ${s}s\`\n**Status:** All systems operational`),
          sep(false),
          row(btn("Dashboard", 5, { url: BASE_URL })),
        ],
        COLOR.success,
      ),
    ]),
    ephemeral: true,
  } as never);
}

// ---------------------------------------------------------------------------
// /info
// ---------------------------------------------------------------------------

export async function handleInfo(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.editReply(
      errorMessage("Account not found.\nRegister at " + BASE_URL) as never,
    );
    return;
  }

  const active = await subscriptionsRepo.activeForUser(user.id);
  const plan = active ? await plansRepo.byId(active.plan_id) : null;
  const tickets = await ticketsRepo.byUser(user.id);
  const openTickets = tickets.filter((t) => t.status === "open");

  const premiumUser = await isPremium(user.id);
  const premiumNote = premiumUser
    ? "\n\n**Premium Support:** Use the dashboard for web tickets and priority support."
    : "\n\n**Upgrade to Pro** for dashboard-based premium support.";

  await i.editReply({
    ...cv2Message([
      container(
        [
          ...[
            sectionOrText(
              [
                text(`## ${user.global_name ?? user.username}`),
                text(
                  `**Username:** \`${user.username}\`\n**Plan:** ${plan ? plan.name : "Free"}\n**Subscription:** ${statusBadge(active?.status ?? "none")}\n**Open Tickets:** ${openTickets.length}${premiumNote}`,
                ),
              ],
              user.avatar_url ? thumbnail(user.avatar_url) : undefined,
            ),
          ].flat(),
          sep(false),
          row(
            btn("Dashboard", 5, { url: BASE_URL + "/dash" }),
            btn("Open Ticket", 1, { customId: "ticket_open_modal" }),
          ),
        ],
        COLOR.primary,
      ),
    ]),
  } as never);
}

// ---------------------------------------------------------------------------
// /plan
// ---------------------------------------------------------------------------

export async function handlePlan(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const plans = (await plansRepo.all()).filter((p) => !p.is_hidden);

  if (!plans.length) {
    await i.editReply(infoMessage("Plans", "No plans are currently available.") as never);
    return;
  }

  const planComponents: AnyComponent[] = [
    text("## Available Plans"),
    sep(false),
  ];

  for (const plan of plans) {
    planComponents.push(
      text(
        `### ${plan.name}\n${plan.description ?? "No description."}\n**Price:** $${plan.price_usd.toFixed(2)}/${plan.interval}`,
      ),
    );
    planComponents.push(sep(false, 1));
  }

  planComponents.push(row(btn("View Plans", 5, { url: BASE_URL + "/pricing" })));

  await i.editReply({
    ...cv2Message([container(planComponents as never, COLOR.primary)]),
  } as never);
}

// ---------------------------------------------------------------------------
// Shared: build the live price-list component tree from the DB.
// Used by both /admin post pricelist (public, posted to a channel) and any
// future ephemeral surface.
// ---------------------------------------------------------------------------

function fmtLimit(n: number, suffix = ""): string {
  if (n === -1) return "Unlimited";
  return `${n}${suffix}`;
}

async function buildPricelistComponents(): Promise<AnyComponent[]> {
  const plans = (await plansRepo.allActive()).filter((p) => !p.is_trial);

  const items: AnyComponent[] = [
    text("# SkyUtils Price List"),
    text("Choose the plan that fits your needs. Prices are billed per interval and can be upgraded at any time."),
    sep(true),
  ];

  if (!plans.length) {
    items.push(text("No plans are currently available. Check back soon."));
  } else {
    for (const plan of plans) {
      let features: string[] = [];
      try {
        features = JSON.parse(plan.features) as string[];
      } catch {
        features = [];
      }

      const featureLines = features.length
        ? features.map((f) => `· ${f}`).join("\n")
        : "· Core access";

      items.push(
        text(
          `### ${plan.name} — $${plan.price_usd.toFixed(2)}/${plan.interval}\n` +
            `${plan.description ?? ""}`.trim(),
        ),
        text(
          `**Bots:** ${fmtLimit(plan.max_bots)}  •  ` +
            `**Bot-hours:** ${fmtLimit(plan.bot_hours, "h")}  •  ` +
            `**Proxies:** ${fmtLimit(plan.max_proxies)}`,
        ),
        text(featureLines),
        sep(false, 1),
      );
    }
  }

  items.push(
    text("*Have a custom requirement? Open a ticket and we'll tailor a plan for you.*"),
    row(
      btn("Subscribe", 5, { url: BASE_URL + "/pricing" }),
      btn("Dashboard", 5, { url: BASE_URL + "/dash" }),
    ),
  );

  return items;
}

// ---------------------------------------------------------------------------
// Shared: Terms of Service content (default template, overridable via bot_settings).
// ---------------------------------------------------------------------------

async function buildTosComponents(): Promise<AnyComponent[]> {
  const custom = await botSettingsRepo.get?.("tos_text");
  const body =
    custom ??
    [
      "By using SkyUtils you agree to the following terms:",
      "",
      "**1. Acceptable Use** — SkyUtils provides Minecraft automation tooling. You are responsible for ensuring your usage complies with the terms of service of any third-party server you connect to.",
      "**2. Accounts** — You are responsible for activity under your account and for keeping your credentials secure. One person may not share a single subscription across unrelated parties.",
      "**3. Payments & Refunds** — Subscriptions are billed in advance per interval. Because access is granted instantly, payments are generally non-refundable except where required by law.",
      "**4. Fair Use** — Abuse of the platform (resource exhaustion, fraud, chargebacks, or attempts to bypass plan limits) may result in suspension without refund.",
      "**5. Availability** — We aim for high uptime but do not guarantee uninterrupted service. Scheduled maintenance will be announced when possible.",
      "**6. Termination** — We reserve the right to suspend or terminate accounts that violate these terms or applicable law.",
      "**7. Changes** — These terms may be updated. Continued use after changes constitutes acceptance.",
    ].join("\n");

  return [
    text("# Terms of Service"),
    sep(true),
    text(body),
    sep(false),
    text("*By continuing to use SkyUtils, you acknowledge that you have read and agree to these terms.*"),
    row(btn("Full Terms", 5, { url: BASE_URL + "/terms" })),
  ];
}

// ---------------------------------------------------------------------------
// Shared: Server rules content (default template, overridable via bot_settings).
// ---------------------------------------------------------------------------

async function buildRulesComponents(): Promise<AnyComponent[]> {
  const custom = await botSettingsRepo.get?.("rules_text");
  const body =
    custom ??
    [
      "Welcome! Keep our community friendly by following these rules:",
      "",
      "**1. Be respectful** — No harassment, hate speech, discrimination, or personal attacks.",
      "**2. No spam** — Avoid flooding channels, excessive pings, or unsolicited advertising/DMs.",
      "**3. Stay on topic** — Use the appropriate channels for your messages.",
      "**4. No NSFW or illegal content** — Keep everything safe for work and lawful.",
      "**5. Use support tickets** — For account or billing issues, open a ticket with `/ticket open` instead of pinging staff.",
      "**6. Follow Discord ToS** — All Discord Community Guidelines apply here.",
      "**7. Staff decisions are final** — If you disagree, open a ticket to appeal calmly.",
    ].join("\n");

  return [
    text("# Server Rules"),
    sep(true),
    text(body),
    sep(false),
    text("*Breaking these rules may result in warnings, mutes, kicks, or bans depending on severity.*"),
  ];
}

// ---------------------------------------------------------------------------
// /help — public command listing
// ---------------------------------------------------------------------------

export async function handleHelp(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const isAdmin = !!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator);

  const items: AnyComponent[] = [
    text("## SkyUtils Bot — Commands"),
    sep(true),
    text(
      "**General**\n" +
        "`/ping` — Check bot status and latency\n" +
        "`/info` — Your account, plan & subscription\n" +
        "`/plan` — View available plans\n" +
        "`/faq` — Frequently asked questions\n" +
        "`/tos` — Terms of Service\n" +
        "`/help` — This menu",
    ),
    sep(false, 1),
    text(
      "**Support Tickets**\n" +
        "`/ticket open` — Open a support ticket\n" +
        "`/ticket status` — View your open tickets\n" +
        "`/ticket close` — Close your current ticket\n" +
        "`/ticket reopen` — Reopen your last ticket",
    ),
  ];

  if (isAdmin) {
    items.push(
      sep(false, 1),
      text(
        "**Admin**\n" +
          "`/admin stats` · `/admin server` · `/admin audit`\n" +
          "`/admin user …` — info, ban, warn, notes, subscription\n" +
          "`/admin subscription set|revoke`\n" +
          "`/admin ticket list|close|claim|priority|panel`\n" +
          "`/admin mod kick|mute|unmute|purge`\n" +
          "`/admin proxy add|remove|list|assign`\n" +
          "`/admin ip ban|unban|list`\n" +
          "`/admin post tos|pricelist|rules`\n" +
          "`/admin announce` · `/admin broadcast`",
      ),
    );
  }

  items.push(
    sep(false),
    row(btn("Dashboard", 5, { url: BASE_URL + "/dash" }), btn("Plans", 5, { url: BASE_URL + "/pricing" })),
  );

  await i.editReply({ ...cv2Message([container(items as never, COLOR.primary)]) } as never);
}

// ---------------------------------------------------------------------------
// /faq — public frequently asked questions
// ---------------------------------------------------------------------------

export async function handleFaq(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const items: AnyComponent[] = [
    text("## Frequently Asked Questions"),
    sep(true),
    text(
      "**What is SkyUtils?**\n" +
        "A platform to deploy and manage Minecraft automation bots from a single dashboard.",
    ),
    sep(false, 1),
    text(
      "**How do I get started?**\n" +
        `Register at ${BASE_URL}, pick a plan with \`/plan\`, then deploy a bot from your dashboard.`,
    ),
    sep(false, 1),
    text(
      "**What are bot-hours?**\n" +
        "Bot-hours measure how long your bots can run. Each plan includes a monthly allowance — unlimited on higher tiers.",
    ),
    sep(false, 1),
    text(
      "**Do you support proxies?**\n" +
        "Yes. You can add and assign proxies from the dashboard, within your plan's proxy limit.",
    ),
    sep(false, 1),
    text(
      "**How do I get help?**\n" +
        "Open a ticket with `/ticket open`. Pro & Enterprise users get priority support from the dashboard.",
    ),
    sep(false, 1),
    text(
      "**Can I upgrade later?**\n" +
        "Absolutely — upgrade or downgrade at any time from the pricing page.",
    ),
    sep(false),
    row(btn("Open a Ticket", 1, { customId: "ticket_open_modal" }), btn("Dashboard", 5, { url: BASE_URL + "/dash" })),
  ];

  await i.editReply({ ...cv2Message([container(items as never, COLOR.info)]) } as never);
}

// ---------------------------------------------------------------------------
// /tos — public terms of service
// ---------------------------------------------------------------------------

export async function handleTos(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();
  const items = await buildTosComponents();
  await i.editReply({ ...cv2Message([container(items as never, COLOR.muted)]) } as never);
}

// ---------------------------------------------------------------------------
// Admin: /admin post tos|pricelist|rules
// ---------------------------------------------------------------------------

async function postPanelToChannel(
  i: ChatInputCommandInteraction,
  components: AnyComponent[],
  accent: number,
  label: string,
) {
  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await i.reply({ ...errorMessage("You need Manage Server permission."), ephemeral: true } as never);
    return;
  }

  await i.deferReply({ ephemeral: true });

  const channel = i.options.getChannel("channel") ?? i.channel;
  if (!channel || !("send" in (channel as TextChannel))) {
    await i.editReply(errorMessage("Target channel is not a text channel.") as never);
    return;
  }

  await (channel as TextChannel).send({
    flags: 32768,
    components: [container(components as never, accent)],
  } as never);

  await i.editReply(successMessage("Panel Posted", `${label} posted to <#${(channel as TextChannel).id}>.`) as never);
}

export async function handleAdminPostTos(i: ChatInputCommandInteraction) {
  resetIds();
  const components = await buildTosComponents();
  await postPanelToChannel(i, components, COLOR.muted, "Terms of Service");
}

export async function handleAdminPostPricelist(i: ChatInputCommandInteraction) {
  resetIds();
  const components = await buildPricelistComponents();
  await postPanelToChannel(i, components, COLOR.primary, "Price list");
}

export async function handleAdminPostRules(i: ChatInputCommandInteraction) {
  resetIds();
  const components = await buildRulesComponents();
  await postPanelToChannel(i, components, COLOR.success, "Server rules");
}

// ---------------------------------------------------------------------------
// /ticket open
// ---------------------------------------------------------------------------

export async function handleTicketOpen(i: ChatInputCommandInteraction, guild: Guild) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.editReply(
      errorMessage(`No SkyUtils account found for your Discord. Register at ${BASE_URL}`) as never,
    );
    return;
  }

  // Check for existing open ticket
  const existing = (await ticketsRepo.byUser(user.id)).find((t) => t.status === "open");
  if (existing) {
    await i.editReply(
      errorMessage(
        `You already have an open ticket. Close it first before opening a new one.\n\nChannel: ${existing.channel_id ? `<#${existing.channel_id}>` : "unknown"}`,
      ) as never,
    );
    return;
  }

  const subject = i.options.getString("subject", true);
  const category = (i.options.getString("category") ?? "general") as TicketRow["category"];
  const priority = (i.options.getString("priority") ?? "normal") as TicketRow["priority"];

  // Find or create the ticket category channel
  let ticketCategory = guild.channels.cache.find(
    (c) => c.name.toLowerCase() === TICKETS_CATEGORY.toLowerCase() && c.type === ChannelType.GuildCategory,
  );
  if (!ticketCategory) {
    ticketCategory = await guild.channels.create({
      name: TICKETS_CATEGORY,
      type: ChannelType.GuildCategory,
    });
  }

  // Create the private channel
  const channelName = `ticket-${i.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const permissionOverwrites: {
    id: string;
    allow?: bigint[];
    deny?: bigint[];
  }[] = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];
  if (SUPPORT_ROLE_ID) {
    permissionOverwrites.push({
      id: SUPPORT_ROLE_ID,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: ticketCategory.id,
    permissionOverwrites,
  });

  // Create DB record
  const ticket = await ticketsRepo.create({
    userId: user.id,
    discordUserId: discordId,
    discordUserTag: i.user.tag,
    channelId: channel.id,
    subject,
    category,
    priority,
  });

  // Post ticket panel in the channel using CV2 — enhanced with category, timestamp, and visual fields
  resetIds();
  const ticketCode = ticket.id.slice(-6).toUpperCase();
  const createdTimestamp = Math.floor(Date.now() / 1000);
  await (channel as TextChannel).send({
    flags: 32768,
    components: [
      container(
        [
          text(`# 🎫 Ticket #${ticketCode}`),
          sep(true),
          text(`**Subject:** ${subject}`),
          sep(false),
          text(
            `**Category:** \`${category}\`  **Priority:** ${priorityBadge(priority)}  **Status:** ${statusBadge("open")}\n` +
            `**Opened by:** <@${discordId}>  **Created:** <t:${createdTimestamp}:R>`,
          ),
          sep(false),
          text("Describe your issue below. A staff member will assist you shortly."),
          sep(false),
          row(
            btn("Close Ticket", 4, { customId: `ticket_close:${ticket.id}` }),
            btn("Dashboard", 5, { url: `${BASE_URL}/dash` }),
          ),
        ],
        PRIORITY_COLOR[priority] ?? COLOR.primary,
      ),
    ],
  } as never);

  await notificationsRepo.create({
    userId: user.id,
    type: "ticket",
    title: "Ticket opened",
    body: `Your support ticket "${subject}" has been created. Check the dashboard for transcripts.`,
  });

  await i.editReply(
    successMessage("Ticket Created", `Your ticket has been created in <#${channel.id}>.`) as never,
  );
}

// ---------------------------------------------------------------------------
// /ticket close
// ---------------------------------------------------------------------------

export async function handleTicketClose(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.editReply(errorMessage("No SkyUtils account found.") as never);
    return;
  }

  // Find ticket by channel
  const ticket = i.channelId ? await ticketsRepo.byChannel(i.channelId) : null;
  if (!ticket) {
    await i.editReply(errorMessage("No open ticket found in this channel.") as never);
    return;
  }

  if (ticket.user_id !== user.id && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await i.editReply(errorMessage("You can only close your own tickets.") as never);
    return;
  }

  await ticketsRepo.setStatus(ticket.id, "closed", user.id);
  await notificationsRepo.create({
    userId: ticket.user_id,
    type: "ticket",
    title: "Ticket closed",
    body: `Your ticket "${ticket.subject}" has been closed. View the transcript on the dashboard.`,
  });

  resetIds();
  await i.editReply(
    successMessage("Ticket Closed", "The ticket has been closed. Transcript saved to dashboard.") as never,
  );

  // Archive the channel after a short delay
  setTimeout(async () => {
    try {
      const ch = i.channel as TextChannel;
      if (ch) {
        await ch.setName(`${TICKET_ARCHIVE_PREFIX}${ch.name}`);
        await ch.permissionOverwrites.set([
          { id: i.guild!.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ]);
      }
    } catch {
      // Non-fatal
    }
  }, TICKET_ARCHIVE_DELAY_MS);
}

// ---------------------------------------------------------------------------
// /ticket status
// ---------------------------------------------------------------------------

export async function handleTicketStatus(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.editReply(errorMessage("No SkyUtils account found.") as never);
    return;
  }

  const tickets = await ticketsRepo.byUser(user.id);
  const open = tickets.filter((t) => t.status !== "closed");

  if (!open.length) {
    await i.editReply(infoMessage("No Open Tickets", "You have no open tickets.") as never);
    return;
  }

  const items: AnyComponent[] = [text("## Your Open Tickets"), sep(false)];

  for (const t of open.slice(0, 5)) {
    items.push(
      text(
        `**${t.subject}**\n${statusBadge(t.status)} · ${priorityBadge(t.priority)} · ${t.channel_id ? `<#${t.channel_id}>` : "Web ticket"} · Opened ${ts(t.created_at)}`,
      ),
    );
    items.push(sep(false, 1));
  }

  items.push(row(btn("View All Tickets", 5, { url: `${BASE_URL}/dash` })));

  await i.editReply({ ...cv2Message([container(items as never, COLOR.primary)]) } as never);
}

// ---------------------------------------------------------------------------
// /ticket reopen
// ---------------------------------------------------------------------------

export async function handleTicketReopen(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);
  if (!user) {
    await i.editReply(errorMessage("No SkyUtils account found.") as never);
    return;
  }

  const ticket = i.channelId ? await ticketsRepo.byChannel(i.channelId) : null;
  if (!ticket || ticket.status !== "closed") {
    await i.editReply(errorMessage("No closed ticket found in this channel.") as never);
    return;
  }

  await ticketsRepo.setStatus(ticket.id, "open");
  await i.editReply(successMessage("Ticket Reopened", "The ticket has been reopened.") as never);
}

// ---------------------------------------------------------------------------
// /welcome setup
// ---------------------------------------------------------------------------

export async function handleWelcomeSetup(i: ChatInputCommandInteraction) {
  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await i.reply({ ...errorMessage("You need Manage Server permission."), ephemeral: true } as never);
    return;
  }

  const channel = i.options.getChannel("channel");
  const title = i.options.getString("title");
  const message =
    i.options.getString("description") ??
    i.options.getString("message") ??
    "Welcome to the server!";
  // Default DM to enabled when the option is omitted.
  const dmEnabled = i.options.getBoolean("dm") ?? true;

  if (channel) {
    await botSettingsRepo.set("welcome_channel_id", channel.id);
  }
  if (title) {
    await botSettingsRepo.set("welcome_title", title);
  }
  await botSettingsRepo.set("welcome_message", message);
  await botSettingsRepo.set("welcome_dm", dmEnabled ? "1" : "0");

  const channelLine = channel
    ? `Welcome channel set to <#${channel.id}>.`
    : "No public channel set — new members will only receive a welcome DM.";
  const dmLine = dmEnabled
    ? "New members will also receive a welcome DM."
    : "Welcome DMs are disabled.";

  await i.reply(
    {
      ...successMessage(
        "Welcome Setup",
        `${channelLine}\n${dmLine}\n${title ? `Title: ${title}\n` : ""}Message: ${message}`,
      ),
      ephemeral: true,
    } as never,
  );
}

// ---------------------------------------------------------------------------
// Admin: /admin ticket-panel
// ---------------------------------------------------------------------------

export async function handleAdminTicketPanel(i: ChatInputCommandInteraction) {
  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await i.reply({ ...errorMessage("Missing permissions."), ephemeral: true } as never);
    return;
  }

  // Acknowledge immediately — sending the panel to the channel is a network
  // call that can exceed Discord's 3-second interaction window.
  await i.deferReply({ ephemeral: true });

  resetIds();

  const channel = i.options.getChannel("channel") ?? i.channel;

  await (channel as TextChannel).send({
    flags: 32768,
    components: [
      container(
        [
          text("## Support Tickets"),
          sep(false),
          text(
            "Need help? Open a support ticket and our team will assist you as soon as possible.\n\n" +
            "**Before opening a ticket:**\n" +
            "- Check the FAQ and documentation\n" +
            "- Make sure you have a registered SkyUtils account\n\n" +
            "**Pro & Enterprise users:** You can also open tickets directly from the dashboard for priority support.",
          ),
          sep(false),
          row(
            btn("Open Ticket", 1, { customId: "ticket_open_modal" }),
            btn("Dashboard", 5, { url: BASE_URL + "/dash" }),
          ),
        ],
        COLOR.primary,
      ),
    ],
  } as never);

  await i.editReply(successMessage("Panel Posted", "Ticket panel posted successfully.") as never);
}

// ---------------------------------------------------------------------------
// Admin: stats
// ---------------------------------------------------------------------------

export async function handleAdminStats(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const users = (await usersRepo.all?.()) ?? [];
  const openTickets = await ticketsRepo.all("open");
  const inProgressTickets = await ticketsRepo.all("in_progress");

  await i.editReply({
    ...cv2Message([
      container(
        [
          text("## System Stats"),
          sep(false),
          text(
            `**Total Users:** ${users.length}\n**Open Tickets:** ${openTickets.length}\n**In Progress:** ${inProgressTickets.length}`,
          ),
          sep(false),
          row(btn("Admin Panel", 5, { url: `${BASE_URL}/admin` })),
        ],
        COLOR.primary,
      ),
    ]),
  } as never);
}

// ---------------------------------------------------------------------------
// Admin: user info
// ---------------------------------------------------------------------------

export async function handleAdminUserInfo(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id) ?? await usersRepo.byUsername(targetUser.username);

  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }

  const active = await subscriptionsRepo.activeForUser(user.id);
  const plan = active ? await plansRepo.byId(active.plan_id) : null;
  const userTickets = await ticketsRepo.byUser(user.id);
  const warns = await warnsRepo.byUser(user.id);

  await i.editReply({
    ...cv2Message([
      container(
        [
          ...[
            sectionOrText(
              [
                text(`## ${user.global_name ?? user.username}`),
                text(
                  `**Discord ID:** \`${user.id}\`\n**Email:** \`${user.email ?? "none"}\`\n**Plan:** ${plan?.name ?? "Free"}\n**Subscription:** ${statusBadge(active?.status ?? "none")}\n**Tickets:** ${userTickets.length}\n**Warns:** ${warns.length}\n**Admin:** ${user.is_admin ? "Yes" : "No"}\n**Banned:** ${user.is_banned ? "Yes" : "No"}`,
                ),
              ],
              user.avatar_url ? thumbnail(user.avatar_url) : undefined,
            ),
          ].flat(),
          sep(false),
          row(
            btn("View Profile", 5, { url: `${BASE_URL}/admin?tab=users&id=${user.id}` }),
          ),
        ],
        user.is_banned ? COLOR.danger : COLOR.primary,
      ),
    ]),
  } as never);
}

// ---------------------------------------------------------------------------
// Admin: ban / unban
// ---------------------------------------------------------------------------

export async function handleAdminBan(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const target = targetUser.id;
  const reason = i.options.getString("reason") ?? "No reason provided";

  const user = await usersRepo.byDiscordId(target) ?? await usersRepo.byId(target);
  if (!user) {
    await i.reply({ ...errorMessage("User not found."), ephemeral: true } as never);
    return;
  }

  await requestConfirmation(i, {
    title: "Ban user",
    summary: `You are about to **ban** \`${user.username}\`.\nReason: ${reason}`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      await usersRepo.setBanned(user.id, true);
      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ban", targetId: user.id, detail: reason });

      await notificationsRepo.create({
        userId: user.id,
        type: "system",
        title: "Account suspended",
        body: `Your account has been suspended. Reason: ${reason}`,
      });

      await m.editReply(successMessage("User Banned", `**${user.username}** has been banned.\nReason: ${reason}`) as never);
    },
  });
}

export async function handleAdminUnban(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }

  await usersRepo.setBanned(user.id, false);
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "unban", targetId: user.id });

  await notificationsRepo.create({
    userId: user.id,
    type: "system",
    title: "Account reinstated",
    body: "Your account suspension has been lifted.",
  });

  await i.editReply(successMessage("User Unbanned", `**${user.username}** has been unbanned.`) as never);
}

// ---------------------------------------------------------------------------
// Admin: Discord moderation (kick, mute, unmute, purge)
// ---------------------------------------------------------------------------

export async function handleAdminModKick(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  if (!i.guild) {
    await i.editReply(errorMessage("This command can only be used in a server.") as never);
    return;
  }

  const targetUser = i.options.getUser("user", true);
  const reason = i.options.getString("reason") ?? "No reason provided";

  let member: GuildMember | null = null;
  try {
    member = await i.guild.members.fetch(targetUser.id);
  } catch {
    await i.editReply(errorMessage("Member not found in this server.") as never);
    return;
  }

  try {
    await member.kick(reason);
  } catch {
    await i.editReply(errorMessage("Failed to kick member. Check bot permissions.") as never);
    return;
  }

  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "discord_kick", targetId: targetUser.id, detail: reason });

  await i.editReply(
    successMessage("Member Kicked", `**${targetUser.tag}** has been kicked.\nReason: ${reason}`) as never,
  );
}

export async function handleAdminModMute(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  if (!i.guild) {
    await i.editReply(errorMessage("This command can only be used in a server.") as never);
    return;
  }

  const targetUser = i.options.getUser("user", true);
  const durationMin = i.options.getInteger("duration") ?? 10;
  const reason = i.options.getString("reason") ?? "No reason provided";
  const ms = durationMin * 60 * 1000;

  let member: GuildMember | null = null;
  try {
    member = await i.guild.members.fetch(targetUser.id);
  } catch {
    await i.editReply(errorMessage("Member not found in this server.") as never);
    return;
  }

  try {
    await member.timeout(ms, reason);
  } catch {
    await i.editReply(errorMessage("Failed to timeout member. Check bot permissions.") as never);
    return;
  }

  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({
    actorId: actor?.id ?? i.user.id,
    action: "discord_mute",
    targetId: targetUser.id,
    detail: `${durationMin}m: ${reason}`,
  });

  await i.editReply(
    successMessage(
      "Member Muted",
      `**${targetUser.tag}** has been timed out for **${durationMin} minute(s)**.\nReason: ${reason}`,
    ) as never,
  );
}

export async function handleAdminModUnmute(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  if (!i.guild) {
    await i.editReply(errorMessage("This command can only be used in a server.") as never);
    return;
  }

  const targetUser = i.options.getUser("user", true);

  let member: GuildMember | null = null;
  try {
    member = await i.guild.members.fetch(targetUser.id);
  } catch {
    await i.editReply(errorMessage("Member not found in this server.") as never);
    return;
  }

  try {
    await member.timeout(null);
  } catch {
    await i.editReply(errorMessage("Failed to remove timeout. Check bot permissions.") as never);
    return;
  }

  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "discord_unmute", targetId: targetUser.id });

  await i.editReply(
    successMessage("Member Unmuted", `**${targetUser.tag}**'s timeout has been removed.`) as never,
  );
}

export async function handleAdminModPurge(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });

  if (!i.guild || !i.channel) {
    await i.editReply(errorMessage("This command can only be used in a server channel.") as never);
    return;
  }

  const amount = Math.min(i.options.getInteger("amount", true), 100);
  const channel = i.channel as TextChannel;

  let deleted = 0;
  try {
    const msgs = await channel.bulkDelete(amount, true);
    deleted = msgs.size;
  } catch {
    await i.editReply(errorMessage("Failed to delete messages. Messages older than 14 days cannot be bulk deleted.") as never);
    return;
  }

  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({
    actorId: actor?.id ?? i.user.id,
    action: "discord_purge",
    targetId: i.channelId,
    detail: `${deleted} messages`,
  });

  await i.editReply(
    successMessage("Messages Purged", `Deleted **${deleted}** message(s) from <#${i.channelId}>.`) as never,
  );
}

// ---------------------------------------------------------------------------
// Admin: grant/revoke admin
// ---------------------------------------------------------------------------

export async function handleAdminGrantAdmin(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.reply({ ...errorMessage("User not found."), ephemeral: true } as never);
    return;
  }
  await requestConfirmation(i, {
    title: "Grant admin",
    summary: `You are about to grant **admin privileges** to \`${user.username}\`.`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      await usersRepo.setAdmin(user.id, true);
      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "grant_admin", targetId: user.id });
      await m.editReply(successMessage("Admin Granted", `**${user.username}** is now an admin.`) as never);
    },
  });
}

export async function handleAdminRevokeAdmin(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.reply({ ...errorMessage("User not found."), ephemeral: true } as never);
    return;
  }
  await requestConfirmation(i, {
    title: "Revoke admin",
    summary: `You are about to revoke **admin privileges** from \`${user.username}\`.`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      await usersRepo.setAdmin(user.id, false);
      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "revoke_admin", targetId: user.id });
      await m.editReply(successMessage("Admin Revoked", `**${user.username}** is no longer an admin.`) as never);
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: subscription view
// ---------------------------------------------------------------------------

export async function handleAdminSubscription(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  const active = await subscriptionsRepo.activeForUser(user.id);
  const plan = active ? await plansRepo.byId(active.plan_id) : null;
  resetIds();
  await i.editReply({
    ...cv2Message([
      container(
        [
          text(`## Subscription: ${user.username}`),
          sep(false),
          text(
            active
              ? `**Plan:** ${plan?.name ?? active.plan_id}\n**Status:** ${statusBadge(active.status)}\n**Since:** ${ts(active.created_at)}\n**Expires:** ${active.expires_at ? ts(active.expires_at) : "never"}`
              : "No active subscription.",
          ),
        ],
        active ? COLOR.success : COLOR.muted,
      ),
    ]),
  } as never);
}

// ---------------------------------------------------------------------------
// Admin: warns
// ---------------------------------------------------------------------------

export async function handleAdminWarn(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const reason = i.options.getString("reason", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  const actor = await usersRepo.byDiscordId(i.user.id);
  await warnsRepo.add({ userId: user.id, issuedBy: actor?.id ?? i.user.id, reason });
  await notificationsRepo.create({ userId: user.id, type: "system", title: "Warning issued", body: `Reason: ${reason}` });
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "warn", targetId: user.id, detail: reason });
  await i.editReply(successMessage("User Warned", `**${user.username}** has been warned.\nReason: ${reason}`) as never);
}

export async function handleAdminWarns(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  const warns = await warnsRepo.byUser(user.id);
  resetIds();
  const items: AnyComponent[] = [text(`## Warns: ${user.username}`), sep(false)];
  if (warns.length === 0) {
    items.push(text("No warns on record."));
  } else {
    for (const w of warns) {
      items.push(text(`**${ts(w.created_at)}** — ${w.reason}\n*Issued by: \`${w.actor_id}\`*`));
      items.push(sep(false, 1));
    }
  }
  await i.editReply({ ...cv2Message([container(items as never, COLOR.warning)]) } as never);
}

// ---------------------------------------------------------------------------
// Admin: notes
// ---------------------------------------------------------------------------

export async function handleAdminNoteAdd(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const note = i.options.getString("content", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  const actor = await usersRepo.byDiscordId(i.user.id);
  await notesRepo.add({ userId: user.id, authorId: actor?.id ?? i.user.id, content: note });
  await i.editReply(successMessage("Note Added", `Note added to **${user.username}**.`) as never);
}

export async function handleAdminNotes(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  const notes = await notesRepo.byUser(user.id);
  resetIds();
  const items: AnyComponent[] = [text(`## Notes: ${user.username}`), sep(false)];
  if (!notes.length) {
    items.push(text("No notes."));
  } else {
    for (const n of notes) {
      items.push(text(`**${ts(n.created_at)}** — ${n.content}`));
      items.push(sep(false, 1));
    }
  }
  await i.editReply({ ...cv2Message([container(items as never, COLOR.info)]) } as never);
}

// ---------------------------------------------------------------------------
// Admin: subscription set / revoke
// ---------------------------------------------------------------------------

export async function handleAdminSubscriptionSet(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const planId = i.options.getString("plan", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.reply({ ...errorMessage("User not found."), ephemeral: true } as never);
    return;
  }
  const plan = await plansRepo.byId(planId);
  if (!plan) {
    await i.reply({ ...errorMessage("Plan not found."), ephemeral: true } as never);
    return;
  }
  await requestConfirmation(i, {
    title: "Set subscription",
    summary: `You are about to set \`${user.username}\` to the **${plan.name}** plan.`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      await subscriptionsRepo.setForUser(user.id, planId);
      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "sub_set", targetId: user.id, detail: planId });
      await notificationsRepo.create({ userId: user.id, type: "plan", title: "Subscription updated", body: `Your plan has been set to ${plan.name}.` });
      await m.editReply(successMessage("Subscription Set", `**${user.username}** is now on the **${plan.name}** plan.`) as never);
    },
  });
}

export async function handleAdminSubscriptionRevoke(i: ChatInputCommandInteraction) {
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.reply({ ...errorMessage("User not found."), ephemeral: true } as never);
    return;
  }
  await requestConfirmation(i, {
    title: "Revoke subscription",
    summary: `You are about to revoke \`${user.username}\`'s active subscription.`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      await subscriptionsRepo.revokeForUser(user.id);
      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "sub_revoke", targetId: user.id });
      await notificationsRepo.create({ userId: user.id, type: "plan", title: "Subscription revoked", body: "Your subscription has been revoked." });
      await m.editReply(successMessage("Subscription Revoked", `**${user.username}**'s subscription has been revoked.`) as never);
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: tickets
// ---------------------------------------------------------------------------

export async function handleAdminTicketList(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  resetIds();

  const status = (i.options.getString("status") ?? "open") as TicketRow["status"];
  const tickets = await ticketsRepo.all(status);

  const items: AnyComponent[] = [
    text(`## Tickets — ${status.toUpperCase()} (${tickets.length})`),
    sep(false),
  ];

  if (!tickets.length) {
    items.push(text("No tickets found."));
  } else {
    for (const t of tickets.slice(0, 8)) {
      const user = await usersRepo.byId(t.user_id);
      items.push(
        text(
          `**${t.subject}** \`${t.id.slice(-6)}\`\n${statusBadge(t.status)} · ${priorityBadge(t.priority)} · ${t.source === "web" ? "Web" : "Discord"}\n*${user?.username ?? "unknown"} · ${ts(t.created_at)}*`,
        ),
      );
      items.push(sep(false, 1));
    }
    if (tickets.length > 8) {
      items.push(text(`*…and ${tickets.length - 8} more. View all in admin panel.*`));
    }
  }

  items.push(row(btn("Admin Panel", 5, { url: `${BASE_URL}/admin?tab=tickets` })));

  await i.editReply({ ...cv2Message([container(items as never, COLOR.info)]) } as never);
}

export async function handleAdminTicketClose(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const ticketId = i.options.getString("ticket_id", true);
  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.editReply(errorMessage("Ticket not found.") as never);
    return;
  }
  const actor = await usersRepo.byDiscordId(i.user.id);
  await ticketsRepo.setStatus(ticket.id, "closed", actor?.id ?? i.user.id);
  await notificationsRepo.create({
    userId: ticket.user_id,
    type: "ticket",
    title: "Ticket closed",
    body: `Your ticket "${ticket.subject}" was closed by staff.`,
  });
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ticket_close", targetId: ticket.id });
  await i.editReply(successMessage("Ticket Closed", `Ticket \`${ticketId.slice(-6)}\` closed.`) as never);
}

export async function handleAdminTicketClaim(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const ticketId = i.options.getString("ticket_id", true);
  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.editReply(errorMessage("Ticket not found.") as never);
    return;
  }
  const actor = await usersRepo.byDiscordId(i.user.id);
  await ticketsRepo.claim(ticket.id, actor?.id ?? i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ticket_claim", targetId: ticket.id });
  await i.editReply(successMessage("Ticket Claimed", `You have claimed ticket \`${ticketId.slice(-6)}\`.`) as never);
}

export async function handleAdminTicketPriority(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const ticketId = i.options.getString("ticket_id", true);
  const priority = i.options.getString("priority", true) as TicketRow["priority"];
  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.editReply(errorMessage("Ticket not found.") as never);
    return;
  }
  await ticketsRepo.setPriority(ticket.id, priority);
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ticket_priority", targetId: ticket.id, detail: priority });
  await i.editReply(successMessage("Priority Updated", `Ticket priority set to **${priorityBadge(priority)}**.`) as never);
}

// ---------------------------------------------------------------------------
// Admin: IP bans
// ---------------------------------------------------------------------------

export async function handleAdminIpBan(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const ip = i.options.getString("ip", true);
  const reason = i.options.getString("reason") ?? "No reason";
  const actor = await usersRepo.byDiscordId(i.user.id);
  await bannedIpsRepo.add({ ip, reason, bannedBy: actor?.id ?? i.user.id });
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ip_ban", targetId: ip, detail: reason });
  await i.editReply(successMessage("IP Banned", `\`${ip}\` has been banned.\nReason: ${reason}`) as never);
}

export async function handleAdminIpUnban(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const ip = i.options.getString("ip", true);
  await bannedIpsRepo.remove(ip);
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ip_unban", targetId: ip });
  await i.editReply(successMessage("IP Unbanned", `\`${ip}\` has been unbanned.`) as never);
}

export async function handleAdminIpList(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const list = await bannedIpsRepo.all();
  resetIds();
  const items: AnyComponent[] = [text(`## Banned IPs (${list.length})`), sep(false)];
  if (!list.length) {
    items.push(text("No banned IPs."));
  } else {
    for (const entry of list.slice(0, 10)) {
      items.push(text(`\`${entry.ip}\` — ${entry.reason}\n*Banned ${ts(entry.created_at)}*`));
      items.push(sep(false, 1));
    }
    if (list.length > 10) items.push(text(`*…and ${list.length - 10} more.*`));
  }
  await i.editReply({ ...cv2Message([container(items as never, COLOR.danger)]) } as never);
}

// ---------------------------------------------------------------------------
// Admin: announce / broadcast
// ---------------------------------------------------------------------------

export async function handleAdminAnnounce(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const message = i.options.getString("message", true);
  const channel = i.options.getChannel("channel") ?? i.channel;

  resetIds();
  await (channel as TextChannel).send({
    flags: 32768,
    components: [
      container(
        [
          text("## Announcement"),
          sep(false),
          text(message),
          sep(false),
          text(`*Posted by staff · ${new Date().toUTCString()}*`),
        ],
        COLOR.warning,
      ),
    ],
  } as never);

  await i.editReply(successMessage("Announced", "Announcement posted.") as never);
}

export async function handleAdminBroadcast(i: ChatInputCommandInteraction) {
  const message = i.options.getString("message", true);

  await requestConfirmation(i, {
    title: "Broadcast to all users",
    summary: `You are about to send a broadcast notification to **all registered users**.\n\nMessage:\n> ${message.slice(0, 200)}`,
    run: async (m) => {
      await m.deferReply({ ephemeral: true });
      const users = (await usersRepo.all?.()) ?? [];
      let sent = 0;

      for (const user of users.slice(0, 50)) {
        await notificationsRepo.create({
          userId: user.id,
          type: "system",
          title: "Broadcast",
          body: message,
        });
        sent++;
      }

      const actor = await usersRepo.byDiscordId(i.user.id);
      await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "broadcast", targetId: "all", detail: message.slice(0, 100) });
      await m.editReply(successMessage("Broadcast Sent", `Notification sent to ${sent} users.`) as never);
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: audit log
// ---------------------------------------------------------------------------

export async function handleAdminAudit(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const logs = await auditRepo.recent(20);
  resetIds();
  const items: AnyComponent[] = [text("## Recent Audit Log"), sep(false)];
  if (!logs.length) {
    items.push(text("No audit entries."));
  } else {
    for (const l of logs) {
      items.push(text(`**${l.action}** on \`${l.target_id ?? "—"}\`\n*Actor: \`${l.actor_id}\` · ${ts(l.created_at)}*`));
      items.push(sep(false, 1));
    }
  }
  items.push(row(btn("Full Audit Log", 5, { url: `${BASE_URL}/admin?tab=audit` })));
  await i.editReply({ ...cv2Message([container(items as never, COLOR.muted)]) } as never);
}

// ---------------------------------------------------------------------------
// Admin: server info
// ---------------------------------------------------------------------------

export async function handleAdminServer(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const guild = i.guild;
  if (!guild) {
    await i.editReply(errorMessage("No guild found.") as never);
    return;
  }
  resetIds();
  await i.editReply({
    ...cv2Message([
      container(
        [
          text(`## ${guild.name}`),
          sep(false),
          text(
            `**ID:** \`${guild.id}\`\n**Members:** ${guild.memberCount}\n**Channels:** ${guild.channels.cache.size}\n**Roles:** ${guild.roles.cache.size}\n**Created:** ${ts(guild.createdTimestamp)}`,
          ),
        ],
        COLOR.primary,
      ),
    ]),
  } as never);
}

// ---------------------------------------------------------------------------
// Admin: proxy management
// ---------------------------------------------------------------------------

export async function handleAdminProxyAdd(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const host = i.options.getString("host", true);
  const port = i.options.getInteger("port", true);
  const type = (i.options.getString("type") ?? "http") as "http" | "socks5";
  await proxiesRepo.add({ host, port, type });
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "proxy_add", targetId: `${host}:${port}` });
  await i.editReply(successMessage("Proxy Added", `\`${host}:${port}\` (${type}) added.`) as never);
}

export async function handleAdminProxyRemove(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const proxyId = i.options.getString("id", true);
  await proxiesRepo.remove(proxyId);
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "proxy_remove", targetId: proxyId });
  await i.editReply(successMessage("Proxy Removed", `Proxy \`${proxyId}\` removed.`) as never);
}

export async function handleAdminProxyList(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const list = await proxiesRepo.all();
  resetIds();
  const items: AnyComponent[] = [text(`## Proxies (${list.length})`), sep(false)];
  if (!list.length) {
    items.push(text("No proxies configured."));
  } else {
    for (const p of list.slice(0, 10)) {
      items.push(
        text(`\`${p.host}:${p.port}\` [${p.protocol}] — ${p.assigned_user_id ? `Assigned to \`${p.assigned_user_id}\`` : "Unassigned"}`),
      );
      items.push(sep(false, 1));
    }
  }
  await i.editReply({ ...cv2Message([container(items as never, COLOR.info)]) } as never);
}

export async function handleAdminProxyAssign(i: ChatInputCommandInteraction) {
  await i.deferReply({ ephemeral: true });
  const proxyId = i.options.getString("id", true);
  const targetUser = i.options.getUser("user", true);
  const user = await usersRepo.byDiscordId(targetUser.id) ?? await usersRepo.byId(targetUser.id);
  if (!user) {
    await i.editReply(errorMessage("User not found.") as never);
    return;
  }
  await proxiesRepo.assign(proxyId, user.id);
  const actor = await usersRepo.byDiscordId(i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "proxy_assign", targetId: proxyId, detail: user.id });
  await i.editReply(successMessage("Proxy Assigned", `Proxy \`${proxyId}\` assigned to **${user.username}**.`) as never);
}

// ---------------------------------------------------------------------------
// Staff reply notification — sends a nice DM to the ticket owner when staff responds
// ---------------------------------------------------------------------------

export async function notifyTicketReply(
  guild: Guild,
  ticket: TicketRow,
  staffTag: string,
  replyContent: string,
) {
  try {
    const member = await guild.members.fetch(ticket.discord_user_id).catch(() => null);
    if (!member) return;

    resetIds();
    const ticketCode = ticket.id.slice(-6).toUpperCase();
    const replyTimestamp = Math.floor(Date.now() / 1000);
    await member.send({
      flags: 32768,
      components: [
        container(
          [
            text("## 💬 Staff replied to your ticket"),
            sep(true),
            text(`**Ticket #${ticketCode}:** ${ticket.subject}`),
            sep(false),
            text(`**Staff:** ${staffTag}  **Replied:** <t:${replyTimestamp}:R>`),
            sep(false),
            text(`**Reply:**\n> ${replyContent.length > 300 ? replyContent.slice(0, 300) + "…" : replyContent}`),
            sep(false),
            row(btn("View Ticket", 5, { url: `${BASE_URL}/dash?ticket=${ticket.id}` })),
          ],
          COLOR.success,
        ),
      ],
    } as never);
  } catch {
    // DM may be blocked — non-fatal
  }
}

// ---------------------------------------------------------------------------
// Button: ticket_close
// ---------------------------------------------------------------------------

export async function handleButtonTicketClose(i: ButtonInteraction, ticketId: string) {
  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.reply({ ...errorMessage("No SkyUtils account found."), ephemeral: true } as never);
    return;
  }

  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.reply({ ...errorMessage("Ticket not found."), ephemeral: true } as never);
    return;
  }

  if (ticket.user_id !== user.id && !hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await i.reply({ ...errorMessage("You can only close your own tickets."), ephemeral: true } as never);
    return;
  }

  await ticketsRepo.setStatus(ticket.id, "closed", user.id);
  await notificationsRepo.create({
    userId: ticket.user_id,
    type: "ticket",
    title: "Ticket closed",
    body: `Your ticket "${ticket.subject}" has been closed. View the transcript on the dashboard.`,
  });

  resetIds();
  const closedTimestamp = Math.floor(Date.now() / 1000);
  await i.update({
    flags: 32768,
    components: [
      container(
        [
          text("## ✅ Ticket Closed"),
          sep(true),
          text("This ticket has been closed. The transcript is available on the dashboard."),
          sep(false),
          text(`**Closed:** <t:${closedTimestamp}:R>`),
          sep(false),
          row(btn("View Transcript", 5, { url: `${BASE_URL}/dash` })),
        ],
        COLOR.muted,
      ),
    ],
  } as never);

  // Archive the channel
  setTimeout(async () => {
    try {
      const ch = i.channel as TextChannel;
      if (ch) {
        await ch.setName(`${TICKET_ARCHIVE_PREFIX}${ch.name}`);
        await ch.permissionOverwrites.set([
          { id: i.guild!.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        ]);
      }
    } catch {
      // Non-fatal
    }
  }, TICKET_ARCHIVE_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Button: admin_ticket_claim
// ---------------------------------------------------------------------------

export async function handleButtonAdminClaim(i: ButtonInteraction, ticketId: string) {
  const actor = await usersRepo.byDiscordId(i.user.id);
  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.reply({ ...errorMessage("Ticket not found."), ephemeral: true } as never);
    return;
  }

  await ticketsRepo.claim(ticket.id, actor?.id ?? i.user.id);
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ticket_claim", targetId: ticket.id });

  resetIds();
  await i.reply({
    flags: 32832,
    components: [
      container(
        [
          text("## Ticket Claimed"),
          sep(false),
          text(`You have claimed ticket **${ticket.subject}**.\nRespond in this channel or via the admin panel.`),
        ],
        COLOR.success,
      ),
    ],
  } as never);
}

// ---------------------------------------------------------------------------
// Button: admin_ticket_close
// ---------------------------------------------------------------------------

export async function handleButtonAdminClose(i: ButtonInteraction, ticketId: string) {
  const actor = await usersRepo.byDiscordId(i.user.id);

  if (!hasStaffPermission(i) && !i.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    await i.reply({ ...errorMessage("You need Manage Channels permission."), ephemeral: true } as never);
    return;
  }

  const ticket = await ticketsRepo.byId(ticketId);
  if (!ticket) {
    await i.reply({ ...errorMessage("Ticket not found."), ephemeral: true } as never);
    return;
  }

  await ticketsRepo.setStatus(ticket.id, "closed", actor?.id ?? i.user.id);
  await notificationsRepo.create({
    userId: ticket.user_id,
    type: "ticket",
    title: "Ticket closed by staff",
    body: `Your ticket "${ticket.subject}" was closed by staff. View the transcript on the dashboard.`,
  });
  await auditRepo.log({ actorId: actor?.id ?? i.user.id, action: "ticket_close", targetId: ticket.id });

  resetIds();
  const closedTimestamp = Math.floor(Date.now() / 1000);
  await i.update({
    flags: 32768,
    components: [
      container(
        [
          text("## 🔒 Ticket Closed by Staff"),
          sep(true),
          text("This ticket has been closed by a staff member. Transcript saved."),
          sep(false),
          text(`**Closed:** <t:${closedTimestamp}:R>`),
          sep(false),
          row(btn("Admin Panel", 5, { url: `${BASE_URL}/admin?tab=tickets` })),
        ],
        COLOR.muted,
      ),
    ],
  } as never);
}

// ---------------------------------------------------------------------------
// Button: ticket_open_modal — show a modal to open a ticket
// ---------------------------------------------------------------------------

export async function handleButtonTicketOpenModal(i: ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_ticket_open")
    .setTitle("Open Support Ticket");

  const subjectInput = new TextInputBuilder()
    .setCustomId("subject")
    .setLabel("Subject")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Brief description of your issue")
    .setRequired(true)
    .setMaxLength(100);

  const messageInput = new TextInputBuilder()
    .setCustomId("message")
    .setLabel("Message")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Describe your issue in detail...")
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(subjectInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput),
  );

  await i.showModal(modal);
}

// ---------------------------------------------------------------------------
// Modal: modal_ticket_open — process modal submit and create Discord ticket
// ---------------------------------------------------------------------------

export async function handleModalTicketOpen(i: ModalSubmitInteraction) {
  await i.deferReply({ ephemeral: true });

  if (!i.guild) {
    await i.editReply(errorMessage("This can only be used in a server.") as never);
    return;
  }

  const discordId = i.user.id;
  const user = await usersRepo.byDiscordId(discordId);

  if (!user) {
    await i.editReply(
      errorMessage(`No SkyUtils account linked. Register at ${BASE_URL}`) as never,
    );
    return;
  }

  const subject = i.fields.getTextInputValue("subject");
  const message = i.fields.getTextInputValue("message");

  // Check for existing open ticket
  const existing = (await ticketsRepo.byUser(user.id)).find((t) => t.status === "open");
  if (existing) {
    await i.editReply(
      errorMessage(
        `You already have an open ticket: ${existing.channel_id ? `<#${existing.channel_id}>` : existing.subject}`,
      ) as never,
    );
    return;
  }

  // Find or create category
  let ticketCategory = i.guild.channels.cache.find(
    (c) => c.name.toLowerCase() === TICKETS_CATEGORY.toLowerCase() && c.type === ChannelType.GuildCategory,
  );
  if (!ticketCategory) {
    ticketCategory = await i.guild.channels.create({
      name: TICKETS_CATEGORY,
      type: ChannelType.GuildCategory,
    });
  }

  const channelName = `ticket-${i.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`;
  const permissionOverwrites: {
    id: string;
    allow?: bigint[];
    deny?: bigint[];
  }[] = [
    { id: i.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
  ];
  if (SUPPORT_ROLE_ID) {
    permissionOverwrites.push({
      id: SUPPORT_ROLE_ID,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
    });
  }

  const channel = await i.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: ticketCategory.id,
    permissionOverwrites,
  });

  const ticket = await ticketsRepo.create({
    userId: user.id,
    discordUserId: discordId,
    discordUserTag: i.user.tag,
    channelId: channel.id,
    subject,
    category: "general",
    priority: "normal",
  });

  // Save the opening message as a transcript entry
  await ticketsRepo.addMessage({
    ticketId: ticket.id,
    authorId: user.id,
    authorTag: i.user.tag,
    content: message,
    isStaff: false,
  });

  resetIds();
  const ticketCode = ticket.id.slice(-6).toUpperCase();
  const createdTimestamp = Math.floor(Date.now() / 1000);
  await (channel as TextChannel).send({
    flags: 32768,
    components: [
      container(
        [
          text(`# 🎫 Ticket #${ticketCode}`),
          sep(true),
          text(`**Subject:** ${subject}`),
          sep(false),
          text(
            `**Category:** \`general\`  **Priority:** ${priorityBadge("normal")}  **Status:** ${statusBadge("open")}\n` +
            `**Opened by:** <@${discordId}>  **Created:** <t:${createdTimestamp}:R>`,
          ),
          sep(false),
          text(`**Message:**\n${message}`),
          sep(false),
          row(
            btn("Close Ticket", 4, { customId: `ticket_close:${ticket.id}` }),
            btn("Dashboard", 5, { url: `${BASE_URL}/dash` }),
          ),
        ],
        COLOR.primary,
      ),
    ],
  } as never);

  await notificationsRepo.create({
    userId: user.id,
    type: "ticket",
    title: "Ticket opened",
    body: `Your support ticket "${subject}" has been created. A staff member will respond soon.`,
  });

  await i.editReply(
    successMessage("Ticket Created", `Your ticket has been created: <#${channel.id}>`) as never,
  );
}

// ---------------------------------------------------------------------------
// GuildMemberAdd — Welcomer
// ---------------------------------------------------------------------------

export async function handleGuildMemberAdd(member: import("discord.js").GuildMember) {
  const welcomeChannelId = await botSettingsRepo.get("welcome_channel_id");
  const welcomeMessage = await botSettingsRepo.get("welcome_message") ?? "Welcome to the server!";
  const welcomeTitle = await botSettingsRepo.get("welcome_title");
  // DM is enabled unless explicitly disabled via /welcome setup dm:false.
  const dmEnabled = await botSettingsRepo.get("welcome_dm") !== "0";

  // Try to send DM welcome using CV2
  if (dmEnabled) {
    try {
      resetIds();
      const dmChannel = await member.createDM();

      const dbUser = await usersRepo.byDiscordId(member.id);
      const active = dbUser ? await subscriptionsRepo.activeForUser(dbUser.id) : null;
      const plan = active ? await plansRepo.byId(active.plan_id) : null;

      await dmChannel.send({
      flags: 32768,
      components: [
        container(
          [
            section(
              [
                text(`## ${welcomeTitle ?? `Welcome to ${member.guild.name}!`}`),
                text(
                  `Hey **${member.displayName}**! ${welcomeMessage}\n\n` +
                  (dbUser
                    ? `**Account:** Linked (${plan?.name ?? "Free plan"})\n**Dashboard:** ${BASE_URL}/dash`
                    : `**Get started:** Register at ${BASE_URL} to link your Discord account and access all features.`),
                ),
              ],
              thumbnail(member.user.displayAvatarURL({ size: 64 })),
            ),
            sep(false),
            row(
              btn("Dashboard", 5, { url: BASE_URL + "/dash" }),
              btn("Support", 5, { url: BASE_URL + "/support" }),
            ),
          ],
          COLOR.primary,
        ),
      ],
      } as never);
    } catch {
      // DMs may be disabled — non-fatal
    }
  }

  // Post in welcome channel if configured
  if (welcomeChannelId) {
    try {
      const guild = member.guild;
      const channel = await guild.channels.fetch(welcomeChannelId);
      if (!channel?.isTextBased()) {
        console.error(`[bot] Welcome channel ${welcomeChannelId} not found or not a text channel.`);
        return;
      }
      resetIds();
      await channel.send({
        flags: 32768,
        components: [
          container(
            [
              section(
                [
                  text(
                    welcomeTitle
                      ? `## ${welcomeTitle}`
                      : `**${member.displayName}** just joined!`,
                  ),
                  text(`Welcome to **${guild.name}**, <@${member.id}>! ${welcomeMessage}`),
                ],
                thumbnail(member.user.displayAvatarURL({ size: 64 })),
              ),
              sep(false),
              row(btn("Dashboard", 5, { url: BASE_URL + "/dash" })),
            ],
            COLOR.success,
          ),
        ],
      } as never);
    } catch (err) {
      console.error("[bot] Welcome channel post failed:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Trial role management — assign when trial is claimed, remove when expired
// ---------------------------------------------------------------------------

/**
 * Assigns the Trial role to a Discord member when their trial is activated.
 * Called by the guildMemberAdd event and also by a periodic background task.
 */
export async function handleTrialRoleAssign(
  member: GuildMember,
): Promise<void> {
  if (!TRIAL_ROLE_ID) return;

  const dbUser = await usersRepo.byDiscordId(member.id);
  if (!dbUser) return;

  // Check if user has an active trial subscription
  const active = await subscriptionsRepo.activeForUser(dbUser.id);
  if (!active || active.plan_id !== "free_trial") return;

  // Check if trial_redemptions has discord_role_added = 0
  const redemption = await queryOne<{
    id: string;
    discord_role_added: number;
    redeemed_at: number;
  }>(`SELECT * FROM trial_redemptions WHERE user_id = ?`, [dbUser.id]);

  if (!redemption || redemption.discord_role_added === 1) return;

  try {
    const trialRole = member.guild.roles.cache.get(TRIAL_ROLE_ID);
    if (trialRole) {
      await member.roles.add(trialRole, "Trial membership activated");
    }
    // Mark role as added
    await execute(
      `UPDATE trial_redemptions SET discord_role_added = 1 WHERE user_id = ?`,
      [dbUser.id],
    );
    console.log(`[bot] Trial role added to ${member.user.tag}`);
  } catch (err) {
    console.error(`[bot] Failed to add trial role to ${member.user.tag}:`, err);
  }
}

/**
 * Removes the Trial role from members whose trial has expired.
 * Should be called periodically (e.g., every minute) as a background task.
 */
export async function handleExpiredTrialRoles(
  guild: Guild,
): Promise<void> {
  if (!TRIAL_ROLE_ID) return;

  const trialRole = guild.roles.cache.get(TRIAL_ROLE_ID);
  if (!trialRole) return;

  const now = Date.now();
  const expiredMembers = await guild.members.list();

  for (const member of expiredMembers.values()) {
    if (!member.roles.cache.has(TRIAL_ROLE_ID)) continue;

    const dbUser = await usersRepo.byDiscordId(member.id);
    if (!dbUser) continue;

    const active = await subscriptionsRepo.activeForUser(dbUser.id);
    if (active && active.plan_id === "free_trial") {
      // Check if the trial subscription has expired
      if (active.expires_at && active.expires_at <= now) {
        try {
          await member.roles.remove(trialRole, "Trial expired");
          console.log(`[bot] Trial role removed from ${member.user.tag} (expired)`);
        } catch (err) {
          console.error(`[bot] Failed to remove trial role from ${member.user.tag}:`, err);
        }
      }
    } else {
      // No active trial — remove role
      try {
        await member.roles.remove(trialRole, "Trial ended / upgraded");
        console.log(`[bot] Trial role removed from ${member.user.tag} (no active trial)`);
      } catch (err) {
        console.error(`[bot] Failed to remove trial role from ${member.user.tag}:`, err);
      }
    }
  }
}
