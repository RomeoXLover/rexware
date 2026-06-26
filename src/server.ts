// Load .env into process.env for the web server (the Discord bot already does
// this in src/bot/index.ts). Without it, server-side code — e.g. payment
// callback auth reading CRYPTAPI_CALLBACK_SECRET — never sees vars defined in
// .env. dotenv does not override vars already present in process.env, so any
// platform-injected values take precedence and this only fills in the gaps.
import "dotenv/config";

import "./lib/error-capture";
import "@/lib/api/bots.functions";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const REQUEST_TIMEOUT_MS = 30_000;

function withTimeout(promise: Promise<Response>): Promise<Response> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      resolve(new Response(JSON.stringify({ error: "Request timed out" }), {
        status: 504,
        headers: { "content-type": "application/json" },
      }));
    }, REQUEST_TIMEOUT_MS);
    promise.then(
      (res) => { clearTimeout(timer); resolve(res); },
      () => { clearTimeout(timer); resolve(new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })); },
    );
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await withTimeout(handler.fetch(request, env, ctx));
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
