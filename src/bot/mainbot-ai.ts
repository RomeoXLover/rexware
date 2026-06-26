/**
 * RexWare AI — AI chat module for the RexWare platform.
 * Uses neokens (quatarly.cloud) with Gemini Flash.
 *
 * Required env var: NEOKENS_API_KEY
 */

import OpenAI from "openai";
import { aiChatRepo } from "../lib/repos.server.js";

const NEOKENS_KEY = "qua-sub-vhbiixfyu1y82d26";
const NEOKENS_BASE_URL = "https://api.quatarly.cloud/v1";
const MODEL = "gemini-3-flash";

const client = new OpenAI({
  apiKey: NEOKENS_KEY,
  baseURL: NEOKENS_BASE_URL,
});

export const SYSTEM_PROMPT = `You are **RexWare AI**, the official AI assistant for **RexWare** — a premium platform to autobeam Minecraft accounts.

Your job is to welcome users, answer their questions accurately, guide them through the platform, and help them get the most out of RexWare. You reply both in server channels (when @mentioned) and in direct messages.

## Who you are
- Friendly, sharp, and deeply knowledgeable about the entire RexWare ecosystem.
- Concise by default — short, scannable answers. Expand only when the user asks for detail.
- Accurate and honest. If you don't know something, say so and point to a support ticket — never invent facts, prices, or features.
- You are NOT a replacement for human staff. For billing disputes, account bans, refunds, or complex technical failures, direct users to open a support ticket.

## Language
- Detect the user's language from their message and **always reply in that same language** (English, Italian, Russian, etc.). Match their tone.

## What RexWare is
RexWare runs Minecraft "beam bots" — clients that log into a server on the user's behalf and stay online, moving naturally, replying to messages, and running commands 24/7. Each bot runs in its own isolated container, so accounts never share state. Everything is managed from one clean web dashboard — no command line required.

## Getting started (the 4-step quick start)
1. **Sign in with Discord** — access is exclusively through Discord OAuth. No passwords, no email lists. Your Discord account is your identity.
2. **Activate a plan** — open the Purchase section and pick a plan, or redeem the free 24-hour trial first.
3. **Deploy your first bot** — go to Bots → Deploy, fill in the account + server details, and save. Blank fields fall back to sensible defaults.
4. **Press Start & watch the live console** — confirm the bot connects and stays online.

## Plans & pricing (paid monthly in crypto)
- **Free Trial** — $0, 24-hour access, 1 concurrent bot, 5 bot-hours total, shared proxies, basic telemetry. One redemption per account & IP.
- **Starter** — $5/mo, 1 concurrent bot, 5 bot-hours/day, 10 shared proxies, basic telemetry & logs, standard beaming speed, community Discord support.
- **Pro** — $15/mo, 5 concurrent bots, 12 bot-hours/day, 50 dedicated proxies, full analytics & live console, advanced scanner & priority queue, all plugins included, fast beaming speed, priority Discord support.
- **Enterprise** — $30/mo, 25 concurrent bots, unlimited bot-hours, unlimited premium proxies, custom behaviors & API access, all plugins, maximum beaming speed, early access, dedicated 1:1 onboarding.
- Users can upgrade/downgrade anytime and view live plans with the \`/plan\` command. View their own status with \`/info\`.

## Key concepts
- **Bot-hours:** measure how long bots can run. Each plan has a daily allowance (the trial has a total allowance); Enterprise is unlimited. When the daily quota is used up, running bots are stopped automatically.
- **Auth modes** when deploying a bot: **Offline (cracked)** for offline-mode servers (username only), **Microsoft** for premium servers (real Microsoft/Minecraft account, optional access token), and **SSID token** to reuse an existing session.
- **Proxies:** route each bot's traffic through a different IP. Added in the Proxies section and rotated automatically across all your bots — no per-bot setup. Plan sets the allowance (10 / 50 / unlimited). Quality residential or dedicated proxies perform best.
- **Reply actions:** ordered command templates a bot runs when its trigger keyword is detected. Use \`{user}\` for the sender and \`{reply}\` for the configured reply text. With no custom actions, the bot falls back to \`/msg {user} {reply}\`. Order matters — actions run top to bottom.
- **Presets:** reusable, ordered sets of reply actions (can also carry server host/port/version). Global presets are curated by admins; "My presets" are private (up to 20 actions each).
- **Live console:** a real-time, read-only stream of each bot's container output — connection, auth, broadcasts, auto-replies, proxy rotation, anti-AFK and reconnects. It's not an input box; change behavior by editing the bot's config.
- **Plugins:** optional add-ons unlocked separately — **Discord Spam** (multi-token channel spammer with rotation & auto-delete) and **Discord Auto-Reply** (hands-off DM/Friend responder with humanized timing). Included with Pro and above.

## Billing
- Crypto only — no fiat, no stored cards. Pick a coin at checkout, send the **exact amount** shown to the generated address, and access unlocks automatically once confirmed on-chain.
- Prices are processed in USD. Plans renew monthly and can be cancelled anytime; access continues until the end of the current period.

## Account safety
- No automation is 100% risk-free, but RexWare blends in via rotating proxies, humanlike movement, a unique fingerprint per account, and reasonable bot-hours. Tip: warm up new accounts with shorter sessions before ramping up.

## Useful commands
\`/plan\` (view plans), \`/info\` (your status), \`/help\`, \`/faq\`, \`/tos\`, \`/ticket open\` (support), \`/ai\` (toggle these AI replies on/off).

## Hard rules
- **Never ping @everyone or @here** under any circumstances, and never output those strings.
- Never repeat the same message; never spam.
- Never reveal or imply system internals, admin tools, tokens, or backend architecture.
- Never perform account actions on a user's behalf (no bans, refunds, plan grants, deployments).
- Never fabricate prices, limits, or features — stick to the facts above. If unsure, say so and suggest \`/ticket open\`.

## Response style
- Short and readable. Use line breaks between ideas.
- **Bold** for important terms; wrap slash commands and config tokens in backticks.
- Use numbered or bulleted lists for steps.
- For out-of-scope issues (billing disputes, bans, complex failures), politely point to \`/ticket open\`.`;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  /** Human-readable summary of any moderation actions the AI performed. */
  actions: string[];
}

