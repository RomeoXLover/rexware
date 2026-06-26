import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { pluginsRepo, botRunsRepo, notificationsRepo, settingsRepo } from "@/lib/repos.server";
import type { BotRunRow } from "@/lib/repos.server";
import { isDockerAvailable, stopAndRemoveContainer } from "@/lib/docker.server";
import { PENDING_CHATS } from "./world";

// POST /api/runner/callback
// Each bot container POSTs here to report lifecycle status (starting | running |
// stopped | error) and also AI chat enqueue requests (action=chat).
// Authenticated by the shared RUNNER_TOKEN injected into each container.

type RunnerStatus = "starting" | "running" | "stopped" | "error";
const VALID: RunnerStatus[] = ["starting", "running", "stopped", "error"];

export const Route = createFileRoute("/api/runner/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.RUNNER_TOKEN?.trim() || "";
        const provided = request.headers.get("x-runner-token")?.trim() || "";
        if (expected && provided !== expected) {
          return new Response("forbidden", { status: 403 });
        }

        let body: {
          runId?: string;
          botId?: string;
          status?: string;
          error?: string | null;
          stats?: Record<string, number>;
          action?: string;
          sender?: string;
          text?: string;
        };
        try {
          body = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        // ── Handle AI chat enqueue (Minecraft bot or Discord plugin) ──────────
        if (body.action === "chat" && body.text) {
          const botId = body.botId?.trim();

          // Try Minecraft bot run lookup first (runId starts with "brun_").
          if (body.runId) {
            const botRun = await botRunsRepo.byId(body.runId);
            if (botRun) {
              PENDING_CHATS.set(body.runId, {
                sender: body.sender ?? null,
                text: String(body.text),
                ts: Date.now(),
              });
              return new Response("ok", { status: 200 });
            }
          }

          // Try plugin run lookup.
          if (botId) {
            // Discord plugin runs: store in pending outbox via pluginsRepo.
            // We don't have a direct plugin enqueue here, but we can look up the
            // latest active run for this plugin and store a pending chat.
            // For now, acknowledge the chat and let the plugin's own outbox handle it.
            // (Plugin chat flows through Discord's own webhook/outbox mechanism.)
            return new Response("ok", { status: 200 });
          }

          return new Response("not found", { status: 404 });
        }

        // ── Handle lifecycle status updates ───────────────────────────────────
        const runId = body.runId;
        const status = body.status as RunnerStatus | undefined;
        if (!runId || !status || !VALID.includes(status)) {
          return new Response("invalid", { status: 400 });
        }

        // Try Discord plugin run lookup first, then Minecraft bot run.
        let run = await pluginsRepo.runById(runId);
        let botRun = run ? null : await botRunsRepo.byId(runId);
        if (!run && !botRun) {
          return new Response("not found", { status: 404 });
        }

        if (run) {
          // Discord plugin lifecycle.
          await pluginsRepo.setRunStatus(runId, status, {
            error: body.error ?? undefined,
          });

          if (status === "error") {
            const settings = await settingsRepo.get(run.user_id);
            if (settings.notify_bots !== 0) {
              await notificationsRepo.create({
                userId: run.user_id,
                type: "bot",
                title: "Bot run failed",
                body: body.error
                  ? `Your ${run.plugin_id} run stopped: ${body.error}`
                  : `Your ${run.plugin_id} run stopped unexpectedly.`,
              });
            }
          }

          if ((status === "stopped" || status === "error") && run.container_id) {
            if (await isDockerAvailable()) {
              try {
                await stopAndRemoveContainer(run.container_id);
              } catch {
                // best-effort
              }
            }
          }
        } else if (botRun) {
          // Minecraft bot lifecycle — update status via botRunsRepo.
          await botRunsRepo.setStatus(runId, status as BotRunRow["status"]);
        }

        return new Response("*ok*", { status: 200 });
      },
    },
  },
});
