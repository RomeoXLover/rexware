import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { pluginsRepo } from "@/lib/repos.server";

// /api/runner/captcha
// POST: a container raises a captcha challenge it hit (and which it will NOT
//       auto-solve). Returns the challenge id so the container can poll.
// GET ?id=...: the container polls for a user-provided solution. Returns the
//       status and (once solved) the token to feed back to Discord.
// Shares the RUNNER_TOKEN auth used by the other runner endpoints.

function authed(request: Request): boolean {
  const expected = process.env.RUNNER_TOKEN?.trim() || "";
  const provided = request.headers.get("x-runner-token")?.trim() || "";
  return !expected || provided === expected;
}

export const Route = createFileRoute("/api/runner/captcha")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authed(request)) return new Response("forbidden", { status: 403 });

        let body: {
          runId?: string;
          sitekey?: string;
          rqdata?: string | null;
          service?: string;
        };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const runId = body.runId;
        if (!runId || !body.sitekey) {
          return new Response("invalid", { status: 400 });
        }

        const run = await pluginsRepo.runById(runId);
        if (!run) return new Response("not found", { status: 404 });

        // Reuse an existing pending challenge for this run instead of stacking.
        const existing = await pluginsRepo.pendingCaptcha(runId);
        const challenge =
          existing ??
          (await pluginsRepo.createCaptcha({
            runId,
            sitekey: String(body.sitekey),
            rqdata: body.rqdata ?? null,
            service: body.service ?? "hcaptcha",
          }));

        return Response.json({ id: challenge.id, status: challenge.status });
      },

      GET: async ({ request }) => {
        if (!authed(request)) return new Response("forbidden", { status: 403 });

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return new Response("missing id", { status: 400 });

        const challenge = await pluginsRepo.captchaById(id);
        if (!challenge) return new Response("not found", { status: 404 });

        return Response.json({
          id: challenge.id,
          status: challenge.status,
          solution: challenge.status === "solved" ? challenge.solution : null,
        });
      },
    },
  },
});
