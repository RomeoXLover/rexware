import {
  ApplicationCommandType,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from "discord.js";

// ---------------------------------------------------------------------------
// Slash command definitions.
// All commands are guild-scoped for instant updates.
// Admin-only commands use default_member_permissions = 0 (admin only).
// ---------------------------------------------------------------------------

export const COMMANDS = [
  // ── /ai ──────────────────────────────────────────────────────────────────
  {
    name: "ai",
    type: ApplicationCommandType.ChatInput,
    description: "Toggle AI chat replies on or off. When on, I'll respond in DMs and when you @mention me.",
  },

  // ── /review ─────────────────────────────────────────────────────────────────
  {
    name: "review",
    type: ApplicationCommandType.ChatInput,
    description: "Submit a review for SkyUtils.",
    options: [
      {
        name: "stars",
        type: ApplicationCommandOptionType.Integer,
        description: "Star rating from 1 to 5.",
        required: true,
        min_value: 1,
        max_value: 5,
      },
      {
        name: "feedback",
        type: ApplicationCommandOptionType.String,
        description: "Your review text.",
        required: true,
        max_length: 1000,
      },
    ],
  },

  // ── /ping ─────────────────────────────────────────────────────────────────
  {
    name: "ping",
    type: ApplicationCommandType.ChatInput,
    description: "Check if the bot is alive and see system status.",
  },

  // ── /info ─────────────────────────────────────────────────────────────────
  {
    name: "info",
    type: ApplicationCommandType.ChatInput,
    description: "View your SkyUtils account info, plan, and subscription status.",
  },

  // ── /ticket ───────────────────────────────────────────────────────────────
  {
    name: "ticket",
    type: ApplicationCommandType.ChatInput,
    description: "Support ticket management.",
    options: [
      {
        name: "open",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Open a new support ticket.",
        options: [
          {
            name: "subject",
            type: ApplicationCommandOptionType.String,
            description: "Brief description of your issue.",
            required: true,
            max_length: 100,
          },
          {
            name: "category",
            type: ApplicationCommandOptionType.String,
            description: "Ticket category.",
            required: false,
            choices: [
              { name: "General Support", value: "general" },
              { name: "Billing / Payments", value: "billing" },
              { name: "Technical Issue", value: "technical" },
              { name: "Account / Ban Appeal", value: "account" },
              { name: "Feature Request", value: "feature" },
            ],
          },
          {
            name: "priority",
            type: ApplicationCommandOptionType.String,
            description: "Ticket priority — Elite & Champion only. Ignored on lower plans.",
            required: false,
            choices: [
              { name: "Normal", value: "normal" },
              { name: "High", value: "high" },
              { name: "Urgent", value: "urgent" },
            ],
          },
        ],
      },
      {
        name: "close",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Close your current open ticket.",
      },
      {
        name: "status",
        type: ApplicationCommandOptionType.Subcommand,
        description: "View the status of your open tickets.",
      },
      {
        name: "reopen",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Reopen your last closed ticket.",
      },
    ],
  },

  // ── /plan ─────────────────────────────────────────────────────────────────
  {
    name: "plan",
    type: ApplicationCommandType.ChatInput,
    description: "View available plans and pricing.",
  },

  // ── /help ─────────────────────────────────────────────────────────────────
  {
    name: "help",
    type: ApplicationCommandType.ChatInput,
    description: "Show all available SkyUtils bot commands.",
  },

  // ── /faq ──────────────────────────────────────────────────────────────────
  {
    name: "faq",
    type: ApplicationCommandType.ChatInput,
    description: "Frequently asked questions about SkyUtils.",
  },

  // ── /tos ──────────────────────────────────────────────────────────────────
  {
    name: "tos",
    type: ApplicationCommandType.ChatInput,
    description: "View the SkyUtils Terms of Service.",
  },

  // ── /welcome ──────────────────────────────────────────────────────────────
  {
    name: "welcome",
    type: ApplicationCommandType.ChatInput,
    description: "Welcome panel management.",
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      {
        name: "setup",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Post the welcome/join panel in a channel.",
        options: [
          {
            name: "channel",
            type: ApplicationCommandOptionType.Channel,
            description: "The channel where the panel will be posted.",
            required: true,
          },
          {
            name: "title",
            type: ApplicationCommandOptionType.String,
            description: "Custom title for the panel (default: Welcome to SkyUtils).",
            required: false,
            max_length: 100,
          },
          {
            name: "description",
            type: ApplicationCommandOptionType.String,
            description: "Custom description text for the panel.",
            required: false,
            max_length: 1000,
          },
          {
            name: "dm",
            type: ApplicationCommandOptionType.Boolean,
            description: "Also send a welcome DM to new members (default: true).",
            required: false,
          },
        ],
      },
    ],
  },

  // ── /admin ────────────────────────────────────────────────────────────────
  // Admin-only: restricted by default_member_permissions
  {
    name: "admin",
    type: ApplicationCommandType.ChatInput,
    description: "Admin panel commands.",
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      // User management
      {
        name: "user",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage users.",
        options: [
          {
            name: "info",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Look up a Discord user in the database.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "ban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Ban a user from SkyUtils.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to ban.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the ban.",
                required: false,
                max_length: 256,
              },
            ],
          },
          {
            name: "unban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Unban a user from SkyUtils.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to unban.",
                required: true,
              },
            ],
          },
          {
            name: "grant-admin",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Grant admin privileges to a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "revoke-admin",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Revoke admin privileges from a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "subscription",
            type: ApplicationCommandOptionType.Subcommand,
            description: "View a user's active subscription.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "warn",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Issue a warning to a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to warn.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the warning.",
                required: true,
                max_length: 512,
              },
            ],
          },
          {
            name: "warns",
            type: ApplicationCommandOptionType.Subcommand,
            description: "View all warnings for a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "note-add",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Add an internal staff note to a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
              {
                name: "content",
                type: ApplicationCommandOptionType.String,
                description: "Note content (staff-only, never visible to user).",
                required: true,
                max_length: 1000,
              },
            ],
          },
          {
            name: "notes",
            type: ApplicationCommandOptionType.Subcommand,
            description: "View all staff notes for a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
        ],
      },

      // Subscription management (admin set/revoke)
      {
        name: "subscription",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage user subscriptions.",
        options: [
          {
            name: "set",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Manually assign a plan to a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
              {
                name: "plan",
                type: ApplicationCommandOptionType.String,
                description: "Plan ID to assign.",
                required: true,
                choices: [
                  { name: "Free Trial", value: "free_trial" },
                  { name: "Rookie", value: "starter" },
                  { name: "Elite", value: "pro" },
                  { name: "Champion", value: "enterprise" },
                  { name: "Admin", value: "admin" },
                ],
              },
              {
                name: "days",
                type: ApplicationCommandOptionType.Integer,
                description: "Duration in days (default: 30).",
                required: false,
                min_value: 1,
                max_value: 3650,
              },
            ],
          },
          {
            name: "revoke",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Revoke the active subscription from a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
        ],
      },

      // Ticket management
      {
        name: "ticket",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage support tickets.",
        options: [
          {
            name: "list",
            type: ApplicationCommandOptionType.Subcommand,
            description: "List all open tickets.",
            options: [
              {
                name: "status",
                type: ApplicationCommandOptionType.String,
                description: "Filter by status.",
                required: false,
                choices: [
                  { name: "Open", value: "open" },
                  { name: "In Progress", value: "in_progress" },
                  { name: "Closed", value: "closed" },
                ],
              },
            ],
          },
          {
            name: "close",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Force-close a ticket.",
            options: [
              {
                name: "ticket_id",
                type: ApplicationCommandOptionType.String,
                description: "The ticket ID.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for closing.",
                required: false,
              },
            ],
          },
          {
            name: "claim",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Claim a ticket to handle it.",
            options: [
              {
                name: "ticket_id",
                type: ApplicationCommandOptionType.String,
                description: "The ticket ID.",
                required: true,
              },
            ],
          },
          {
            name: "priority",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Set the priority of a ticket.",
            options: [
              {
                name: "ticket_id",
                type: ApplicationCommandOptionType.String,
                description: "The ticket ID.",
                required: true,
              },
              {
                name: "priority",
                type: ApplicationCommandOptionType.String,
                description: "New priority.",
                required: true,
                choices: [
                  { name: "Low", value: "low" },
                  { name: "Normal", value: "normal" },
                  { name: "High", value: "high" },
                  { name: "Urgent", value: "urgent" },
                ],
              },
            ],
          },
          {
            name: "panel",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Post the ticket panel in a channel.",
            options: [
              {
                name: "channel",
                type: ApplicationCommandOptionType.Channel,
                description: "The channel to post the panel in.",
                required: false,
              },
            ],
          },
        ],
      },

      // Discord moderation
      {
        name: "mod",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Discord server moderation actions.",
        options: [
          {
            name: "kick",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Kick a member from the server.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The member to kick.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the kick.",
                required: false,
                max_length: 256,
              },
            ],
          },
          {
            name: "mute",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Timeout (mute) a member.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The member to mute.",
                required: true,
              },
              {
                name: "duration",
                type: ApplicationCommandOptionType.Integer,
                description: "Duration in minutes (default: 10, max: 1440).",
                required: false,
                min_value: 1,
                max_value: 1440,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the mute.",
                required: false,
                max_length: 256,
              },
            ],
          },
          {
            name: "unmute",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Remove timeout from a member.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The member to unmute.",
                required: true,
              },
            ],
          },
          {
            name: "purge",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Bulk delete messages in the current channel.",
            options: [
              {
                name: "amount",
                type: ApplicationCommandOptionType.Integer,
                description: "Number of messages to delete (1-100).",
                required: true,
                min_value: 1,
                max_value: 100,
              },
            ],
          },
        ],
      },

      // Post panels (TOS, pricelist, rules)
      {
        name: "post",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Post informational panels into a channel.",
        options: [
          {
            name: "tos",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Post the Terms of Service panel.",
            options: [
              {
                name: "channel",
                type: ApplicationCommandOptionType.Channel,
                description: "Target channel (defaults to the current channel).",
                required: false,
              },
            ],
          },
          {
            name: "pricelist",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Post the live price list, generated from the database.",
            options: [
              {
                name: "channel",
                type: ApplicationCommandOptionType.Channel,
                description: "Target channel (defaults to the current channel).",
                required: false,
              },
            ],
          },
          {
            name: "rules",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Post the server rules panel.",
            options: [
              {
                name: "channel",
                type: ApplicationCommandOptionType.Channel,
                description: "Target channel (defaults to the current channel).",
                required: false,
              },
            ],
          },
        ],
      },

      // Stats
      {
        name: "stats",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Show SkyUtils platform statistics.",
      },

      // Ticket panel
      {
        name: "ticket-panel",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Post the support ticket panel in a channel.",
        options: [
          {
            name: "channel",
            type: ApplicationCommandOptionType.Channel,
            description: "The channel where the panel will be posted.",
            required: true,
          },
        ],
      },

      // Server info
      {
        name: "server",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Show Discord server statistics and health.",
      },

      // Audit log
      {
        name: "audit",
        type: ApplicationCommandOptionType.Subcommand,
        description: "View recent admin audit log entries.",
        options: [
          {
            name: "limit",
            type: ApplicationCommandOptionType.Integer,
            description: "Number of entries to show (default: 10, max: 25).",
            required: false,
            min_value: 1,
            max_value: 25,
          },
          {
            name: "action",
            type: ApplicationCommandOptionType.String,
            description: "Filter by action type.",
            required: false,
            choices: [
              { name: "Ban User", value: "ban_user" },
              { name: "Unban User", value: "unban_user" },
              { name: "Grant Admin", value: "grant_admin" },
              { name: "Revoke Admin", value: "revoke_admin" },
              { name: "Warn User", value: "warn_user" },
              { name: "Claim Ticket", value: "claim_ticket" },
              { name: "Close Ticket", value: "close_ticket" },
              { name: "Announce", value: "announce" },
            ],
          },
        ],
      },

      // DM broadcast
      {
        name: "broadcast",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Send a DM to all registered users (use with caution!).",
        options: [
          {
            name: "message",
            type: ApplicationCommandOptionType.String,
            description: "The message to send.",
            required: true,
            max_length: 1500,
          },
          {
            name: "title",
            type: ApplicationCommandOptionType.String,
            description: "Optional message title.",
            required: false,
            max_length: 100,
          },
        ],
      },

      // Announce
      {
        name: "announce",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Send an announcement to a channel.",
        options: [
          {
            name: "channel",
            type: ApplicationCommandOptionType.Channel,
            description: "Target channel.",
            required: true,
          },
          {
            name: "message",
            type: ApplicationCommandOptionType.String,
            description: "The announcement message.",
            required: true,
            max_length: 2000,
          },
          {
            name: "title",
            type: ApplicationCommandOptionType.String,
            description: "Optional announcement title.",
            required: false,
            max_length: 100,
          },
        ],
      },

      // Proxy management
      {
        name: "proxy",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage proxies.",
        options: [
          {
            name: "add",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Add a proxy to the pool.",
            options: [
              {
                name: "host",
                type: ApplicationCommandOptionType.String,
                description: "Proxy hostname or IP.",
                required: true,
              },
              {
                name: "port",
                type: ApplicationCommandOptionType.Integer,
                description: "Proxy port.",
                required: true,
                min_value: 1,
                max_value: 65535,
              },
              {
                name: "protocol",
                type: ApplicationCommandOptionType.String,
                description: "Proxy protocol.",
                required: false,
                choices: [
                  { name: "HTTP", value: "http" },
                  { name: "SOCKS5", value: "socks5" },
                ],
              },
              {
                name: "username",
                type: ApplicationCommandOptionType.String,
                description: "Auth username.",
                required: false,
              },
              {
                name: "password",
                type: ApplicationCommandOptionType.String,
                description: "Auth password.",
                required: false,
              },
              {
                name: "label",
                type: ApplicationCommandOptionType.String,
                description: "Optional label/tag.",
                required: false,
                max_length: 50,
              },
              {
                name: "assign",
                type: ApplicationCommandOptionType.User,
                description: "Optionally assign to a user immediately.",
                required: false,
              },
            ],
          },
          {
            name: "remove",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Remove a proxy by ID.",
            options: [
              {
                name: "id",
                type: ApplicationCommandOptionType.String,
                description: "The proxy ID.",
                required: true,
              },
            ],
          },
          {
            name: "list",
            type: ApplicationCommandOptionType.Subcommand,
            description: "List all proxies in the pool.",
          },
          {
            name: "assign",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Assign a proxy to a user.",
            options: [
              {
                name: "id",
                type: ApplicationCommandOptionType.String,
                description: "The proxy ID.",
                required: true,
              },
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to assign to.",
                required: true,
              },
            ],
          },
        ],
      },

      // IP ban
      {
        name: "ip",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage IP bans.",
        options: [
          {
            name: "ban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Ban an IP address.",
            options: [
              {
                name: "address",
                type: ApplicationCommandOptionType.String,
                description: "The IP address to ban.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the ban.",
                required: false,
              },
            ],
          },
          {
            name: "unban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Unban an IP address.",
            options: [
              {
                name: "address",
                type: ApplicationCommandOptionType.String,
                description: "The IP address to unban.",
                required: true,
              },
            ],
          },
          {
            name: "list",
            type: ApplicationCommandOptionType.Subcommand,
            description: "List all banned IPs.",
          },
        ],
      },
    ],
  },

  // ── /owner ─────────────────────────────────────────────────────────────────
  // Owner-only commands that bypass Discord's default_member_permissions check.
  // These are identical to /admin but available to users in the OWNER_IDS list
  // even if they don't have Discord Administrator permission.
  {
    name: "owner",
    type: ApplicationCommandType.ChatInput,
    description: "Owner-only commands (bypasses Discord admin permission).",
    options: [
      // User management
      {
        name: "user",
        type: ApplicationCommandOptionType.SubcommandGroup,
        description: "Manage users.",
        options: [
          {
            name: "info",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Look up a Discord user in the database.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "ban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Ban a user from SkyUtils.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to ban.",
                required: true,
              },
              {
                name: "reason",
                type: ApplicationCommandOptionType.String,
                description: "Reason for the ban.",
                required: false,
                max_length: 256,
              },
            ],
          },
          {
            name: "unban",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Unban a user from SkyUtils.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user to unban.",
                required: true,
              },
            ],
          },
          {
            name: "grant-admin",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Grant admin privileges to a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
          {
            name: "revoke-admin",
            type: ApplicationCommandOptionType.Subcommand,
            description: "Revoke admin privileges from a user.",
            options: [
              {
                name: "user",
                type: ApplicationCommandOptionType.User,
                description: "The Discord user.",
                required: true,
              },
            ],
          },
        ],
      },

      // Stats
      {
        name: "stats",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Show SkyUtils platform statistics.",
      },

      // Audit log
      {
        name: "audit",
        type: ApplicationCommandOptionType.Subcommand,
        description: "View recent admin audit log entries.",
        options: [
          {
            name: "limit",
            type: ApplicationCommandOptionType.Integer,
            description: "Number of entries to show (default: 10, max: 25).",
            required: false,
            min_value: 1,
            max_value: 25,
          },
        ],
      },

      // Broadcast
      {
        name: "broadcast",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Send a DM to all registered users (use with caution!).",
        options: [
          {
            name: "message",
            type: ApplicationCommandOptionType.String,
            description: "The message to send.",
            required: true,
            max_length: 1500,
          },
          {
            name: "title",
            type: ApplicationCommandOptionType.String,
            description: "Optional message title.",
            required: false,
            max_length: 100,
          },
        ],
      },

      // Announce
      {
        name: "announce",
        type: ApplicationCommandOptionType.Subcommand,
        description: "Send an announcement to a channel.",
        options: [
          {
            name: "channel",
            type: ApplicationCommandOptionType.Channel,
            description: "Target channel.",
            required: true,
          },
          {
            name: "message",
            type: ApplicationCommandOptionType.String,
            description: "The announcement message.",
            required: true,
            max_length: 2000,
          },
          {
            name: "title",
            type: ApplicationCommandOptionType.String,
            description: "Optional announcement title.",
            required: false,
            max_length: 100,
          },
        ],
      },
    ],
  },
];
