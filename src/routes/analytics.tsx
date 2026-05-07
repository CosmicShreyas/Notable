import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronLeft,
  Clock3,
  Download,
  FileText,
  Home as HomeIcon,
  MessagesSquare,
  Share2,
  Sparkles,
  Users,
} from "lucide-react";

import { AskBar } from "../components/AskBar";
import { Sidebar } from "../components/Sidebar";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import { exportAnalytics, getMeetingAnalytics, type MeetingAnalyticsResponse } from "../lib/api";
import { triggerFileDownload } from "../lib/download";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics - Notable" },
      {
        name: "description",
        content: "See meeting health, activity trends, and sharing insights across your Notable workspace.",
      },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const [data, setData] = useState<MeetingAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | "markdown" | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void getMeetingAnalytics()
      .then((response) => {
        if (!active) return;
        setData(response);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load analytics");
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  const maxMonthlyMeetings = useMemo(() => {
    if (!data?.monthly_activity?.length) return 1;
    return Math.max(...data.monthly_activity.map((item) => item.meetings), 1);
  }, [data]);

  const handleExport = async (format: "pdf" | "docx" | "markdown") => {
    setExportingFormat(format);
    try {
      const file = await exportAnalytics(format);
      triggerFileDownload(file.blob, file.filename);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to export analytics");
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative h-screen flex-1 overflow-y-auto pt-16 md:pt-0">
        {!isMobile && (
          <header className="sticky top-16 z-30 border-b border-border/60 bg-background/88 px-4 py-3 backdrop-blur md:top-0 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
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
              <div className="text-sm text-muted-foreground">Meeting analytics dashboard</div>
            </div>
          </header>
        )}

        <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-4 sm:px-6 sm:pt-6 lg:px-8">
          <div className="animate-fade-in-up">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Analytics</p>
                <h1 className="mt-2 font-serif-display text-3xl leading-tight text-foreground/95 sm:text-5xl">
                  See how your meetings actually behave
                </h1>
                <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
                  Notable turns transcripts, summaries, action items, and sharing activity into a meeting health dashboard so you can spot patterns instead of reading every note one by one.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(["pdf", "docx", "markdown"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => void handleExport(format)}
                    disabled={exportingFormat !== null}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-card/60 px-4 text-xs font-medium uppercase tracking-[0.16em] text-foreground/82 transition hover:bg-accent disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportingFormat === format ? "Exporting..." : format}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-8 rounded-[1.5rem] border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {error}
            </div>
          ) : !data ? (
            <div className="mt-8 rounded-[1.75rem] border border-border bg-card/50 px-5 py-8 text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
              Loading your meeting analytics...
            </div>
          ) : (
            <>
              <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <MetricCard icon={<BarChart3 className="h-4.5 w-4.5" />} label="Total meetings" value={String(data.overview.total_meetings)} />
                <MetricCard icon={<FileText className="h-4.5 w-4.5" />} label="Summary coverage" value={`${percentage(data.overview.summarized_meetings, data.overview.total_meetings)}%`} />
                <MetricCard icon={<Clock3 className="h-4.5 w-4.5" />} label="Average duration" value={`${formatNumber(data.overview.average_duration_minutes)} min`} />
                <MetricCard icon={<Users className="h-4.5 w-4.5" />} label="Average participants" value={formatNumber(data.overview.average_participants)} />
                <MetricCard icon={<MessagesSquare className="h-4.5 w-4.5" />} label="Questions captured" value={String(data.overview.total_questions)} />
              </section>

              <section className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
                <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                      <Sparkles className="h-4.5 w-4.5 text-foreground/80" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground/92">What stands out</div>
                      <div className="text-xs text-muted-foreground">Quick reads from your meeting history</div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {data.highlights.map((highlight) => (
                      <div key={highlight.title} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="text-sm font-medium text-foreground/92">{highlight.title}</div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{highlight.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                      <Share2 className="h-4.5 w-4.5 text-foreground/80" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground/92">Sharing breakdown</div>
                      <div className="text-xs text-muted-foreground">How your meetings are getting distributed</div>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {data.visibility_breakdown.map((item) => (
                      <div key={item.visibility} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-foreground/92">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.meetings} meetings</div>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-border/60">
                          <div
                            className="h-full rounded-full bg-foreground/80"
                            style={{ width: `${percentage(item.meetings, data.overview.total_meetings)}%` }}
                          />
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">{item.total_views} views across shared links</div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                  <div className="text-sm font-medium text-foreground/92">Provider mix</div>
                  <div className="mt-1 text-xs text-muted-foreground">Where your meetings are being captured</div>

                  <div className="mt-5 space-y-4">
                    {data.provider_breakdown.map((provider) => (
                      <div key={provider.provider} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-foreground/92">{provider.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Avg duration {formatNumber(provider.average_duration_minutes)} min
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{provider.meetings} meetings</div>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-border/60">
                          <div
                            className="h-full rounded-full bg-foreground/80"
                            style={{ width: `${percentage(provider.meetings, data.overview.total_meetings)}%` }}
                          />
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground">{provider.share_count} shared externally or with the team</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                  <div className="text-sm font-medium text-foreground/92">Monthly activity</div>
                  <div className="mt-1 text-xs text-muted-foreground">Meetings, actions, and transcript volume over time</div>

                  <div className="mt-5 space-y-3">
                    {data.monthly_activity.map((point) => (
                      <div key={point.key} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-foreground/92">{point.label}</div>
                          <div className="text-xs text-muted-foreground">{point.meetings} meetings</div>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-border/60">
                          <div
                            className="h-full rounded-full bg-foreground/80"
                            style={{ width: `${Math.max((point.meetings / maxMonthlyMeetings) * 100, point.meetings > 0 ? 10 : 0)}%` }}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                          <span>{point.action_items} actions</span>
                          <span>{point.words.toLocaleString()} words</span>
                          <span>{point.meetings ? Math.round(point.words / point.meetings).toLocaleString() : 0} words/meeting</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-8 rounded-[1.75rem] border border-border bg-card/50 p-5 shadow-[var(--shadow-soft)]">
                <div className="text-sm font-medium text-foreground/92">Top meetings by follow-through</div>
                <div className="mt-1 text-xs text-muted-foreground">Sessions with the most action, depth, or downstream attention</div>

                <div className="mt-5 space-y-3">
                  {data.top_meetings.map((meeting) => (
                    <Link
                      key={meeting.meeting_id}
                      to="/notes/$noteId"
                      params={{ noteId: meeting.meeting_id }}
                      className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/45 p-4 transition hover:border-foreground/30 hover:bg-background/65 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground/92">{meeting.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {providerLabel(meeting.provider)} • {new Date(meeting.updated_at).toLocaleDateString()}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-5">
                        <StatPill label="Actions" value={String(meeting.action_items)} />
                        <StatPill label="Questions" value={String(meeting.questions)} />
                        <StatPill label="Minutes" value={formatNumber(meeting.duration_minutes)} />
                        <StatPill label="Words" value={meeting.words.toLocaleString()} />
                        <StatPill label="Views" value={String(meeting.share_views)} />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      <AskBar containerClassName="md:left-64" assistantContext={{ page_type: "analytics" }} />
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60 text-foreground/80">
        {icon}
      </div>
      <div className="mt-4 text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-medium text-foreground/95">{value}</div>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium text-foreground/92">{value}</div>
    </div>
  );
}

function percentage(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(value % 1 === 0 ? 0 : 1) : "0";
}

function providerLabel(provider?: string | null) {
  const labelMap: Record<string, string> = {
    google_meet: "Google Meet",
    zoom: "Zoom",
    microsoft_teams: "Microsoft Teams",
    other: "Other",
  };
  if (!provider) return "Other";
  return labelMap[provider] ?? provider.replaceAll("_", " ");
}
