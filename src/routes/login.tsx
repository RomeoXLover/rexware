import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useLoginDialog } from "@/components/LoginDialog";
import { fetchSessionUser } from "@/lib/api/auth.functions";

export const Route = createFileRoute("/login")({
  // Server-side: if a valid session cookie already exists, go straight to dash.
  beforeLoad: async () => {
    const user = await fetchSessionUser();
    if (user) {
      throw redirect({ to: "/dash" });
    }
  },
  component: LoginRedirect,
});

function LoginRedirect() {
  const navigate = useNavigate();
  const { open } = useLoginDialog();
  useEffect(() => {
    open();
    navigate({ to: "/", replace: true });
  }, [open, navigate]);
  return null;
}
