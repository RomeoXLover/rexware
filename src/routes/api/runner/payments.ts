import process from "node:process";
import { createFileRoute } from "@tanstack/react-router";

import { paymentsRepo, usersRepo, plansRepo } from "@/lib/repos.server";

// /api/runner/payments
// GET: bot container polls every 10 seconds to find paid invoices that need
//      in-game DM notification. Returns payments + the MC username to msg.
//      Marks them notified so the same payment is never double-reported.
// Authenticated via RUNNER_TOKEN header.

function authed(request: Request): boolean {
  const expected = process.env.RUNNER_TOKEN?.trim() || "";
  const provided = request.headers.get("x-runner-token")?.trim() || "";
  return !expected || provided === expected;
}

export const Route = createFileRoute("/api/runner/payments")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authed(request)) {
          return new Response("forbidden", { status: 403 });
        }

        // Fetch paid invoices the bot hasn't notified about yet.
        const pending = await paymentsRepo.pendingBotNotification(20);

        const result: {
          id: string;
          mcUsername: string;
          planName: string;
          coin: string;
          amountUsd: number;
        }[] = [];

        for (const payment of pending) {
          // Look up the player's Minecraft username from their account.
          const user = await usersRepo.byId(payment.user_id);
          const mcUsername = user?.mc_username ?? null;
          if (!mcUsername) continue; // no MC username known yet — skip for now

          // Resolve plan/plugin name for the message.
          let planName = payment.kind;
          if (payment.kind === "subscription" && payment.plan_id) {
            const plan = await plansRepo.byId(payment.plan_id);
            if (plan) planName = plan.name;
          } else if (payment.kind === "plugin") {
            planName = payment.plugin_id === "discord-spam" ? "Discord Spam" : "Discord Auto-Reply";
          } else if (payment.kind === "slot") {
            planName = `${payment.slot_qty} Extra Bot Slot${payment.slot_qty !== 1 ? "s" : ""}`;
          }

          result.push({
            id: payment.id,
            mcUsername,
            planName,
            coin: payment.coin.toUpperCase(),
            amountUsd: payment.amount_usd,
          });

          // Mark as notified so the next poll skips this payment.
          await paymentsRepo.markNotified(payment.id);
        }

        return Response.json({ payments: result });
      },
    },
  },
});
