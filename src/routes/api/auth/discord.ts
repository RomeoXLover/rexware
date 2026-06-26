import { createFileRoute } from "@tanstack/react-router";
import { getRequestUrl } from "@tanstack/react-start/server";

import {
  buildAuthorizeUrl,
  createState,
  getRedirectUri,
} from "@/lib/auth.server";

// GET /api/auth/discord
// Starts the OAuth2 flow: sets a one-time CSRF state cookie and redirects
// the browser to Discord's consent screen.
export const Route = createFileRoute("/api/auth/discord")({
  server: {
    handlers: {
      GET: () => {
        const requestUrl = getRequestUrl();
        const redirectUri = getRedirectUri(requestUrl);
        const state = createState();
        const authorizeUrl = buildAuthorizeUrl(redirectUri, state);
        return new Response(null, {
          status: 302,
          headers: { Location: authorizeUrl },
        });
      },
    },
  },
});
