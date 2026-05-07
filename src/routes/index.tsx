import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import { MeetingShareDialog } from "../components/MeetingShareDialog";
import { createMeeting, getCachedMeetings, listCalendarEvents, listMeetings, parseApiDate, type CalendarEvent, type Meeting } from "../lib/api";
import { deleteMeeting } from "../lib/api";
import { useRequireAuth } from "../hooks/use-require-auth";
import {
  Plus,
  ChevronRight,
  CalendarOff,
  FileText,
  MoreHorizontal,
  FolderPlus,
  Share2,
  Trash2,
} from "lucide-react";
import { FolderDialog } from "../components/FolderDialog";
import { useFolders } from "../components/FoldersProvider";
import { useIsMobile } from "../hooks/use-mobile";
import { GUIDE_NOTE_ID, GUIDE_NOTE_TITLE, GUIDE_NOTE_PREVIEW } from "../lib/get-started-note";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { loading: authLoading } = useRequireAuth();
  const { folders, removeNoteFromFolder } = useFolders();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [meetings, setMeetings] = useState<Meeting[]>(() => getCachedMeetings());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ id: string; title: string } | null>(null);
  const [shareMeetingId, setShareMeetingId] = useState<string | null>(null);
  const [menuMeetingId, setMenuMeetingId] = useState<string | null>(null);
  const [creatingUpcomingNote, setCreatingUpcomingNote] = useState(false);

  const today = useMemo(() => new Date(), []);
  const todayParts = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(undefined, { day: "2-digit" }).format(today),
      month: new Intl.DateTimeFormat(undefined, { month: "long" }).format(today),
      weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(today),
      full: new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(today),
    }),
    [today],
  );

  useEffect(() => {
    if (authLoading) return;

    let active = true;
    void Promise.all([listMeetings(), listCalendarEvents()])
      .then(([meetingData, eventData]) => {
        if (!active) return;
        setMeetings(meetingData.items);
        setEvents(eventData.events);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  const upcoming = events[0];
  const recentMeetings = meetings.slice(0, isMobile ? 2 : 3);
  const meetingFolderMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string }>>();
    for (const folder of folders) {
      for (const note of folder.notes) {
        const items = map.get(note.id) ?? [];
        items.push({ id: folder.id, name: folder.name });
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
    setDialog(null);
    setMenuMeetingId(null);
  };

  const handleOpenUpcomingMeeting = async () => {
    if (!upcoming || creatingUpcomingNote) return;

    setCreatingUpcomingNote(true);
    try {
      const created = await createMeeting({
        title: upcoming.title?.trim() || "Untitled meeting",
        notes_markdown: "",
        participants: [],
        source_url: upcoming.join_url ?? upcoming.html_link ?? null,
        scheduled_start: upcoming.start ?? null,
        scheduled_end: upcoming.end ?? null,
      });
      await navigate({ to: "/notes/$noteId", params: { noteId: created.id } });
    } finally {
      setCreatingUpcomingNote(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative flex-1 overflow-y-auto overscroll-contain pt-16 md:pt-0">
        <div className="flex items-center justify-end px-4 py-3 sm:px-6">
          <Link
            to="/notes/$noteId"
            params={{ noteId: "new" }}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground/80 backdrop-blur transition hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            Quick note
          </Link>
        </div>

        <div className="mx-auto min-h-full w-full max-w-3xl px-4 pb-28 pt-4 animate-fade-in-up sm:px-6 sm:pb-32 sm:pt-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Today is {todayParts.full}</p>
            <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">Coming up</h1>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur shadow-[var(--shadow-soft)]">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch">
              <div className="flex shrink-0 items-center gap-4 rounded-xl bg-background/40 p-4 text-center sm:w-24 sm:flex-col sm:justify-center sm:gap-1 sm:bg-transparent sm:p-0">
                <div className="text-3xl font-bold leading-none tabular-nums">{todayParts.day}</div>
                <div className="text-left sm:mt-1 sm:text-center">
                  <div className="text-sm text-foreground/80">
                    {todayParts.month}
                    <span className="ml-1 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full bg-foreground/70" />
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">{todayParts.weekday}</div>
                </div>
              </div>

              {upcoming ? (
                <button
                  type="button"
                  onClick={() => {
                    void handleOpenUpcomingMeeting();
                  }}
                  disabled={creatingUpcomingNote}
                  className="group relative flex min-w-0 flex-1 items-center gap-4 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-foreground/[0.06] to-foreground/[0.02] p-3 text-left transition hover:from-foreground/[0.1]"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-foreground/20 to-foreground/40">
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-background">
                      N
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {creatingUpcomingNote ? "Opening meeting note..." : upcoming.title}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {upcoming.start ? formatDateTime(upcoming.start) : "Upcoming meeting"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                </button>
              ) : (
                <Link
                  to="/notes/$noteId"
                  params={{ noteId: GUIDE_NOTE_ID }}
                  className="group relative flex min-w-0 flex-1 items-center gap-4 overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-foreground/[0.06] to-foreground/[0.02] p-3 transition hover:from-foreground/[0.1]"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br from-foreground/20 to-foreground/40">
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-background">
                      N
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{GUIDE_NOTE_TITLE}</div>
                    <div className="truncate text-sm text-muted-foreground">{GUIDE_NOTE_PREVIEW}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
                </Link>
              )}
            </div>

            <div className="mx-4 mb-4 rounded-xl border border-dashed border-border bg-background/40 px-4 py-8 text-center sm:px-6 sm:py-10">
              {loading ? (
                <div className="text-sm text-muted-foreground">
                  <span className="loading-shimmer-text">Loading calendar...</span>
                </div>
              ) : events.length ? (
                <>
                  <div className="text-sm font-medium">Next event</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {events[0].title}
                    {events[0].start ? ` • ${formatDateTime(events[0].start)}` : ""}
                  </div>
                  {events[0].join_url && (
                    <a
                      href={events[0].join_url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                    >
                      Open join link
                    </a>
                  )}
                </>
              ) : (
                <>
                  <CalendarOff className="mx-auto h-6 w-6 text-muted-foreground" />
                  <div className="mt-3 text-sm font-medium">No upcoming events</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">Connect Google Calendar to see your next calls</div>
                </>
              )}
            </div>
          </div>

          <Link
            to="/notes/$noteId"
            params={{ noteId: GUIDE_NOTE_ID }}
            className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card/50 px-4 py-4 text-left shadow-[var(--shadow-soft)] backdrop-blur transition hover:bg-card sm:px-5"
          >
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Guide</div>
              <div className="mt-1 truncate text-base font-semibold text-foreground">{GUIDE_NOTE_TITLE}</div>
              <div className="mt-1 truncate text-sm text-muted-foreground">
                Learn how recording, summaries, chat, and notes work in Notable.
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>

          <div className="mt-10">
            <div className="mb-3 text-sm text-muted-foreground">Recent meetings</div>
            <ul className="space-y-2">
              {recentMeetings.length ? (
                recentMeetings.map((meeting) => {
                  const meetingFolders = meetingFolderMap.get(meeting.id) ?? [];
                  return (
                  <li key={meeting.id} className="relative">
                    <div className="group flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2.5 backdrop-blur transition hover:bg-card">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground/70">
                        <FileText className="h-4 w-4" />
                      </div>
                      <Link to="/notes/$noteId" params={{ noteId: meeting.id }} className="min-w-0 flex-1">
                        <div className="truncate font-medium">{meeting.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {meeting.provider ? `${meeting.provider.replace("_", " ")} • ` : ""}
                          {formatDateTime(meeting.created_at)}
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => setShareMeetingId(meeting.id)}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        aria-label="Share meeting"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuMeetingId((current) => (current === meeting.id ? null : meeting.id))}
                        className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                        aria-label="Meeting actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </div>
                    {menuMeetingId === meeting.id && (
                      <div
                        onMouseLeave={() => setMenuMeetingId(null)}
                        className="absolute bottom-12 right-2 z-40 w-48 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-[var(--shadow-elevated)] animate-fade-in-up"
                      >
                        <MenuItem
                          icon={Share2}
                          label="Share"
                          onClick={() => {
                            setShareMeetingId(meeting.id);
                            setMenuMeetingId(null);
                          }}
                        />
                        <MenuItem
                          icon={FolderPlus}
                          label={meetingFolders.length ? "Remove from folder" : "Add to folder"}
                          onClick={() =>
                            meetingFolders.length
                              ? handleRemoveMeetingFromFolders(meeting.id)
                              : setDialog({ id: meeting.id, title: meeting.title })
                          }
                        />
                        <div className="my-1 h-px bg-border" />
                        <MenuItem icon={Trash2} label="Delete" danger onClick={() => void handleDeleteMeeting(meeting.id)} />
                      </div>
                    )}
                  </li>
                )})
              ) : (
                <li className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
                  No meetings yet. Start one to see it here.
                </li>
              )}
            </ul>
          </div>
        </div>

        <AskBar containerClassName="md:left-64" />
        <FolderDialog
          open={!!dialog}
          onClose={() => {
            setDialog(null);
            setMenuMeetingId(null);
          }}
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseApiDate(value));
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
