import { createFileRoute } from "@tanstack/react-router";

import { getVpnStatus } from "@/lib/vpn.server";

// GET /api/vpn/check
// Machine-readable VPN/proxy gate for the current request. Returns 403 with a
// JSON error payload when the caller's IP is flagged, otherwise 200 { ok: true }.
// Useful for API clients, the bot, or edge checks that can't run the router's
// `beforeLoad`. Never throws — fails open on internal errors.
export const Route = createFileRoute("/api/vpn/check")({
  server: {
    handlers: {
      GET: async () => {
        const { blocked, reason } = await getVpnStatus();

        if (blocked) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "vpn_blocked",
              reason,
              message:
                "Access from VPN, proxy, or anonymized networks is not allowed.",
            }),
            {
              status: 403,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
              },
            },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
