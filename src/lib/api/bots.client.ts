/**
 * Direct-fetch client layer for bot server functions.
 * Bypasses TanStack Start's module bundling so these calls work on the client.
 *
 * Uses the raw TanStack Start _serverFn protocol:
 * - GET for read-only functions (args in ?payload= query param)
 * - POST for mutating functions (args in JSON body)
 * - Server uses TanStack's Seroval for serialization
 */

const BASE = "/_serverFn";

async function callServerFn<T>(
  functionId: string,
  method: "GET" | "POST",
  args?: unknown[],
): Promise<T> {
  let url = `${BASE}/${functionId}`;

  if (method === "GET" && args && args.length > 0) {
    url += `?payload=${encodeURIComponent(JSON.stringify(args))}`;
  }

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-tsr-serverFn": "true",
    },
    body: method === "POST" && args ? JSON.stringify(args) : undefined,
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Server function call failed: ${res.status} ${res.statusText}`);
  }

  // TanStack Start returns Seroval-encoded JSON: { p: { k: [...keys], v: [...] } }
  // The result is at p.v[0] for success
  const json = await res.json();
  if (json?.p?.v?.[0] !== undefined) {
    return json.p.v[0] as T;
  }

  return json as T;
}

// --- Inline types (no server imports) ---
type BotRunRow = {
  id: string;
  status: "pending" | "starting" | "running" | "stopped" | "error";
  error: string | null;
} | null;

type PublicBot = {
  id: string;
  name: string;
  mcUsername: string;
  serverHost: string;
  serverPort: number;
  mcVersion: string;
  authMode: "offline" | "microsoft" | "ssid";
  accessToken: string | null;
  ssid: string | null;
  uuid: string | null;
  message: string;
  reply: string[];
  replyActions: string[];
  triggerKeyword: string | null;
  webhookUrl: string;
  proxy: string;
  messageInterval: string;
  replyDelay: string;
  replyCooldown: string;
  afkInterval: string;
  reconnectDelay: string;
  inactivityTimeout: string;
  createdAt: number;
  updatedAt: number;
  run: BotRunRow;
};

const MC_VERSIONS = [
  "1.8.8", "1.9.4", "1.10.2", "1.11.2", "1.12.2",
  "1.13.2", "1.14.4", "1.15.2", "1.16.5", "1.17.1",
  "1.18.2", "1.19.4", "1.20.4", "1.20.6", "1.21.1",
  "1.21.3", "1.21.4", "1.22.1",
];

// --- Function IDs (base64url-encoded JSON: {file, export}) ---
const IDS = {
  getMyBots: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0IjoiZ2V0TXlCb3RzIn0",
  getMyUsage: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0IjoiZ2V0TXlVc2FnZSJ9",
  createBot: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0IjoiY3JlYXRlQm90In0",
  updateBot: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0IjoidXBkYXRlQm90In0",
  deleteBot: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0IjoiZGVsZXRlQm90In0",
  startBot: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0Ijoic3RhcnRCb3QifQ",
  stopBot: "eyJmaWxlIjoiL3NyYy9saWIvYXBpL2JvdHMuZnVuY3Rpb25zLnRzIiwiZXhwb3J0Ijoic3RvcEJvdCJ9",
} as const;

// --- Client functions ---

// GET functions
export const getMyBots = () =>
  callServerFn<{
    bots: PublicBot[];
    dockerAvailable: boolean;
    maxBots: number;
    hoursLimit: number;
    hoursUsedToday: number;
    hoursLimitReached: boolean;
    hoursJustStopped: number;
  }>(IDS.getMyBots, "GET");

export const getMyUsage = () =>
  callServerFn<{
    hoursLimit: number;
    hoursUsedToday: number;
    hoursLimitReached: boolean;
  }>(IDS.getMyUsage, "GET");

// POST functions
export const createBot = ({ data }: { data: Omit<PublicBot, "id" | "run" | "createdAt" | "updatedAt"> }) =>
  callServerFn<{ ok: true; bot: PublicBot }>(IDS.createBot, "POST", [data]);

export const updateBot = ({ data }: { data: Partial<PublicBot> & { id: string } }) =>
  callServerFn<{ ok: true; bot: PublicBot }>(IDS.updateBot, "POST", [data]);

export const deleteBot = ({ data }: { data: { id: string } }) =>
  callServerFn<{ ok: true }>(IDS.deleteBot, "POST", [data]);

export const startBot = ({ data }: { data: { id: string } }) =>
  callServerFn<{ ok: true; run: BotRunRow; dockerAvailable: boolean }>(
    IDS.startBot,
    "POST",
    [data],
  );

export const stopBot = ({ data }: { data: { id: string } }) =>
  callServerFn<{ ok: true }>(IDS.stopBot, "POST", [data]);

export type { PublicBot, BotRunRow };
export { MC_VERSIONS as BOT_MC_VERSIONS };
