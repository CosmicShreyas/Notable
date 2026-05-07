import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Plus, Shield, Trash2, Users, X } from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useRequireAuth } from "../hooks/use-require-auth";
import { cancelTeamInvite, createTeam, deleteTeam, inviteTeamMember, listTeams, type Team } from "../lib/api";

export const Route = createFileRoute("/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const { loading: authLoading } = useRequireAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [teamPendingDelete, setTeamPendingDelete] = useState<Team | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let active = true;

    void listTeams()
      .then((items) => {
        if (!active) return;
        setTeams(items);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load teams");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  useEffect(() => {
    if (!teams.length) {
      setSelectedTeamId(null);
      return;
    }

    setSelectedTeamId((current) => {
      if (current && teams.some((team) => team.id === current)) {
        return current;
      }
      return teams.find((team) => team.is_owner)?.id ?? teams[0]?.id ?? null;
    });
  }, [teams]);

  const activeTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;

  const handleCreateTeam = async () => {
    if (!teamName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const team = await createTeam({ name: teamName.trim() });
      setTeams((current) => [team, ...current]);
      setSelectedTeamId(team.id);
      setTeamName("");
      setShowCreateForm(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create team");
    } finally {
      setSubmitting(false);
    }
  };

  const handleInvite = async () => {
    if (!activeTeam || !inviteEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await inviteTeamMember(activeTeam.id, { email: inviteEmail.trim() });
      const refreshed = await listTeams();
      setTeams(refreshed);
      setInviteEmail("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send invite");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!activeTeam?.is_owner) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelTeamInvite(activeTeam.id, inviteId);
      const refreshed = await listTeams();
      setTeams(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to cancel invite");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!teamPendingDelete?.is_owner) return;

    setSubmitting(true);
    setError(null);
    try {
      await deleteTeam(teamPendingDelete.id);
      const refreshed = await listTeams();
      setTeams(refreshed);
      setTeamPendingDelete(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete team");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <Dialog open={Boolean(teamPendingDelete)} onOpenChange={(open) => !open && setTeamPendingDelete(null)}>
        <DialogContent className="max-w-md rounded-[1.75rem] border-border bg-card/95 p-0 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="p-6 sm:p-7">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-semibold text-foreground">Delete team workspace?</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-7 text-muted-foreground">
                {teamPendingDelete
                  ? `Delete ${teamPendingDelete.name}? Team-only meeting links from this workspace will be locked back down.`
                  : "Deleting this team will remove its pending invites and team-only link access."}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive/90">
              This action removes the team workspace and cancels outstanding invites.
            </div>

            <DialogFooter className="mt-6 gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setTeamPendingDelete(null)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-background/70 px-5 text-sm font-medium text-foreground/85 transition hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteTeam()}
                disabled={submitting}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-destructive px-5 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Deleting..." : "Delete team"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <main className="relative flex-1 overflow-y-auto overscroll-contain pt-16 md:pt-0">
        <div className="mx-auto min-h-full w-full max-w-5xl px-4 pb-32 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <Users className="h-3.5 w-3.5" />
            Team workspace
          </div>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">My teams</h1>
            </div>
            {teams.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreateForm((current) => !current)}
                className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-2xl border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                Create another team
              </button>
            )}
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Create your organization workspace, invite teammates by email, and unlock team-only meeting sharing inside Notable.
          </p>

          {error && (
            <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {showCreateForm && (
            <section className="mt-8 rounded-3xl border border-border bg-card/60 p-6 shadow-[var(--shadow-soft)] backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/75">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-medium text-foreground">Create a new team</div>
                  <div className="text-sm text-muted-foreground">
                    Spin up another workspace for a different organization or group.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <div className="flex min-h-12 w-full min-w-0 flex-1 items-center rounded-2xl border border-border bg-background/60 px-4 py-3">
                  <input
                    value={teamName}
                    onChange={(event) => setTeamName(event.target.value)}
                    placeholder="Enter your team or organization name"
                    className="w-full min-w-0 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateTeam()}
                  disabled={submitting || !teamName.trim()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Create team
                </button>
              </div>
            </section>
          )}

          {loading ? (
            <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-14 text-center text-sm text-muted-foreground">
              <span className="loading-shimmer-text">Loading your team workspace...</span>
            </div>
          ) : !activeTeam ? (
            <section className="mt-8 rounded-3xl border border-border bg-card/60 p-6 shadow-[var(--shadow-soft)] backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/75">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-medium text-foreground">Create your team</div>
                  <div className="text-sm text-muted-foreground">
                    Start one shared organization space for your Notable workspace.
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <div className="flex min-h-12 w-full min-w-0 flex-1 items-center rounded-2xl border border-border bg-background/60 px-4 py-3">
                  <input
                    value={teamName}
                    onChange={(event) => setTeamName(event.target.value)}
                    placeholder="Enter your team or organization name"
                    className="w-full min-w-0 bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleCreateTeam()}
                  disabled={submitting || !teamName.trim()}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Plus className="h-4 w-4" />
                  Create team
                </button>
              </div>
            </section>
          ) : (
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <section className="rounded-3xl border border-border bg-card/60 p-6 shadow-[var(--shadow-soft)] backdrop-blur">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace</div>
                    <h2 className="mt-2 text-2xl font-semibold text-foreground">{activeTeam.name}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                      {activeTeam.members.length} member{activeTeam.members.length === 1 ? "" : "s"}
                    </div>
                    {activeTeam.is_owner && (
                      <button
                        type="button"
                        onClick={() => setTeamPendingDelete(activeTeam)}
                        disabled={submitting}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 text-xs font-medium text-destructive transition hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete team
                      </button>
                    )}
                  </div>
                </div>

                {teams.length > 1 && (
                  <div className="mt-6">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your team workspaces</div>
                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                      {teams.map((team) => (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => setSelectedTeamId(team.id)}
                          className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                            team.id === activeTeam.id
                              ? "border-foreground/20 bg-background/65"
                              : "border-border bg-background/35 hover:bg-background/50"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{team.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {team.members.length} member{team.members.length === 1 ? "" : "s"}
                            </div>
                          </div>
                          <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {team.is_owner ? "owner" : "member"}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                  {activeTeam.members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-2xl border border-border bg-background/45 px-4 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{member.full_name || member.email}</div>
                        <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                      </div>
                      <div className="rounded-full border border-border bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {member.role}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-3xl border border-border bg-card/60 p-6 shadow-[var(--shadow-soft)] backdrop-blur">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/75">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-lg font-medium text-foreground">Invite teammates</div>
                    <div className="text-sm text-muted-foreground">Send an email invite your team into your workspace</div>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="colleague@company.com"
                    className="h-12 w-full rounded-2xl border border-border bg-background/60 px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-foreground/20"
                  />
                  <button
                    type="button"
                    onClick={() => void handleInvite()}
                    disabled={submitting || !inviteEmail.trim() || !activeTeam.is_owner}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Send invite
                  </button>
                  {!activeTeam.is_owner && (
                    <div className="text-xs text-muted-foreground">
                      Only the workspace owner can send team invitations.
                    </div>
                  )}
                </div>

                <div className="mt-8">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pending invites</div>
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {activeTeam.pending_invites.length ? (
                      activeTeam.pending_invites.map((invite) => (
                        <div key={invite.id} className="rounded-2xl border border-border bg-background/45 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-foreground">{invite.email}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                Expires{" "}
                                {new Intl.DateTimeFormat(undefined, {
                                  month: "short",
                                  day: "numeric",
                                }).format(parseDate(invite.expires_at))}
                              </div>
                            </div>
                            {activeTeam.is_owner && (
                              <button
                                type="button"
                                onClick={() => void handleCancelInvite(invite.id)}
                                disabled={submitting}
                                aria-label={`Cancel invite for ${invite.email}`}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground">
                        No pending invites right now.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
        <AskBar containerClassName="md:left-64" />
      </main>
    </div>
  );
}

function parseDate(value: string) {
  return new Date(value);
}
