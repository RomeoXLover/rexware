import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  // /pricing is an alias that sends visitors to the pricing section on the
  // landing page (used by Discord bot links and external references).
  beforeLoad: () => {
    throw redirect({ to: "/", hash: "pricing" });
  },
});
