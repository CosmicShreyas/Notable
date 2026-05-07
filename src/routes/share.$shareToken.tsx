import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, Link2, Lock, ShieldAlert, Users } from "lucide-react";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { useAuth } from "../components/AuthProvider";
import { getSharedMeeting, markSharedMeetingViewed, parseApiDate, type SharedMeetingAccess } from "../lib/api";

export const Route = createFileRoute("/share/$shareToken")({
  component: SharedMeetingPage,
});

function SharedMeetingPage() {
  const { shareToken } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const [access, setAccess] = useState<SharedMeetingAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<"notes" | "summary">("summary");

  useEffect(() => {
    let active = true;
    setLoading(true);

    void getSharedMeeting(shareToken)
      .then((response) => {
        if (!active) return;
        setAccess(response);
        if (response.meeting?.summary) {
          setActiveView("summary");
        } else {
          setActiveView("notes");
        }
      })
      .catch(() => {
        if (!active) return;
        setAccess({
          status: "not_found",
          visibility: "private",
          share_token: shareToken,
        });
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [shareToken, user?.id]);

  useEffect(() => {
    if (loading || authLoading || !user) return;
    if (!access || access.status !== "granted" || !access.meeting) return;

    void markSharedMeetingViewed(shareToken).catch(() => {
      // Non-blocking: the meeting should still render even if inbox tracking fails.
    });
  }, [access, authLoading, loading, shareToken, user]);

  const loginRedirect = useMemo(() => {
    if (typeof window === "undefined") return `/share/${shareToken}`;
    return `${window.location.origin}/share/${shareToken}`;
  }, [shareToken]);

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-muted-foreground">
        <div className="loading-shimmer-text text-sm">Preparing shared meeting...</div>
      </div>
    );
  }

  if (!access || access.status !== "granted" || !access.meeting) {
    return (
      <BlockedShareState
        access={access}
        loginRedirect={loginRedirect}
      />
    );
  }

  const meeting = access.meeting;
  const summary = (meeting.summary ?? "").trim();
  const notes = (meeting.notes_markdown ?? "").trim();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/60 text-foreground/80 transition hover:bg-accent"
            aria-label="Home"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Shared meeting</div>
            <div className="mt-1 text-sm text-muted-foreground">{describeSharedVisibility(access.visibility)}</div>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full border border-border bg-card/60 p-1">
          <button
            type="button"
            onClick={() => setActiveView("notes")}
            className={`rounded-full px-4 py-2 text-sm transition ${activeView === "notes" ? "bg-foreground text-background" : "text-foreground/75 hover:bg-accent"}`}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => setActiveView("summary")}
            className={`rounded-full px-4 py-2 text-sm transition ${activeView === "summary" ? "bg-foreground text-background" : "text-foreground/75 hover:bg-accent"}`}
          >
            Summary
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20 pt-6 sm:px-6">
        <h1 className="font-serif-display text-4xl leading-[1.12] text-foreground/90 sm:text-5xl">
          {meeting.title}
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <SharePill
            icon={Calendar}
            label={meeting.scheduled_start ? formatDateLabel(meeting.scheduled_start) : "Shared note"}
          />
          <SharePill
            icon={Users}
            label={formatParticipantsLabel(meeting.participants ?? [])}
          />
          <SharePill
            icon={Link2}
            label={describeSharedVisibility(access.visibility)}
          />
        </div>

        {activeView === "summary" && summary ? (
          <article className="mt-10">
            <MarkdownRenderer markdown={summary} className="markdown-note" />
          </article>
        ) : (
          <article className="mt-10 min-h-[50vh]">
            {notes ? (
              <MarkdownRenderer markdown={notes} className="markdown-note" />
            ) : (
              <div className="text-base text-muted-foreground">
                {summary ? "No separate manual notes were added for this meeting." : "Nothing was shared in this tab yet."}
              </div>
            )}
          </article>
        )}
      </main>
    </div>
  );
}

function BlockedShareState({
  access,
  loginRedirect,
}: {
  access: SharedMeetingAccess | null;
  loginRedirect: string;
}) {
  const heading =
    access?.status === "private_blocked"
      ? "This meeting is private"
      : access?.status === "team_blocked"
        ? "This link is limited to the team"
        : access?.status === "sign_in_required"
          ? "Sign in to view this meeting"
          : "Share link not found";

  const description =
    access?.status === "private_blocked"
      ? "Only the owner can open this private meeting link."
      : access?.status === "team_blocked"
        ? `This share link only works for members of ${access.team_name ?? "the owner's team"}.`
        : access?.status === "sign_in_required"
          ? `This team-only link needs a signed-in member account for ${access.team_name ?? "this team"}.`
          : "This share link is missing, expired, or no longer available.";

  const icon =
    access?.status === "private_blocked" ? Lock : access?.status === "not_found" ? Link2 : ShieldAlert;
  const Icon = icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg rounded-[2rem] border border-border bg-card/60 p-8 text-center shadow-[var(--shadow-elevated)] backdrop-blur">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background/70 text-foreground/80">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-6 font-serif-display text-4xl text-foreground/95">{heading}</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">{description}</p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {access?.status === "sign_in_required" && (
            <a
              href={`/login?redirect_to=${encodeURIComponent(loginRedirect)}`}
              className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90"
            >
              Sign in to continue
            </a>
          )}
          <Link
            to="/"
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-background/70 px-5 text-sm text-foreground/85 transition hover:bg-accent"
          >
            Go to Notable
          </Link>
        </div>
      </div>
    </div>
  );
}

function SharePill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseApiDate(value));
}

function formatParticipantsLabel(participants: string[]) {
  if (!participants.length) return "No participants listed";
  if (participants.length <= 2) return participants.join(", ");
  return `${participants.slice(0, 2).join(", ")} +${participants.length - 2}`;
}

function describeSharedVisibility(visibility: "team" | "link" | "private") {
  if (visibility === "team") return "Team members only";
  if (visibility === "private") return "Private link";
  return "Anyone with the link";
}