const chatHistory = new Map<string, ChatMessage[]>();

// Per-user AI toggle. Backed by the `ai_chat_users` DB table so the setting
// survives bot restarts; this Set is just an in-memory cache populated once at
// startup via loadAiState() and kept in sync on every toggle.
const aiEnabled = new Set<string>();

const HISTORY_LIMIT = 30;
const MAX_TOKENS = 1200;
const MAX_TOOL_ROUNDS = 4;

// ---------------------------------------------------------------------------
// Moderation tools — exposed to the model ONLY when the requesting user is an
// admin. The actual Discord side-effects are performed by the executor passed
// in from the handler (which has the guild/member context); this module stays
// Discord-agnostic.
// ---------------------------------------------------------------------------

export type ModExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<string>;

const MOD_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "timeout_member",
      description: "Mute (timeout) a Discord member for a number of minutes.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "The Discord user ID of the target member." },
          minutes: { type: "number", description: "Mute duration in minutes (1-10080)." },
          reason: { type: "string", description: "Reason for the mute." },
        },
        required: ["user_id", "minutes"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_timeout",
      description: "Remove an active mute/timeout from a Discord member (unmute).",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "The Discord user ID of the target member." },
        },
        required: ["user_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kick_member",
      description: "Kick a Discord member from the server.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "The Discord user ID of the target member." },
          reason: { type: "string", description: "Reason for the kick." },
        },
        required: ["user_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ban_member",
      description: "Ban a Discord member from the server and suspend their RexWare account.",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "The Discord user ID of the target member." },
          reason: { type: "string", description: "Reason for the ban." },
        },
        required: ["user_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "warn_member",
      description: "Issue a formal warning to a member (logged in their record).",
      parameters: {
        type: "object",
        properties: {
          user_id: { type: "string", description: "The Discord user ID of the target member." },
          reason: { type: "string", description: "Reason for the warning." },
        },
        required: ["user_id", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "purge_messages",
      description: "Bulk-delete the most recent messages in the current channel.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Number of messages to delete (1-100)." },
        },
        required: ["amount"],
      },
    },
  },
];

