import { createFileRoute } from "@tanstack/react-router";
import { getRequestUrl } from "@tanstack/react-start/server";

import { verifyCallbackSecret } from "@/lib/cryptapi.server";
import {
  paymentsRepo,
  subscriptionsRepo,
  notificationsRepo,
  plansRepo,
  pluginsRepo,
  usersRepo,
  grantReferralReward,
  query,
  queryOne,
  execute,
  newId,
} from "@/lib/repos.server";

// GET /api/payments/callback
// CryptAPI calls this URL on each confirmation. We authenticate via a shared
// secret embedded in the callback URL, then advance the payment + subscription
// state. Responding with the literal "*ok*" tells CryptAPI to stop retrying.
//
// Money is never marked paid by the client — only this server-side webhook,
// driven by on-chain confirmations, can activate a subscription.
export const Route = createFileRoute("/api/payments/callback")({
  server: {
    handlers: {
      GET: async () => {
        const url = getRequestUrl();
        const q = url.searchParams;

        const paymentId = q.get("payment_id");
        const secret = q.get("secret");

        if (!paymentId || !verifyCallbackSecret(secret)) {
          console.log("payment callback rejected: bad secret/id");
          return new Response("invalid", { status: 403 });
        }
console.log("[callback] params", Object.fromEntries(q.entries()));
        const payment = await paymentsRepo.byId(paymentId);
        if (!payment) {
          return new Response("not found", { status: 404 });
        }

        // Already finalized — acknowledge so CryptAPI stops calling.
        if (payment.status === "paid") {
          return new Response("*ok*", { status: 200 });
        }

        const confirmations = Number(q.get("confirmations") ?? "0");
        const txid = q.get("txid_in") ?? q.get("txid") ?? undefined;
        // CryptAPI sends the received amount in the coin's units.
        const receivedCrypto =
          q.get("value_coin") ?? q.get("value_coin_convert") ?? undefined;
        const pending = q.get("pending");

        // 0-conf / mempool: mark as confirming but do not activate.
        if (confirmations < 1 || pending === "1") {
          if (payment.status === "waiting") {
            await paymentsRepo.updateStatus(paymentId, "confirming", {
              receivedCrypto,
              txid,
            });
            await notificationsRepo.create({
              userId: payment.user_id,
              type: "payment",
              title: "Payment detected",
              body: `We've seen your ${payment.coin.toUpperCase()} transaction and are waiting for it to confirm.`,
            });
          }
          // Not yet confirmed — ask CryptAPI to keep notifying.
          return new Response("not confirmed", { status: 200 });
        }

        // Confirmed (>= 1 confirmation): finalize.
        await paymentsRepo.updateStatus(paymentId, "paid", { receivedCrypto, txid });

        // Credit the buyer's referrer (15% of the amount actually paid).
        // Idempotent on payment id, so re-delivery never double-credits.
        await grantReferralReward({
          id: payment.id,
          user_id: payment.user_id,
          amount_usd: payment.amount_usd,
        });

        if (payment.kind === "plugin" && payment.plugin_id) {
          // Grant the lifetime plugin purchase.
          await pluginsRepo.recordPurchase({
            userId: payment.user_id,
            pluginId: payment.plugin_id,
            amountUsd: payment.amount_usd,
            paymentId: payment.id,
          });
          const label =
            payment.plugin_id === "discord-spam"
              ? "Discord Spam"
              : "Discord Auto-Reply";
          await notificationsRepo.create({
            userId: payment.user_id,
            type: "success",
            title: "Plugin unlocked",
            body: `Your ${label} plugin is now active. Thank you!`,
          });
          return new Response("*ok*", { status: 200 });
        }

        if (payment.kind === "slot") {
          // Grant the purchased lifetime extra bot slots.
          const qty = payment.slot_qty || 0;
          if (qty > 0) {
            await usersRepo.addBotSlots(payment.user_id, qty);
          }
          await notificationsRepo.create({
            userId: payment.user_id,
            type: "success",
            title: "Extra slots unlocked",
            body: `${qty} extra bot slot(s) were added to your account. Thank you!`,
          });
          return new Response("*ok*", { status: 200 });
        }

        // Bot hours purchase — store balance record
        if (payment.kind === "bot_hours") {
          // Hours are stored in the plan_id field (parsed from initBotHoursPayment)
          const hours = parseFloat(payment.plan_id ?? "0") || 0;
          if (hours > 0) {
            const balId = newId("bhbal");
            const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h expiry
            await execute(
              `INSERT INTO bot_hour_balances (id, user_id, hours, hours_used, expires_at, source, created_at)
               VALUES (?, ?, ?, 0, ?, 'purchase', ?)`,
              [balId, payment.user_id, hours, expiresAt, Date.now()],
            );
          }
          await notificationsRepo.create({
            userId: payment.user_id,
            type: "success",
            title: "Bot hours added",
            body: `${hours} bot hours have been added to your balance.`,
          });
          return new Response("*ok*", { status: 200 });
        }

        // Otherwise it's a subscription payment.
        const plan = payment.plan_id ? await plansRepo.byId(payment.plan_id) : null;
        const durationMs =
          plan?.interval === "lifetime"
            ? 100 * 365 * 24 * 60 * 60 * 1000
            : 30 * 24 * 60 * 60 * 1000;

        if (!payment.subscription_id) {
          console.error(`[callback] payment ${paymentId} has no subscription_id — cannot activate`);
          // NON rispondere *ok* così CryptAPI riprova, oppure gestisci il caso
          return new Response("missing subscription_id", { status: 500 });
        }

        await subscriptionsRepo.activate(payment.subscription_id, durationMs);
        await notificationsRepo.create({
          userId: payment.user_id,
          type: "success",
          title: "Payment confirmed",
          body: `Your ${plan?.name ?? "plan"} subscription is now active. Thank you!`,
        });

        return new Response("*ok*", { status: 200 });
      },
    },
  },
});
