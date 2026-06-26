import { createFileRoute, redirect } from "@tanstack/react-router";
import { getRequestUrl } from "@tanstack/react-start/server";
import { createSession } from "@/lib/auth.server";
import { usersRepo, subscriptionsRepo, plansRepo } from "@/lib/repos.server";

export const Route = createFileRoute("/api/auth/key-login")({
  server: {
    handlers: {
      GET: async () => {
        const requestUrl = getRequestUrl();
        const key = requestUrl.searchParams.get("key")?.trim();

        if (!key) {
          return redirect({ to: "/?auth_error=invalid_key" });
        }

        const user = await usersRepo.byId(key);
        if (!user) {
          return redirect({ to: "/?auth_error=user_not_found" });
        }

        if (user.is_banned) {
          return redirect({ to: "/?auth_error=account_banned" });
        }

        // Auto-assign admin plan to admins if they don't already have it
        if (user.is_admin) {
          const adminPlan = await plansRepo.byId("admin");
          if (adminPlan) {
            const existing = await subscriptionsRepo.activeForUser(user.id);
            if (!existing || existing.plan_id !== "admin") {
              const sub = await subscriptionsRepo.create(user.id, "admin");
              await subscriptionsRepo.activate(sub.id, 100 * 365 * 24 * 60 * 60 * 1000);
            }
          }
        }

        createSession({
          id: user.id,
          username: user.username,
          globalName: user.global_name ?? null,
          avatarUrl: user.avatar_url ?? "",
          email: user.email ?? null,
        });

        return redirect({ to: "/dash" });
      },
    },
  },
});
