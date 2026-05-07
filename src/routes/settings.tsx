import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BellRing,
  Check,
  ChevronLeft,
  Mail,
  Languages,
  Link as LinkIcon,
  Briefcase,
  MessagesSquare,
  Search,
  Shield,
  Sparkles,
  Timer,
  Waves,
  Home as HomeIcon,
  LogOut,
} from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { useTheme } from "../components/ThemeProvider";
import { useAuth } from "../components/AuthProvider";
import { useSettings } from "../components/SettingsProvider";
import {
  connectAsanaTaskSync,
  connectJiraTaskSync,
  connectLinearTaskSync,
  connectSlackSearch,
  disconnectAsanaTaskSync,
  disconnectJiraTaskSync,
  disconnectLinearTaskSync,
  disconnectSlackSearch,
  getGoogleLoginUrl,
  getSearchConnections,
  getTaskSyncConnections,
  type SearchConnectionsStatus,
  type TaskSyncConnectionsStatus,
} from "../lib/api";
type ThemeChoice = "system" | "light" | "dark";
type ShareVisibility = "team" | "link" | "private";
type TranscriptRetention = "off" | "5d" | "10d" | "30d" | "60d" | "90d";
type SummaryStyle = "concise" | "balanced" | "detailed";
type TranscriptionLanguage = "auto" | "en" | "hi";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings - Notable" },
      {
        name: "description",
        content: "Configure recording, theme, sharing, and language preferences for Notable.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const { preference, setTheme } = useTheme();
  const { logout } = useAuth();
  const {
    liveIndicator,
    setLiveIndicator,
    showConsentNudge,
    setShowConsentNudge,
    desktopAlerts,
    setDesktopAlerts,
    notificationPermission,
    improveModels,
    setImproveModels,
    emailSummarySnapshots,
    setEmailSummarySnapshots,
    linkSharing,
    setLinkSharing,
    retention,
    setRetention,
    summaryStyle,
    setSummaryStyle,
    transcriptionLanguage,
    setTranscriptionLanguage,
  } = useSettings();

  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(preference);
  const [loggingOut, setLoggingOut] = useState(false);
  const [searchConnections, setSearchConnections] = useState<SearchConnectionsStatus | null>(null);
  const [searchConnectionsLoading, setSearchConnectionsLoading] = useState(true);
  const [searchConnectionsError, setSearchConnectionsError] = useState<string | null>(null);
  const [slackToken, setSlackToken] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [googleReconnectLoading, setGoogleReconnectLoading] = useState(false);
  const [taskSyncConnections, setTaskSyncConnections] = useState<TaskSyncConnectionsStatus | null>(null);
  const [taskSyncLoading, setTaskSyncLoading] = useState(true);
  const [taskSyncError, setTaskSyncError] = useState<string | null>(null);
  const [jiraForm, setJiraForm] = useState({ site_url: "", email: "", api_token: "", project_key: "", issue_type_name: "Task" });
  const [asanaForm, setAsanaForm] = useState({ personal_access_token: "", project_gid: "", workspace_gid: "" });
  const [linearForm, setLinearForm] = useState({ api_key: "", team_id: "" });
  const [taskSyncSaving, setTaskSyncSaving] = useState<"jira" | "asana" | "linear" | null>(null);

  useEffect(() => {
    setThemeChoice(preference);
  }, [preference]);

  useEffect(() => {
    let active = true;
    setSearchConnectionsLoading(true);
    void getSearchConnections()
      .then((status) => {
        if (!active) return;
        setSearchConnections(status);
        setSearchConnectionsError(null);
      })
      .catch((error) => {
        if (!active) return;
        setSearchConnectionsError(error instanceof Error ? error.message : "Unable to load search connections");
      })
      .finally(() => {
        if (active) setSearchConnectionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setTaskSyncLoading(true);
    void getTaskSyncConnections()
      .then((status) => {
        if (!active) return;
        setTaskSyncConnections(status);
        setTaskSyncError(null);
      })
      .catch((error) => {
        if (!active) return;
        setTaskSyncError(error instanceof Error ? error.message : "Unable to load task sync connections");
      })
      .finally(() => {
        if (active) setTaskSyncLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleThemeChange = (value: string) => {
    const nextTheme = value as ThemeChoice;
    setThemeChoice(nextTheme);
    setTheme(nextTheme);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    await navigate({ to: "/login" });
  };

  const handleReconnectGoogleSearch = async () => {
    setGoogleReconnectLoading(true);
    setSearchConnectionsError(null);
    try {
      const targetAfterLogin =
        typeof window === "undefined"
          ? "http://localhost:8080/settings"
          : `${window.location.origin}/settings`;
      const redirectTo =
        typeof window === "undefined"
          ? `http://localhost:8080/login?redirect_to=${encodeURIComponent(targetAfterLogin)}`
          : `${window.location.origin}/login?redirect_to=${encodeURIComponent(targetAfterLogin)}`;
      const { authorization_url } = await getGoogleLoginUrl(redirectTo);
      window.location.assign(authorization_url);
    } catch (error) {
      setGoogleReconnectLoading(false);
      setSearchConnectionsError(error instanceof Error ? error.message : "Unable to start Google reconnect");
    }
  };

  const handleSaveSlack = async () => {
    if (!slackToken.trim()) return;
    setSlackSaving(true);
    setSearchConnectionsError(null);
    try {
      const status = await connectSlackSearch({ user_token: slackToken.trim() });
      setSearchConnections(status);
      setSlackToken("");
    } catch (error) {
      setSearchConnectionsError(error instanceof Error ? error.message : "Unable to connect Slack");
    } finally {
      setSlackSaving(false);
    }
  };

  const handleDisconnectSlack = async () => {
    setSlackSaving(true);
    setSearchConnectionsError(null);
    try {
      const status = await disconnectSlackSearch();
      setSearchConnections(status);
    } catch (error) {
      setSearchConnectionsError(error instanceof Error ? error.message : "Unable to disconnect Slack");
    } finally {
      setSlackSaving(false);
    }
  };

  const handleConnectJira = async () => {
    setTaskSyncSaving("jira");
    setTaskSyncError(null);
    try {
      const status = await connectJiraTaskSync(jiraForm);
      setTaskSyncConnections(status);
      setJiraForm((current) => ({ ...current, api_token: "" }));
    } catch (error) {
      setTaskSyncError(error instanceof Error ? error.message : "Unable to connect Jira");
    } finally {
      setTaskSyncSaving(null);
    }
  };

  const handleConnectAsana = async () => {
    setTaskSyncSaving("asana");
    setTaskSyncError(null);
    try {
      const status = await connectAsanaTaskSync({
        personal_access_token: asanaForm.personal_access_token,
        project_gid: asanaForm.project_gid,
        workspace_gid: asanaForm.workspace_gid || null,
      });
      setTaskSyncConnections(status);
      setAsanaForm((current) => ({ ...current, personal_access_token: "" }));
    } catch (error) {
      setTaskSyncError(error instanceof Error ? error.message : "Unable to connect Asana");
    } finally {
      setTaskSyncSaving(null);
    }
  };

  const handleConnectLinear = async () => {
    setTaskSyncSaving("linear");
    setTaskSyncError(null);
    try {
      const status = await connectLinearTaskSync(linearForm);
      setTaskSyncConnections(status);
      setLinearForm((current) => ({ ...current, api_key: "" }));
    } catch (error) {
      setTaskSyncError(error instanceof Error ? error.message : "Unable to connect Linear");
    } finally {
      setTaskSyncSaving(null);
    }
  };

  const handleDisconnectProvider = async (provider: "jira" | "asana" | "linear") => {
    setTaskSyncSaving(provider);
    setTaskSyncError(null);
    try {
      const status =
        provider === "jira"
          ? await disconnectJiraTaskSync()
          : provider === "asana"
            ? await disconnectAsanaTaskSync()
            : await disconnectLinearTaskSync();
      setTaskSyncConnections(status);
    } catch (error) {
      setTaskSyncError(error instanceof Error ? error.message : `Unable to disconnect ${provider}`);
    } finally {
      setTaskSyncSaving(null);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative h-screen flex-1 overflow-y-auto pt-16 md:pt-0">
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Settings</span>
          </div>
        </header>

        <div className="mx-auto w-full max-w-4xl px-4 pb-20 pt-6 sm:px-6 lg:px-8">
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Workspace settings</p>
            <h1 className="mt-2 font-serif-display text-4xl text-foreground/95 sm:text-5xl">Preferences</h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Tune Notable for your meetings: capture behavior, privacy defaults, appearance, and language.
            </p>
          </div>

          <section className="mt-10">
            <SectionTitle title="Meeting behavior" subtitle="Controls for recording and during-call experience." />
            <SettingsPanel>
              <SettingRow
                icon={Waves}
                title="Live meeting indicator"
                description="Show a subtle status indicator while audio is being transcribed."
                control={<Switch checked={liveIndicator} onCheckedChange={setLiveIndicator} aria-label="Live meeting indicator" />}
              />
              <SettingRow
                icon={Shield}
                title="Consent reminder before transcription"
                description="Show a quick reminder to confirm participant consent."
                control={<Switch checked={showConsentNudge} onCheckedChange={setShowConsentNudge} aria-label="Consent reminder before transcription" />}
              />
            </SettingsPanel>
          </section>

          <section className="mt-10">
            <SectionTitle title="Appearance" subtitle="How Notable looks and feels on your device." />
            <SettingsPanel>
              <SettingRow
                icon={Sparkles}
                title="Theme"
                description="Use your system preference or force light/dark mode."
                control={
                  <Select value={themeChoice} onValueChange={handleThemeChange}>
                    <SelectTrigger className="h-10 w-[180px] bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingRow
                icon={BellRing}
                title="Desktop alerts"
                description={describeNotificationStatus(desktopAlerts, notificationPermission)}
                control={
                  <Switch
                    checked={desktopAlerts}
                    onCheckedChange={(checked) => void setDesktopAlerts(checked)}
                    aria-label="Desktop alerts"
                  />
                }
              />
            </SettingsPanel>
          </section>

          <section className="mt-10">
            <SectionTitle title="Search Copilot" subtitle="Connect Gmail, Google Docs, and Slack so global chat can search beyond meetings." />
            <SettingsPanel>
              <SettingRow
                icon={Search}
                title="Google Search Copilot"
                description={
                  searchConnectionsLoading
                    ? "Checking Gmail and Google Docs access..."
                    : searchConnections?.gmail_connected && searchConnections?.google_docs_connected
                      ? "Gmail and Google Docs are connected through your Google account."
                      : "Reconnect Google once so Search Copilot can read Gmail and Google Docs."
                }
                control={
                  <button
                    type="button"
                    onClick={() => void handleReconnectGoogleSearch()}
                    disabled={googleReconnectLoading}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {googleReconnectLoading ? "Redirecting..." : searchConnections?.gmail_connected && searchConnections?.google_docs_connected ? "Reconnect Google" : "Connect Google search"}
                  </button>
                }
              />
              <SettingRow
                icon={Mail}
                title="Slack Search Copilot"
                description={
                  searchConnectionsLoading
                    ? "Checking Slack connection..."
                    : searchConnections?.slack_connected
                      ? `Connected to ${searchConnections.slack_workspace_name || "your Slack workspace"}.`
                      : "Paste a Slack user token with the search:read scope to include Slack in global chat."
                }
                control={
                  <div className="w-full space-y-2 sm:w-[320px]">
                    {!searchConnections?.slack_connected ? (
                      <>
                        <input
                          type="password"
                          value={slackToken}
                          onChange={(event) => setSlackToken(event.target.value)}
                          placeholder="xoxp-..."
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground/20"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveSlack()}
                          disabled={slackSaving || !slackToken.trim()}
                          className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {slackSaving ? "Connecting..." : "Connect Slack"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleDisconnectSlack()}
                        disabled={slackSaving}
                        className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 px-4 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {slackSaving ? "Disconnecting..." : "Disconnect Slack"}
                      </button>
                    )}
                  </div>
                }
              />
              {!!searchConnections?.notes?.length && (
                <div className="border-t border-border/70 px-4 py-4 text-xs text-muted-foreground sm:px-5">
                  {searchConnections.notes.map((note) => (
                    <div key={note} className="flex items-start gap-2">
                      <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/60" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
              {searchConnectionsError && (
                <div className="border-t border-border/70 px-4 py-4 text-sm text-destructive sm:px-5">
                  {searchConnectionsError}
                </div>
              )}
            </SettingsPanel>
          </section>

          <section className="mt-10">
            <SectionTitle title="Task sync" subtitle="Push meeting action items into Jira, Asana, or Linear." />
            <SettingsPanel>
              <TaskSyncProviderCard
                icon={Briefcase}
                title="Jira"
                connected={Boolean(taskSyncConnections?.jira_connected)}
                detail={taskSyncLoading ? "Checking Jira..." : taskSyncConnections?.jira_project_key ? `Project ${taskSyncConnections.jira_project_key}` : "Connect Jira with site URL, email, API token, and target project key."}
                saving={taskSyncSaving === "jira"}
                onDisconnect={() => void handleDisconnectProvider("jira")}
              >
                {!taskSyncConnections?.jira_connected && (
                  <div className="grid gap-2">
                    <input value={jiraForm.site_url} onChange={(event) => setJiraForm((current) => ({ ...current, site_url: event.target.value }))} placeholder="https://your-domain.atlassian.net" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <input value={jiraForm.email} onChange={(event) => setJiraForm((current) => ({ ...current, email: event.target.value }))} placeholder="you@company.com" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <input type="password" value={jiraForm.api_token} onChange={(event) => setJiraForm((current) => ({ ...current, api_token: event.target.value }))} placeholder="Jira API token" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input value={jiraForm.project_key} onChange={(event) => setJiraForm((current) => ({ ...current, project_key: event.target.value }))} placeholder="Project key (e.g. NOT)" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                      <input value={jiraForm.issue_type_name} onChange={(event) => setJiraForm((current) => ({ ...current, issue_type_name: event.target.value }))} placeholder="Issue type (Task)" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    </div>
                    <button type="button" onClick={() => void handleConnectJira()} disabled={taskSyncSaving === "jira" || !jiraForm.site_url || !jiraForm.email || !jiraForm.api_token || !jiraForm.project_key} className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-60">
                      {taskSyncSaving === "jira" ? "Connecting..." : "Connect Jira"}
                    </button>
                  </div>
                )}
              </TaskSyncProviderCard>

              <TaskSyncProviderCard
                icon={Check}
                title="Asana"
                connected={Boolean(taskSyncConnections?.asana_connected)}
                detail={taskSyncLoading ? "Checking Asana..." : taskSyncConnections?.asana_project_gid ? `Project ${taskSyncConnections.asana_project_gid}` : "Connect Asana with a personal access token and target project gid."}
                saving={taskSyncSaving === "asana"}
                onDisconnect={() => void handleDisconnectProvider("asana")}
              >
                {!taskSyncConnections?.asana_connected && (
                  <div className="grid gap-2">
                    <input type="password" value={asanaForm.personal_access_token} onChange={(event) => setAsanaForm((current) => ({ ...current, personal_access_token: event.target.value }))} placeholder="Asana personal access token" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <input value={asanaForm.project_gid} onChange={(event) => setAsanaForm((current) => ({ ...current, project_gid: event.target.value }))} placeholder="Project gid" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <input value={asanaForm.workspace_gid} onChange={(event) => setAsanaForm((current) => ({ ...current, workspace_gid: event.target.value }))} placeholder="Workspace gid (optional)" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <button type="button" onClick={() => void handleConnectAsana()} disabled={taskSyncSaving === "asana" || !asanaForm.personal_access_token || !asanaForm.project_gid} className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-60">
                      {taskSyncSaving === "asana" ? "Connecting..." : "Connect Asana"}
                    </button>
                  </div>
                )}
              </TaskSyncProviderCard>

              <TaskSyncProviderCard
                icon={MessagesSquare}
                title="Linear"
                connected={Boolean(taskSyncConnections?.linear_connected)}
                detail={taskSyncLoading ? "Checking Linear..." : taskSyncConnections?.linear_team_id ? `Team ${taskSyncConnections.linear_team_id}` : "Connect Linear with an API key and target team id."}
                saving={taskSyncSaving === "linear"}
                onDisconnect={() => void handleDisconnectProvider("linear")}
              >
                {!taskSyncConnections?.linear_connected && (
                  <div className="grid gap-2">
                    <input type="password" value={linearForm.api_key} onChange={(event) => setLinearForm((current) => ({ ...current, api_key: event.target.value }))} placeholder="Linear API key" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <input value={linearForm.team_id} onChange={(event) => setLinearForm((current) => ({ ...current, team_id: event.target.value }))} placeholder="Team id" className="h-10 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/20" />
                    <button type="button" onClick={() => void handleConnectLinear()} disabled={taskSyncSaving === "linear" || !linearForm.api_key || !linearForm.team_id} className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium transition hover:bg-accent disabled:opacity-60">
                      {taskSyncSaving === "linear" ? "Connecting..." : "Connect Linear"}
                    </button>
                  </div>
                )}
              </TaskSyncProviderCard>

              {!!taskSyncConnections?.notes?.length && (
                <div className="border-t border-border/70 px-4 py-4 text-xs text-muted-foreground sm:px-5">
                  {taskSyncConnections.notes.map((note) => (
                    <div key={note} className="flex items-start gap-2">
                      <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/60" />
                      <span>{note}</span>
                    </div>
                  ))}
                </div>
              )}
              {taskSyncError && (
                <div className="border-t border-border/70 px-4 py-4 text-sm text-destructive sm:px-5">
                  {taskSyncError}
                </div>
              )}
            </SettingsPanel>
          </section>

          <section className="mt-10">
            <SectionTitle title="Data and sharing" subtitle="Defaults that apply to new notes and transcript handling." />
            <SettingsPanel>
              <SettingRow
                icon={LinkIcon}
                title="Default link sharing"
                description="Choose the default visibility when you create a share link."
                control={
                  <Select value={linkSharing} onValueChange={(value) => void setLinkSharing(value as ShareVisibility)}>
                    <SelectTrigger className="h-10 w-[220px] bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="team">Team members only</SelectItem>
                      <SelectItem value="link">Anyone with the link</SelectItem>
                      <SelectItem value="private">Private by default</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingRow
                icon={Mail}
                title="Email me summary snapshots"
                description="Send a quick Notable-styled follow-up email to your inbox whenever a meeting summary finishes generating."
                control={
                  <Switch
                    checked={emailSummarySnapshots}
                    onCheckedChange={(checked) => void setEmailSummarySnapshots(checked)}
                    aria-label="Email me summary snapshots"
                  />
                }
              />
              <SettingRow
                icon={Sparkles}
                title="Allow anonymized meeting samples to improve summaries"
                description="Store anonymized transcript, notes, and summary samples with links, emails, phones, and known names masked before they are saved for summary-quality improvement."
                control={
                  <Switch
                    checked={improveModels}
                    onCheckedChange={(checked) => void setImproveModels(checked)}
                    aria-label="Allow anonymized meeting samples to improve summaries"
                  />
                }
              />
              <SettingRow
                icon={Timer}
                title="Transcript retention"
                description="Automatically remove transcript text after a selected period. Once transcripts are deleted, AI summary regeneration for those meetings is no longer available."
                control={
                  <Select value={retention} onValueChange={(value) => void setRetention(value as TranscriptRetention)}>
                    <SelectTrigger className="h-10 w-[180px] bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="5d">5 days</SelectItem>
                      <SelectItem value="10d">10 days</SelectItem>
                      <SelectItem value="30d">30 days</SelectItem>
                      <SelectItem value="60d">60 days</SelectItem>
                      <SelectItem value="90d">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsPanel>
          </section>

          <section className="mt-10">
            <SectionTitle title="Language and summary style" subtitle="Set how transcription and AI output should be generated." />
            <SettingsPanel>
              <SettingRow
                icon={Languages}
                title="Transcription language"
                description="Choose a fixed language or let Notable detect it automatically."
                control={
                  <Select
                    value={transcriptionLanguage}
                    onValueChange={(value) => setTranscriptionLanguage(value as TranscriptionLanguage)}
                  >
                    <SelectTrigger className="h-10 w-[180px] bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto detect</SelectItem>
                      <SelectItem value="en">Mostly English</SelectItem>
                      <SelectItem value="hi">Mostly Hindi + English</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingRow
                icon={Sparkles}
                title="Summary style"
                description="Control how detailed generated meeting notes should be."
                control={
                  <Select value={summaryStyle} onValueChange={(value) => setSummaryStyle(value as SummaryStyle)}>
                    <SelectTrigger className="h-10 w-[180px] bg-background/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="concise">Concise</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="detailed">Detailed</SelectItem>
                    </SelectContent>
                  </Select>
                }
              />
            </SettingsPanel>
          </section>

          <section className="mt-10 pb-8">
            <SectionTitle title="Session" subtitle="Manage access to this workspace on the current device." />
            <SettingsPanel>
              <SettingRow
                icon={LogOut}
                title="Log out"
                description="Sign out of Notable on this device and return to the login screen."
                control={
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 px-4 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loggingOut ? "Logging out..." : "Log out"}
                  </button>
                }
              />
            </SettingsPanel>
          </section>
        </div>
      </main>
    </div>
  );
}

function SettingsPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/60 shadow-[var(--shadow-soft)] backdrop-blur">
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-foreground/90">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  control,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/70 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-5">
      <div className="flex items-start gap-3 sm:flex-1">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-foreground/80">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{description}</p>
        </div>
      </div>
      <div className="sm:ml-4">{control}</div>
    </div>
  );
}

function TaskSyncProviderCard({
  icon: Icon,
  title,
  detail,
  connected,
  saving,
  onDisconnect,
  children,
}: {
  icon: React.ElementType;
  title: string;
  detail: string;
  connected: boolean;
  saving: boolean;
  onDisconnect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/70 px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-foreground/80">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">{title}</p>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${connected ? "bg-foreground text-background" : "bg-background text-muted-foreground border border-border"}`}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{detail}</p>
          </div>
        </div>
        {connected ? (
          <button
            type="button"
            onClick={onDisconnect}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 px-4 text-sm font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
          >
            {saving ? "Disconnecting..." : "Disconnect"}
          </button>
        ) : null}
      </div>
      {!connected ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function describeNotificationStatus(
  enabled: boolean,
  permission: NotificationPermission | "unsupported",
) {
  if (permission === "unsupported") {
    return "This browser does not support desktop notifications.";
  }
  if (permission === "denied") {
    return "Notifications are blocked in your browser settings. Re-enable them there to get meeting reminders.";
  }
  if (enabled && permission === "granted") {
    return "Get notified 10 minutes before a meeting and again when it's starting, with join-link shortcuts when available.";
  }
  return "Turn this on to request permission and get desktop reminders for upcoming Google Calendar meetings.";
}
