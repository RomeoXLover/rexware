import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  destroySession,
  getSessionUser,
  getBanStatus,
  setReferralCookie,
  type BanReason,
} from "../auth.server";
import { globalChatRepo, usersRepo } from "../repos.server";
import { isOwnerId } from "../config.server";

// Returns the current Discord user from the signed session cookie, or null.
// Runs server-only so AUTH_SECRET and the JWT never reach the client.
export const fetchSessionUser = createServerFn({ method: "GET" }).handler(
  async () => {
    return getSessionUser();
  },
);

// Returns whether the current session user is an admin or owner.
export const fetchIsAdmin = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = getSessionUser();
    if (!session) return false;
    const row = await usersRepo.byId(session.id);
    return !!(row?.is_admin) || isOwnerId(session.id);
  },
);

// Returns the ban status for the current request: "account" | "ip" | null.
// Safe to call in beforeLoad — never throws.
export const fetchBanStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<BanReason> => {
    return await getBanStatus();
  },
);

// Clears the session cookie. The client redirects afterwards.
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  destroySession();
  return { ok: true };
});

// Stores a referral code in a short-lived cookie when a visitor arrives via a
// ?ref=CODE link. Attribution happens after they sign up (see discord.callback).
export const captureReferral = createServerFn({ method: "POST" })
  .inputValidator(z.object({ code: z.string().min(1).max(32) }))
  .handler(async ({ data }) => {
    const code = data.code.trim().toUpperCase();
    if (/^[A-Z0-9]{4,32}$/.test(code)) setReferralCookie(code);
    return { ok: true };
  });

// Public maintenance status. Safe to call in beforeLoad — never throws.
// `bypass` is true when the current user may skip the gate:
//   - admins always bypass
//   - beta testers bypass unless "full lockdown" is enabled
export const fetchMaintenance = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean; message: string; bypass: boolean }> => {
    // Fail-open: the maintenance gate guards a public landing page, so if the
    // datastore is briefly unreachable we must NOT take the whole site down.
    // Any failure resolves to "maintenance off" rather than throwing.
    try {
      const { botSettingsRepo, usersRepo } = await import("../repos.server");
      const enabled = await botSettingsRepo.get("maintenance_mode") === "1";
      const full = await botSettingsRepo.get("maintenance_full") === "1";
      const message =
        await botSettingsRepo.get("maintenance_message") ??
        "We're performing scheduled maintenance. Please check back soon.";

      let bypass = false;
      const session = getSessionUser();
      if (session) {
        const u = await usersRepo.byId(session.id);
        bypass = !!u?.is_admin || (!full && !!u?.is_beta);
      }
      return { enabled, message, bypass };
    } catch (err) {
      console.error("[v0] fetchMaintenance failed, defaulting to off:", err);
      return { enabled: false, message: "", bypass: false };
    }
  },
);

// Delete a message the current user owns. Returns true if deleted.
export const deleteOwnMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ messageId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const session = getSessionUser();
    if (!session) throw new Error("UNAUTHORIZED");

    const msg = await globalChatRepo.byId(data.messageId);
    if (!msg) return { deleted: false, reason: "not_found" };
    if (msg.user_id !== session.id) return { deleted: false, reason: "forbidden" };

    await globalChatRepo.deleteMessage(data.messageId);
    return { deleted: true };
  });
