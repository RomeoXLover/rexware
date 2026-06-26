import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// POST /api/ai/generate-actions
//
// Multi-turn conversation endpoint backed by Gemini Flash via the neokens
// proxy. It maintains a per-dialog conversation so the AI can ask
// clarification questions before finalising the action list.
// ---------------------------------------------------------------------------

const NEOKENS_KEY = process.env.NEOKENS_API_KEY?.trim() || "";
const NEOKENS_BASE_URL = "https://api.quatarly.cloud/v1";
const MODEL = "gemini-3-flash";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatState {
  messages: ChatMessage[];
}

// In-memory per-dialog states (keyed by dialogId).
const STATES = new Map<string, ChatState>();

// Simple randomised IDs — sufficient for client-generated dialogs.
const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const SYSTEM_PROMPT = `You are a Minecraft bot action sequence builder.

The user describes what they want the bot to do. You respond with ONE short
clarification question when you need more info, OR output the final action
sequence in this exact format:

<actions>
/command 1
/command 2
...
</actions>

Rules:
- Each action is ONE Minecraft chat command starting with /
- The bot sends commands IN ORDER.
- Never use <actions> unless the user said the goal is clear.
- If the user says "done", "finish", "ready", "apply", "looks good" or similar → finalise.
- If you need more context (server-specific commands, game-mode specific steps),
  ask ONE short question at a time.
- You may suggest commands like /l sb, /l skyblock, /warp, /party invite, etc.`;

function getState(dialogId: string): ChatState {
  if (!STATES.has(dialogId)) {
    STATES.set(dialogId, { messages: [{ role: "assistant", content: SYSTEM_PROMPT }] });
  }
  return STATES.get(dialogId)!;
}

function ensureUserMessage(state: ChatState, userText: string) {
  state.messages.push({ role: "user", content: userText });
}

async function callGemini(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${NEOKENS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NEOKENS_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "unknown error");
    throw new Error(`Gemini proxy error ${res.status}: ${txt}`);
  }

  const data: unknown = await res.json();
  const choice = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
  return choice?.message?.content?.trim() ?? "";
}

function extractActions(text: string): string[] {
  const m = text.match(/<actions>([\s\S]*?)<\/actions>/);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/"));
}

export const Route = createFileRoute("/api/ai/generate-actions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!NEOKENS_KEY) {
          return new Response(
            JSON.stringify({ error: "AI is not configured on the server." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: {
          dialogId?: string;
          userMessage?: string;
        };

        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "bad json" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const dialogId = body.dialogId?.trim();
        const userMessage = body.userMessage?.trim();

        if (!dialogId || !userMessage) {
          return new Response(JSON.stringify({ error: "dialogId and userMessage required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const state = getState(dialogId);
        ensureUserMessage(state, userMessage);

        try {
          const assistantReply = await callGemini(state.messages);
          state.messages.push({ role: "assistant", content: assistantReply });

          const actions = extractActions(assistantReply);
          const isDone = actions.length > 0;

          return new Response(
            JSON.stringify({
              reply: assistantReply,
              actions,
              isDone,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (err) {
          return new Response(
            JSON.stringify({ error: (err as Error).message }),
            {
              status: 502,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
      },
    },
  },
});

// Exported helper so the client can generate a fresh dialogId without an
// unnecessary server round-trip.
export function createDialogId(): string {
  return uid();
}
