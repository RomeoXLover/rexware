import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { LoginDialogProvider } from "@/components/LoginDialog";
import { PreferencesProvider } from "@/lib/preferences";

// Applied before hydration so light-mode users don't see a dark flash.
const NO_FLASH_THEME = `(function(){try{var p=JSON.parse(localStorage.getItem('mf_prefs_v1')||'{}');var t=p.theme==='light'?'light':'dark';var r=document.documentElement;r.classList.add(t);r.style.colorScheme=t;if(p.language){r.lang=p.language;}}catch(e){document.documentElement.classList.add('dark');}})();`;

function NotFoundComponent() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[600px] -z-10 opacity-60"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden="true"
      />
      <div className="w-full max-w-md text-center">
        <p className="text-[7rem] font-bold leading-none tracking-tighter text-foreground/90 sm:text-[9rem]">
          404
        </p>
        <h1 className="mt-2 text-balance text-xl font-semibold tracking-tight">
          This page doesn&apos;t exist
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          The page you&apos;re looking for may have been moved, renamed, or never existed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
          <Link
            to="/dash"
            className="inline-flex items-center justify-center rounded-lg border border-border/60 bg-card/40 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 text-foreground">
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-[600px] -z-10 opacity-60"
        style={{ background: "var(--gradient-hero)" }}
        aria-hidden="true"
      />
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-red-900/40 bg-red-950/30">
          <TriangleAlert className="h-7 w-7 text-red-400" />
        </div>
        <h1 className="text-balance text-xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
          An unexpected error occurred on our end. You can try again or head back home.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-border/60 bg-card/40 px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=5" },
      { title: "RexWare" },
      { name: "description", content: "RexWare Auto-Beaming Systems" },
      { name: "author", content: "RexWare Team" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <LoginDialogProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </LoginDialogProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
