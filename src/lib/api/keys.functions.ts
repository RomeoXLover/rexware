import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireAdmin, requireUser } from "../auth.server";
import {
  usersRepo,
  keysRepo,
  plansRepo,
  pluginsRepo,
  subscriptionsRepo,
  notificationsRepo,
  settingsRepo,
  auditRepo,
} from "../repos.server";
import { PLUGIN_IDS } from "./plugins.functions";

// ---------------------------------------------------------------------------
// Redeem keys
//
// Key types:
//   subscription — grants a plan for N days (single-use)
//   plugin       — grants a plugin (single-use)
//   master       — grants admin access + admin plan (reusable, anyone can claim)
// ---------------------------------------------------------------------------

const codeSchema = z
  .string()
  .trim()
  .min(1, "Enter a key")
  .transform((s) => s.toUpperCase());

// --- User: redeem -----------------------------------------------------------

export const redeemKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: codeSchema }))
  .handler(async ({ data }) => {
    let user;
    try {
      user = await requireUser();
    } catch (e) {
      throw new Error("You must be signed in to redeem a key.");
    }
    const key = await keysRepo.byCode(data.code);
    if (!key) throw new Error("Invalid key");

    // master keys are reusable — skip the "already redeemed" check
    if (key.type !== "master" && key.redeemed_by) {
      throw new Error("This key has already been redeemed");
    }

    // --- master key: grant admin + admin plan (reusable) ----------------
    if (key.type === "master") {
      await usersRepo.setAdmin(user.id, true);
      await subscriptionsRepo.setForUser(user.id, "admin", 36500);

      if ((await settingsRepo.get(user.id)).notify_payments !== 0) {
        await notificationsRepo.create({
          userId: user.id,
          type: "gift",
          title: "Master key redeemed!",
          body: "You have been granted full admin access.",
        });
      }
      await auditRepo.log({
        actorId: user.id,
        action: "redeem_master_key",
        targetId: user.id,
        detail: `keyId=${key.id}`,
      });
      return { ok: true as const, kind: "master" as const, label: "Admin Access" };
    }
    // ---------------------------------------------------------------------

    if (key.type === "subscription") {
      if (!key.plan_id) throw new Error("Key is misconfigured");
      const plan = await plansRepo.byId(key.plan_id);
      if (!plan) throw new Error("Plan no longer exists");
      const days = key.duration_days ?? 30;
      await subscriptionsRepo.setForUser(user.id, key.plan_id, days);
      await keysRepo.markRedeemed(key.id, user.id);

      if ((await settingsRepo.get(user.id)).notify_payments !== 0) {
        await notificationsRepo.create({
          userId: user.id,
          type: "gift",
          title: "Key redeemed!",
          body: `You unlocked the ${plan.name} plan for ${days} days.`,
        });
      }
      return {
        ok: true as const,
        kind: "subscription" as const,
        label: plan.name,
      };
    }

    // plugin
    if (!key.plugin_id) throw new Error("Key is misconfigured");
    await pluginsRepo.recordPurchase({
      userId: user.id,
      pluginId: key.plugin_id,
      amountUsd: 0,
    });
    await keysRepo.markRedeemed(key.id, user.id);

    if ((await settingsRepo.get(user.id)).notify_payments !== 0) {
      await notificationsRepo.create({
        userId: user.id,
        type: "gift",
        title: "Key redeemed!",
        body: `You unlocked the ${key.plugin_id} plugin.`,
      });
    }
    return {
      ok: true as const,
      kind: "plugin" as const,
      label: key.plugin_id,
    };
  });

// --- Admin: create / list / delete ------------------------------------------

const pluginIdSchema = z.enum(PLUGIN_IDS);

export const adminCreateKey = createServerFn({ method: "POST" })
  .inputValidator(
    z
      .object({
        type: z.enum(["subscription", "plugin", "master"]),
        planId: z.string().optional(),
        pluginId: pluginIdSchema.optional(),
        durationDays: z.number().int().min(1).optional(),
        note: z.string().max(200).optional(),
        quantity: z.number().int().min(1).max(100).default(1),
      })
      .refine(
        (d) => (d.type === "subscription" ? !!d.planId : true),
        { message: "planId is required for subscription keys", path: ["planId"] },
      )
      .refine(
        (d) => (d.type === "plugin" ? !!d.pluginId : true),
        { message: "pluginId is required for plugin keys", path: ["pluginId"] },
      )
      .refine(
        (d) => (d.type === "master" ? true : true),
        { message: "", path: [] },
      ),
  )
  .handler(async ({ data }) => {
    const actor = await requireAdmin();

    if (data.type === "subscription" && data.planId) {
      if (!await plansRepo.byId(data.planId)) throw new Error("Plan not found");
    }

    const created = [];
    for (let i = 0; i < data.quantity; i++) {
      created.push(
        await keysRepo.create({
          type: data.type,
          planId: data.type === "subscription" ? data.planId : null,
          pluginId: data.type === "plugin" ? data.pluginId : null,
          durationDays:
            data.type === "subscription" ? data.durationDays ?? 30 : null,
          note: data.note ?? null,
          createdBy: actor.id,
        }),
      );
    }

    await auditRepo.log({
      actorId: actor.id,
      action: "create_keys",
      detail: `type=${data.type} qty=${data.quantity}`,
    });

    return { ok: true as const, keys: created };
  });

export const adminGetKeys = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireAdmin();
    return await keysRepo.list();
  },
);

export const adminDeleteKey = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const actor = await requireAdmin();
    await keysRepo.delete(data.id);
    await auditRepo.log({
      actorId: actor.id,
      action: "delete_key",
      targetId: data.id,
    });
    return { ok: true as const };
  });