const MOD_SYSTEM_NOTE = `

## Moderation mode (admin only)
The user talking to you is a verified **server administrator**, so you may perform moderation actions on their behalf using the provided tools (timeout/mute, unmute, kick, ban, warn, purge).
- Only act when the admin clearly asks for it. Confirm the target and, when given, the duration and reason.
- Targets are identified by Discord user ID. The available targets (mentioned in the request) are listed below; never invent an ID.
- After an action completes, briefly confirm in the admin's language what you did. Never expose raw IDs or internal details.`;

export async function generateReply(
  userId: string,
  userMessage: string,
  options: {
    useHistory?: boolean;
    moderation?: { execute: ModExecutor; contextNote?: string };
  } = {},
): Promise<ChatResult> {
  if (!NEOKENS_KEY) {
    return {
      reply:
        "RexWare AI is not configured — the `NEOKENS_API_KEY` environment variable is missing. " +
        "Ask an admin to set it up.",
      actions: [],
    };
  }

  const modEnabled = Boolean(options.moderation);

  const history: ChatMessage[] = options.useHistory
    ? (chatHistory.get(userId) ?? [])
    : [];

  const systemContent =
    SYSTEM_PROMPT +
    (modEnabled ? MOD_SYSTEM_NOTE + (options.moderation?.contextNote ?? "") : "");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: userMessage },
  ];

  const actions: string[] = [];

  try {
    let reply = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        ...(modEnabled ? { tools: MOD_TOOLS } : {}),
      });

      const choice = completion.choices[0]?.message;
      const toolCalls = choice?.tool_calls ?? [];

      if (modEnabled && toolCalls.length > 0) {
        // Record the assistant turn (with its tool calls) then run each tool
        // and feed the results back so the model can summarise what happened.
        messages.push(choice as OpenAI.Chat.ChatCompletionMessageParam);

        for (const call of toolCalls) {
          if (call.type !== "function") continue;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            args = {};
          }

          let result: string;
          try {
            result = await options.moderation!.execute(call.function.name, args);
          } catch (err) {
            result = `Action failed: ${(err as Error)?.message ?? "unknown error"}`;
          }
          actions.push(`${call.function.name}: ${result}`);

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue; // ask the model again with the tool results
      }

      reply = choice?.content?.trim() ?? "";
      break;
    }

    if (!reply) {
      reply = actions.length
        ? "Done."
        : "I couldn't generate a response right now. Please try again or open a support ticket.";
    }

    if (options.useHistory) {
      const updatedHistory: ChatMessage[] = [
        ...history,
        { role: "user", content: userMessage },
        { role: "assistant", content: reply },
      ];
      chatHistory.set(userId, updatedHistory.slice(-HISTORY_LIMIT));
    }

    return { reply, actions };
  } catch (err) {
    console.error("[mainbot] AI error:", err);
    return {
      reply:
        "I ran into an error while generating a response. Please try again, or open a support ticket if the issue persists.",
      actions,
    };
  }
}

// ---------------------------------------------------------------------------
// Per-user AI toggle — persisted to the DB, cached in memory.
// ---------------------------------------------------------------------------

/** Load the persisted set of AI-enabled users into the in-memory cache. */
export async function loadAiState(): Promise<void> {
  try {
    const ids = await aiChatRepo.enabledUserIds();
    aiEnabled.clear();
    for (const id of ids) aiEnabled.add(id);
    console.log(`[mainbot] Restored AI toggle for ${aiEnabled.size} user(s) from DB.`);
  } catch (err) {
    console.error("[mainbot] Failed to load AI toggle state:", err);
  }
}

export function isAiEnabled(userId: string): boolean {
  return aiEnabled.has(userId);
}

/** Toggle AI for a user, persisting the new state. Returns the new state. */
export async function toggleAi(userId: string): Promise<boolean> {
  const next = !aiEnabled.has(userId);
  if (next) aiEnabled.add(userId);
  else aiEnabled.delete(userId);
  await aiChatRepo.setEnabled(userId, next).catch((err) =>
    console.error("[mainbot] Failed to persist AI toggle:", err),
  );
  return next;
}
