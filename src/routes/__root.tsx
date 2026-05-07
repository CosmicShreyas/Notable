import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "../components/AuthProvider";
import { ThemeProvider } from "../components/ThemeProvider";
import { FoldersProvider } from "../components/FoldersProvider";
import { SettingsProvider } from "../components/SettingsProvider";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Notable — AI notes for every meeting" },
      { name: "description", content: "Record meetings, transcribe instantly, and get AI summaries. A monochrome, focused notepad for modern teams." },
      { name: "author", content: "Notable" },
      { property: "og:title", content: "Notable — AI notes for every meeting" },
      { property: "og:description", content: "Record meetings, transcribe instantly, and get AI summaries." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Notable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap",
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/notable-logo.png",
        "data-notable-favicon": "primary",
      },
      {
        rel: "alternate icon",
        type: "image/png",
        href: "/notable-logo-light.png",
        "data-notable-favicon-light": "true",
      },
      {
        rel: "apple-touch-icon",
        href: "/notable-logo.png",
        "data-notable-apple-icon": "true",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SettingsProvider>
          <FoldersProvider>
            <Outlet />
          </FoldersProvider>
        </SettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
