import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronLeft, ExternalLink, Home as HomeIcon, Mic, PanelRightOpen, Sparkles } from "lucide-react";

import { AskBar } from "../components/AskBar";
import { Sidebar } from "../components/Sidebar";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import { getGoogleMeetIntegrationStatus, type GoogleMeetIntegrationStatus } from "../lib/api";

export const Route = createFileRoute("/google-meet")({
  validateSearch: (search: Record<string, unknown>) => ({
    meetingCode: typeof search.meetingCode === "string" ? search.meetingCode : "",
    meetingTitle: typeof search.meetingTitle === "string" ? search.meetingTitle : "",
  }),
  component: GoogleMeetPage,
});

function GoogleMeetPage() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const { meetingCode, meetingTitle } = useSearch({ from: "/google-meet" });
  const [status, setStatus] = useState<GoogleMeetIntegrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    void getGoogleMeetIntegrationStatus()
      .then(setStatus)
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Unable to load Google Meet integration status");
      });
  }, [authLoading]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative h-screen flex-1 overflow-y-auto pt-16 md:pt-0">
        {!isMobile && (
          <header className="sticky top-16 z-30 flex items-center justify-between border-b border-border/60 bg-background/88 px-4 py-3 backdrop-blur md:top-0 sm:px-6 lg:px-8">
            <div className="flex items-center gap-1 rounded-full border border-border bg-card/60 px-1 py-1 backdrop-blur">
              <button
                onClick={() => window.history.back()}
                className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent"
                aria-label="Back"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Link to="/" className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent" aria-label="Home">
                <HomeIcon className="h-4 w-4" />
              </Link>
            </div>
            <div className="text-sm text-muted-foreground">Google Meet integration</div>
          </header>
        )}

        <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Meet add-on surface</p>
            <h1 className="mt-2 font-serif-display text-4xl text-foreground/95 sm:text-5xl">Notable for Google Meet</h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
              This page is the Notable surface we can point a Google Meet add-on to. It gives us a real in-meeting UI
              entry point while we wire the deeper Meet Media API enrollment and cloud setup.
            </p>
          </div>

          <section className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
            <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background/60">
                  <PanelRightOpen className="h-5 w-5 text-foreground/80" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Inside Google Meet</div>
                  <div className="mt-1 text-lg font-medium text-foreground/92">Companion side panel</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <InfoCard label="Meeting title" value={meetingTitle || "Waiting for Meet context"} />
                <InfoCard label="Meeting code" value={meetingCode || "Waiting for Meet context"} />
              </div>

              <div className="mt-5 rounded-2xl border border-border/70 bg-background/45 p-4 text-sm leading-6 text-muted-foreground">
                <div className="font-medium text-foreground/90">What this gives us now</div>
                <ul className="mt-3 space-y-2">
                  <li>Notable can open inside a dedicated Google Meet add-on panel instead of only in a separate tab.</li>
                  <li>We can pass meeting context like title or meeting code into Notable from the add-on launch surface.</li>
                  <li>This is the right product entry point for future live media capture and real-time Meet workflows.</li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                    <Sparkles className="h-4.5 w-4.5 text-foreground/80" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground/92">Integration status</div>
                    <div className="text-xs text-muted-foreground">Cloud/project readiness</div>
                  </div>
                </div>

                {error ? (
                  <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : status ? (
                  <div className="mt-4 space-y-3 text-sm">
                    <StatusRow label="Add-on URL configured" value={status.addon_ready ? "Ready" : "Not configured"} />
                    <StatusRow label="Meet Media API enabled" value={status.media_api_enabled ? "Enabled" : "Not yet"} />
                    <StatusRow
                      label="Cloud project number"
                      value={status.cloud_project_number || "Missing"}
                      muted={!status.cloud_project_number}
                    />
                    <a
                      href={status.addon_launch_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-background/55 px-4 py-2 text-xs text-foreground/80 transition hover:bg-accent"
                    >
                      Open add-on URL
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-muted-foreground">Loading integration status...</div>
                )}
              </div>

              <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                    <Mic className="h-4.5 w-4.5 text-foreground/80" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground/92">Media capture reality</div>
                    <div className="text-xs text-muted-foreground">What still needs Google project setup</div>
                  </div>
                </div>

                <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
                  <li>A Meet add-on gives us the UI surface inside the call.</li>
                  <li>Actual participant audio capture comes from the Google Meet Media API, not from the add-on UI alone.</li>
                  <li>That API still needs Cloud project enrollment, OAuth, and deployment setup before live capture can work.</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      </main>

      <AskBar
        containerClassName="md:left-64"
        assistantContext={{
          page_type: "google_meet",
          meeting_code: meetingCode || undefined,
          meeting_title: meetingTitle || undefined,
        }}
      />
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium text-foreground/90">{value}</div>
    </div>
  );
}

function StatusRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={muted ? "text-muted-foreground" : "text-foreground/90"}>{value}</span>
    </div>
  );
}
