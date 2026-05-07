import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Filter,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Share2,
  Search,
  Sparkles,
  Trash2,
  Video,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import { FolderDialog } from "../components/FolderDialog";
import { useFolders } from "../components/FoldersProvider";
import { MeetingShareDialog } from "../components/MeetingShareDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { deleteMeeting, getCachedMeetings, listMeetings, parseApiDate, type Meeting } from "../lib/api";
import { useRequireAuth } from "../hooks/use-require-auth";

type StatusFilter = "all" | "scheduled" | "completed";
type ProviderFilter = "all" | "zoom" | "google_meet" | "microsoft_teams" | "generic";
type SummaryFilter = "all" | "with" | "without";

export const Route = createFileRoute("/my-notes")({
  head: () => ({
    meta: [
      { title: "My notes - Notable" },
      { name: "description", content: "Browse, filter, and manage all your meeting notes." },
      { property: "og:title", content: "My notes - Notable" },
      { property: "og:description", content: "Browse, filter, and manage all your meeting notes." },
    ],
  }),
  component: MyNotesPage,
});

function MyNotesPage() {
  const { loading: authLoading } = useRequireAuth();
  const { folders, removeNoteFromFolder } = useFolders();
  const [dialog, setDialog] = useState<{ id: string; title: string } | null>(null);
  const [shareMeetingId, setShareMeetingId] = useState<string | null>(null);
  const [menuMeetingId, setMenuMeetingId] = useState<string | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>(() => getCachedMeetings());
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>("all");

  const deferredSearchText = useDeferredValue(searchText);

  useEffect(() => {
    if (authLoading) return;

    let active = true;
    setLoading(true);

    void listMeetings({
      search: deferredSearchText || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      provider: providerFilter === "all" ? undefined : providerFilter,
      has_summary:
        summaryFilter === "all" ? undefined : summaryFilter === "with",
    })
      .then((data) => {
        if (active) setMeetings(data.items);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, deferredSearchText, providerFilter, statusFilter, summaryFilter]);

  const completedCount = useMemo(
    () => meetings.filter((meeting) => meeting.status === "completed").length,
    [meetings],
  );
  const latestRecordedAt = useMemo(
    () =>
      meetings.length
        ? formatDateTime(
            meetings.reduce((latest, meeting) =>
              parseApiDate(meeting.created_at).getTime() > parseApiDate(latest.created_at).getTime() ? meeting : latest,
            ).created_at,
          )
        : "No notes yet",
    [meetings],
  );
  const meetingFolderMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; color?: string }>>();
    for (const folder of folders) {
      for (const note of folder.notes) {
        const items = map.get(note.id) ?? [];
        items.push({ id: folder.id, name: folder.name, color: folder.color });
        map.set(note.id, items);
      }
    }
    return map;
  }, [folders]);

  const handleDeleteMeeting = async (meetingId: string) => {
    await deleteMeeting(meetingId);
    setMeetings((current) => current.filter((meeting) => meeting.id !== meetingId));
    setMenuMeetingId(null);
  };

  const handleRemoveMeetingFromFolders = (meetingId: string) => {
    const linkedFolders = meetingFolderMap.get(meetingId) ?? [];
    for (const folder of linkedFolders) {
      removeNoteFromFolder(folder.id, meetingId);
    }
  };

  const resetFilters = () => {
    setSearchText("");
    setStatusFilter("all");
    setProviderFilter("all");
    setSummaryFilter("all");
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto overscroll-contain pt-16 md:pt-0">
        <div className="mx-auto min-h-full w-full max-w-5xl px-4 pb-32 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Notes archive
              </div>
              <h1 className="mt-4 font-serif-display text-4xl text-foreground/90 sm:text-5xl">My notes</h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
                Every meeting note, transcript, and summary you have captured so far, with filters to find what matters quickly.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:w-auto">
              <MetricCard label="Total notes" value={meetings.length} caption={latestRecordedAt} />
              <MetricCard label="Summarized" value={completedCount} caption={`${meetings.length ? Math.round((completedCount / meetings.length) * 100) : 0}% complete`} />
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-border bg-card/60 p-4 shadow-[var(--shadow-soft)] backdrop-blur">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-background/50 px-4 py-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search by title, notes, or summary"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFiltersOpen((current) => !current)}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground/85 transition hover:bg-accent"
                >
                  <Filter className="h-4 w-4" />
                  Filters
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-border bg-background/60 px-4 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>

            {filtersOpen && (
              <div className="mt-4 grid gap-3 border-t border-border/70 pt-4 sm:grid-cols-3">
                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as StatusFilter)}
                  options={[
                    { label: "All statuses", value: "all" },
                    { label: "Scheduled", value: "scheduled" },
                    { label: "Completed", value: "completed" },
                  ]}
                />
                <FilterSelect
                  label="Provider"
                  value={providerFilter}
                  onChange={(value) => setProviderFilter(value as ProviderFilter)}
                  options={[
                    { label: "All providers", value: "all" },
                    { label: "Zoom", value: "zoom" },
                    { label: "Google Meet", value: "google_meet" },
                    { label: "Microsoft Teams", value: "microsoft_teams" },
                    { label: "Generic", value: "generic" },
                  ]}
                />
                <FilterSelect
                  label="Summary"
                  value={summaryFilter}
                  onChange={(value) => setSummaryFilter(value as SummaryFilter)}
                  options={[
                    { label: "All notes", value: "all" },
                    { label: "With summary", value: "with" },
                    { label: "Without summary", value: "without" },
                  ]}
                />
              </div>
            )}
          </div>

          <div className="mt-8 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-14 text-center text-sm text-muted-foreground">
                <span className="loading-shimmer-text">Loading your meeting notes...</span>
              </div>
            ) : meetings.length ? (
              meetings.map((meeting) => {
                const meetingFolders = meetingFolderMap.get(meeting.id) ?? [];
                return (
                <article key={meeting.id} className="relative overflow-visible rounded-2xl border border-border bg-card/60 p-4 shadow-[var(--shadow-soft)] backdrop-blur transition hover:bg-card">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground/70">
                      <FileText className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <Link to="/notes/$noteId" params={{ noteId: meeting.id }} className="block truncate text-base font-semibold text-foreground transition hover:text-foreground/75">
                            {meeting.title}
                          </Link>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays className="h-3.5 w-3.5" />
                              {formatDateTime(meeting.created_at)}
                            </span>
                            {meeting.provider && (
                              <span className="inline-flex items-center gap-1.5">
                                <Video className="h-3.5 w-3.5" />
                                {formatProvider(meeting.provider)}
                              </span>
                            )}
                            <StatusBadge status={meeting.status} />
                            {meetingFolders.map((folder) => (
                              <span
                                key={folder.id}
                                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
                                style={{
                                  borderColor: folder.color ? `${folder.color}55` : undefined,
                                  backgroundColor: folder.color ? `${folder.color}14` : undefined,
                                  color: folder.color ?? undefined,
                                }}
                              >
                                <Folder className="h-3.5 w-3.5" />
                                {folder.name}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-start">
                          <button
                            type="button"
                            onClick={() => setShareMeetingId(meeting.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                            Share
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              meetingFolders.length
                                ? handleRemoveMeetingFromFolders(meeting.id)
                                : setDialog({ id: meeting.id, title: meeting.title })
                            }
                            className="hidden items-center gap-1.5 rounded-lg border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground sm:flex"
                          >
                            <FolderPlus className="h-3.5 w-3.5" />
                            {meetingFolders.length ? "Remove from folder" : "Add to folder"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setMenuMeetingId((current) => (current === meeting.id ? null : meeting.id))}
                            className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                            aria-label="Meeting actions"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                        {renderMarkdownPreview(
                          meeting.summary ||
                            meeting.notes_markdown ||
                            "No summary or notes saved yet for this meeting.",
                        )}
                      </div>
                    </div>
                  </div>

                  {menuMeetingId === meeting.id && (
                    <div
                      onMouseLeave={() => setMenuMeetingId(null)}
                      className="absolute bottom-14 right-4 z-40 w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-[var(--shadow-elevated)] animate-fade-in-up"
                    >
                      <MenuItem
                        icon={Share2}
                        label="Share"
                        onClick={() => {
                          setShareMeetingId(meeting.id);
                          setMenuMeetingId(null);
                        }}
                      />
                      <MenuItem icon={Trash2} label="Delete" danger onClick={() => void handleDeleteMeeting(meeting.id)} />
                    </div>
                  )}
                </article>
              )})
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-14 text-center text-sm text-muted-foreground">
                No notes matched those filters. Try clearing them or start a new meeting.
              </div>
            )}
          </div>
        </div>
        <AskBar containerClassName="md:left-64" />
        <FolderDialog
          open={!!dialog}
          onClose={() => setDialog(null)}
          noteId={dialog?.id}
          noteTitle={dialog?.title}
        />
        <MeetingShareDialog
          meetingId={shareMeetingId}
          open={!!shareMeetingId}
          onOpenChange={(open) => {
            if (!open) {
              setShareMeetingId(null);
            }
          }}
        />
      </main>
    </div>
  );
}

function MetricCard({ label, value, caption }: { label: string; value: number; caption: string }) {
  return (
    <div className="rounded-[1.65rem] border border-border bg-gradient-to-br from-card via-card/80 to-background/40 px-4 py-4 shadow-[var(--shadow-soft)] backdrop-blur">
      <div className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{caption}</div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-11 rounded-xl border-border bg-gradient-to-br from-background/80 to-card/70 px-3 text-sm text-foreground shadow-none ring-offset-0 focus:ring-1 focus:ring-ring">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-xl border-border bg-popover/95 text-popover-foreground shadow-[var(--shadow-elevated)] backdrop-blur">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="rounded-lg px-3 py-2 text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "completed"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : "border-amber-500/20 bg-amber-500/10 text-amber-300";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] ${classes}`}>
      {status}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseApiDate(value));
}

function formatProvider(provider: string) {
  if (provider === "google_meet") return "Google Meet";
  if (provider === "microsoft_teams") return "Microsoft Teams";
  if (provider === "zoom") return "Zoom";
  return "Generic";
}

function renderMarkdownPreview(markdown: string) {
  const normalized = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^\d+\.\s+/gm, "")
    .trim();

  const tokens = normalized.split(/(\*\*.*?\*\*|`.*?`|\*.*?\*)/g).filter(Boolean);

  return tokens.map((token, index) => {
    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-foreground/90">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith("*") && token.endsWith("*")) {
      return (
        <em key={index} className="italic text-foreground/85">
          {token.slice(1, -1)}
        </em>
      );
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-foreground/[0.06] px-1 py-0.5 text-[0.92em] text-foreground/85">
          {token.slice(1, -1)}
        </code>
      );
    }

    return <span key={index}>{token}</span>;
  });
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition hover:bg-accent ${
        danger ? "text-destructive" : "text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
