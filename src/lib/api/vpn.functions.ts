import { createServerFn } from "@tanstack/react-start";

import type { VpnStatus } from "../vpn.server";

// Public VPN/proxy gate status for the current request. Safe to call in
// `beforeLoad` — never throws. `blocked` is true when the visitor's IP is
// flagged (and detection is enabled); `reason` describes why.
export const fetchVpnStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<VpnStatus> => {
    const { getVpnStatus } = await import("../vpn.server");
    return getVpnStatus();
  },
);
