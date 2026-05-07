import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Mail, ShieldAlert, Users, X } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { acceptTeamInvite, getTeamInvite, type TeamInviteAccess } from "../lib/api";

export const Route = createFileRoute("/invite/$inviteToken")({
  component: InvitePage,
});

function InvitePage() {
  const { inviteToken } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const [invite, setInvite] = useState<TeamInviteAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getTeamInvite(inviteToken)
      .then((response) => {
        if (active) {
          setInvite(response);
        }
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load invite");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [inviteToken, user?.id]);

  const loginRedirect = useMemo(() => {
    if (typeof window === "undefined") return `/invite/${inviteToken}`;
    return `${window.location.origin}/invite/${inviteToken}`;
  }, [inviteToken]);

  const acceptInvite = async () => {
    setAccepting(true);
    setError(null);
    try {
      await acceptTeamInvite(inviteToken);
      setInvite((current) =>
        current
          ? {
              ...current,
              status: "accepted",
            }
          : current,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to accept invite");
    } finally {
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-muted-foreground">
        <div className="loading-shimmer-text text-sm">Preparing team invite...</div>
      </div>
    );
  }

  const status = invite?.status ?? "not_found";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl rounded-[2rem] border border-border bg-card/60 p-8 text-left shadow-[var(--shadow-elevated)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background">
            N
          </div>
          <div className="font-serif-display text-3xl text-foreground/95">Notable</div>
        </div>

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background/70 text-foreground/80">
          {status === "accepted" ? (
            <Check className="h-6 w-6" />
          ) : status === "pending" ? (
            <Users className="h-6 w-6" />
          ) : status === "sign_in_required" ? (
            <Mail className="h-6 w-6" />
          ) : (
            <ShieldAlert className="h-6 w-6" />
          )}
        </div>

        <div className="mt-6 text-xs uppercase tracking-[0.18em] text-muted-foreground">Team invitation</div>
        <h1 className="mt-3 font-serif-display text-4xl text-foreground/95">
          Join {invite?.team_name ?? "your Notable team"}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          {renderInviteDescription(invite)}
        </p>

        {error && <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        <div className="mt-8 flex flex-col items-start justify-center gap-3 sm:flex-row sm:items-center">
          {status === "pending" && (
            <button
              type="button"
              onClick={() => void acceptInvite()}
              disabled={accepting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accepting ? "Accepting..." : "Accept invite"}
            </button>
          )}
          {status === "sign_in_required" && (
            <a
              href={`/login?redirect_to=${encodeURIComponent(loginRedirect)}`}
              className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90"
            >
              Sign in to continue
            </a>
          )}
          <Link
            to={status === "accepted" ? "/teams" : "/"}
            className="inline-flex h-11 items-center justify-center rounded-full border border-border bg-background/70 px-5 text-sm text-foreground/85 transition hover:bg-accent"
          >
            {status === "accepted" ? "Go to My teams" : "Go to Notable"}
          </Link>
        </div>
      </div>
    </div>
  );
}

function renderInviteDescription(invite: TeamInviteAccess | null) {
  if (!invite) {
    return "This invitation could not be loaded.";
  }

  if (invite.status === "pending") {
    return `${invite.inviter_name ?? "A teammate"} invited ${invite.invited_email ?? "you"} to join this Notable workspace. Accepting will unlock team-shared meetings for your account.`;
  }
  if (invite.status === "accepted") {
    return "You are already part of this team. Team-shared meetings will now appear in your shared inbox.";
  }
  if (invite.status === "sign_in_required") {
    return `Sign in with ${invite.invited_email ?? "the invited email"} to accept this team invitation.`;
  }
  if (invite.status === "email_mismatch") {
    return `This invite was sent to ${invite.invited_email ?? "another email address"}. Sign in with that exact account to accept it.`;
  }
  if (invite.status === "expired") {
    return "This invitation has expired, was cancelled, or was already used. Ask your team owner to send a fresh invite.";
  }
  return "This invite is missing or no longer available.";
}
