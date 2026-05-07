import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../components/ThemeProvider";
import { useAuth } from "../components/AuthProvider";
import { getGoogleLoginUrl } from "../lib/api";
import { Sun, Moon, Sparkles, Mic, FileText } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in - Notable" },
      {
        name: "description",
        content: "Sign in to Notable with your Google account to record meetings and capture AI-powered notes.",
      },
    ],
  }),
});

function LoginPage() {
  const { theme, toggle } = useTheme();
  const { user, signInWithToken, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useMemo(
    () => (typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search)),
    [],
  );

  useEffect(() => {
    if (!authLoading && user) {
      const redirectTo = searchParams.get("redirect_to");
      if (redirectTo) {
        window.location.assign(redirectTo);
        return;
      }
      void navigate({ to: "/" });
    }
  }, [authLoading, navigate, searchParams, user]);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;

    setLoading(true);
    void signInWithToken(token)
      .then(() => {
        const redirectTo = searchParams.get("redirect_to");
        if (redirectTo) {
          window.location.assign(redirectTo);
          return;
        }
        return navigate({ to: "/" });
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Sign-in failed");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate, searchParams, signInWithToken]);

  const handleGoogle = async () => {
    setLoading(true);
    setError(null);

    try {
      const targetAfterLogin =
        typeof window === "undefined"
          ? "http://localhost:5173/"
          : resolvePostLoginTarget(searchParams, window.location.origin);
      const redirectTo =
        typeof window === "undefined"
          ? `http://localhost:5173/login?redirect_to=${encodeURIComponent(targetAfterLogin)}`
          : `${window.location.origin}/login?redirect_to=${encodeURIComponent(targetAfterLogin)}`;
      const { authorization_url } = await getGoogleLoginUrl(redirectTo);
      window.location.assign(authorization_url);
    } catch (nextError) {
      setLoading(false);
      setError(nextError instanceof Error ? nextError.message : "Unable to start Google sign-in");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[420px] w-[420px] rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--foreground), transparent)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-32 -z-10 h-[380px] w-[380px] rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--foreground), transparent)" }}
      />

      <header className="flex items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
            N
          </div>
          <span className="font-serif-display text-xl">Notable</span>
        </Link>
        <button
          onClick={toggle}
          aria-label="Toggle theme"
          className="rounded-md border border-border p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-12 px-6 pb-16 pt-10 lg:grid-cols-2 lg:gap-16 lg:pt-20">
        <section className="flex flex-col justify-center">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            AI notes for every meeting
          </div>
          <h1 className="mt-5 font-serif-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Notes that <em className="italic">listen</em>,
            <br /> so you can think.
          </h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground">
            Notable records your meetings, transcribes them instantly, and turns the noise into clean,
            shareable summaries.
          </p>

          <ul className="mt-8 space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/10 text-foreground">
                <Mic className="h-3.5 w-3.5" />
              </span>
              One-click recording with live waveform
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/10 text-foreground">
                <FileText className="h-3.5 w-3.5" />
              </span>
              Auto-summaries, action items, and follow-ups
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground/10 text-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              Ask anything about any meeting, instantly
            </li>
          </ul>
        </section>

        <section className="flex items-center justify-center">
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-8 backdrop-blur"
            style={{ boxShadow: "var(--shadow-elevated)" }}
          >
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-lg font-bold text-background">
                N
              </div>
              <h2 className="mt-5 font-serif-display text-3xl">Welcome to Notable</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to start recording and organizing your meetings.
              </p>
            </div>

            <button
              onClick={handleGoogle}
              disabled={loading}
              className="group mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
                  <span className="loading-shimmer-text">Signing you in...</span>
                </span>
              ) : (
                <>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.96h5.52c-.24 1.44-1.74 4.22-5.52 4.22-3.32 0-6.03-2.75-6.03-6.14S8.68 6.1 12 6.1c1.89 0 3.16.8 3.88 1.49l2.65-2.55C16.83 3.55 14.62 2.6 12 2.6 6.94 2.6 2.85 6.69 2.85 11.75S6.94 20.9 12 20.9c6.93 0 9.2-4.86 9.2-7.4 0-.5-.05-.88-.12-1.3H12z"
                    />
                    <path
                      fill="#34A853"
                      d="M3.88 7.34l3.18 2.34C7.94 7.84 9.82 6.5 12 6.5c1.5 0 2.62.5 3.5 1.3l2.6-2.5C16.4 3.7 14.4 2.7 12 2.7 8.3 2.7 5.1 4.84 3.88 7.34z"
                    />
                    <path
                      fill="#4A90E2"
                      d="M21.08 12.2c0-.5-.05-.88-.12-1.3H12v3.96h5.52c-.27 1.62-1.95 4.22-5.52 4.22v3.82c3.97 0 9.08-2.6 9.08-10.7z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M3.88 16.66l3.2-2.46c-.34-.93-.53-1.92-.53-2.95 0-1.03.2-2.03.53-2.95L3.88 5.84A9.18 9.18 0 0 0 2.85 11.75c0 1.49.34 2.9.94 4.16l.09.75z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </button>

            {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}

            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              SECURE SIGN-IN
              <div className="h-px flex-1 bg-border" />
            </div>

            <p className="text-center text-xs text-muted-foreground">
              By continuing you agree to Notable's{" "}
              <a href="#" className="underline-offset-4 hover:underline">
                Terms
              </a>{" "}
              and{" "}
              <a href="#" className="underline-offset-4 hover:underline">
                Privacy Policy
              </a>
              .
            </p>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Only Google sign-in is supported right now.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

function resolvePostLoginTarget(searchParams: URLSearchParams, origin: string) {
  const fallback = `${origin}/`;
  const rawRedirect = searchParams.get("redirect_to");
  if (!rawRedirect) return fallback;

  try {
    let url = new URL(rawRedirect, origin);
    const visited = new Set<string>();

    while (url.pathname === "/login" && url.searchParams.get("redirect_to")) {
      const nested = url.searchParams.get("redirect_to");
      if (!nested || visited.has(url.toString())) break;
      visited.add(url.toString());
      url = new URL(nested, origin);
    }

    url.searchParams.delete("token");
    url.searchParams.delete("expires_at");

    if (url.pathname === "/login") {
      return fallback;
    }

    return url.toString();
  } catch {
    return fallback;
  }
}
