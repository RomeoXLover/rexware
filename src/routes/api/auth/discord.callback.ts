import { createFileRoute } from "@tanstack/react-router";
import { getRequestUrl } from "@tanstack/react-start/server";

import {
  createSession,
  exchangeCodeForUser,
  getRedirectUri,
  getClientIp,
  getReferralCookie,
  clearReferralCookie,
  verifyState,
} from "@/lib/auth.server";
import {
  usersRepo,
  bannedIpsRepo,
  subscriptionsRepo,
  plansRepo,
  userIpsRepo,
} from "@/lib/repos.server";
import { ensureSchema } from "@/lib/db.server";

export const Route = createFileRoute("/api/auth/discord/callback")({
  server: {
    handlers: {
      GET: async () => {
        await ensureSchema();

        const requestUrl = getRequestUrl();
        const code = requestUrl.searchParams.get("code");
        const state = requestUrl.searchParams.get("state");
        const errorParam = requestUrl.searchParams.get("error");

        const fail = (reason: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `/?auth_error=${encodeURIComponent(reason)}`,
            },
          });

        if (errorParam) return fail(errorParam);
        if (!code) return fail("missing_code");
        if (!verifyState(state)) return fail("invalid_state");

        // Block banned IPs from completing OAuth
        const clientIp = getClientIp();
        if (clientIp && await bannedIpsRepo.isBanned(clientIp)) {
          return fail("account_banned");
        }

        try {
          const redirectUri = getRedirectUri(requestUrl);
          const { user } = await exchangeCodeForUser(
            code,
            redirectUri,
          );

          // Salva utente nel database
          const dbUser = await usersRepo.upsertOnLogin({
            id: user.id,
            username: user.username,
            globalName: user.globalName,
            avatarUrl: user.avatarUrl,
            email: user.email,
          });

          // Block banned accounts from completing login
          if (dbUser.is_banned) throw new Error("account_banned");

          // Attribute the referral if this visitor arrived via a ?ref= link.
          const refCode = getReferralCookie();
          if (refCode) {
            await usersRepo.setReferredByCode(dbUser.id, refCode);
            clearReferralCookie();
          }

          // Record the IP this user logged in from (for admin review)
          if (clientIp) await userIpsRepo.record(dbUser.id, clientIp);

          // Auto-assign admin plan to admins (perpetual, no expiry)
          if (dbUser.is_admin) {
            const adminPlan = await plansRepo.byId("admin");
            if (adminPlan) {
              const existing = await subscriptionsRepo.activeForUser(dbUser.id);
              if (!existing || existing.plan_id !== "admin") {
                const sub = await subscriptionsRepo.create(dbUser.id, "admin");
                await subscriptionsRepo.activate(sub.id, 100 * 365 * 24 * 60 * 60 * 1000);
              }
            }
          }

          createSession({ ...user, is_owner: dbUser.is_owner });

        } catch (err) {
          const message = (err as Error).message;
          console.error("Discord callback error:", message);
          if (message === "account_banned") return fail("account_banned");
          // Pass through specific Discord error codes so the client can show a targeted message.
          // All other codes fall back to the generic oauth_failed dialog.
          if (message.startsWith("discord_")) return fail(message);
          return fail("oauth_failed");
        }

        return new Response(null, {
          status: 302,
          headers: { Location: "/dash" },
        });
      },
    },
  },
});
