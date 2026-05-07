import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
} from "lucide-react";

import { AskBar } from "../components/AskBar";
import { Sidebar } from "../components/Sidebar";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import { createCalendarEvent, deleteCalendarEvent, listCalendarEvents, type CalendarEvent } from "../lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar - Notable" },
      {
        name: "description",
        content: "Browse upcoming months and create Google Meet events directly from Notable.",
      },
    ],
  }),
  component: CalendarPage,
});

function CalendarPage() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [form, setForm] = useState(() => buildDefaultEventForm(new Date()));

  const range = useMemo(() => buildCalendarRange(currentMonth), [currentMonth]);
  const minDateTimeValue = useMemo(() => toLocalDateTimeInputValue(new Date()), []);

  const refreshEvents = async () => {
    const response = await listCalendarEvents({
      time_min: range.timeMin.toISOString(),
      time_max: range.timeMax.toISOString(),
    });
    setEvents(response.events);
  };

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setLoading(true);
    void refreshEvents()
      .then(() => {
        if (!active) return;
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load calendar");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, range.timeMin, range.timeMax]);

  const eventMap = useMemo(() => {
    const nextMap = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      if (!event.start) continue;
      const key = toDateKey(new Date(event.start));
      const items = nextMap.get(key) ?? [];
      items.push(event);
      nextMap.set(key, items);
    }
    for (const items of nextMap.values()) {
      items.sort((left, right) => {
        const leftTime = left.start ? new Date(left.start).getTime() : 0;
        const rightTime = right.start ? new Date(right.start).getTime() : 0;
        return leftTime - rightTime;
      });
    }
    return nextMap;
  }, [events]);

  const monthDays = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);
  const upcomingEvents = useMemo(
    () =>
      [...events]
        .filter((event) => event.start && new Date(event.start) >= new Date())
        .sort((left, right) => new Date(left.start ?? "").getTime() - new Date(right.start ?? "").getTime()),
    [events],
  );
  const pastEvents = useMemo(
    () =>
      [...events]
        .filter((event) => event.start && new Date(event.start) < new Date())
        .sort((left, right) => new Date(right.start ?? "").getTime() - new Date(left.start ?? "").getTime()),
    [events],
  );
  const mobileMonthAgenda = useMemo(
    () =>
      monthDays
        .filter((day) => day.getMonth() === currentMonth.getMonth())
        .map((day) => ({
          day,
          events: eventMap.get(toDateKey(day)) ?? [],
        }))
        .filter((item) => item.events.length > 0),
    [currentMonth, eventMap, monthDays],
  );

  const handleCreateEvent = async () => {
    const startDate = new Date(form.start);
    const endDate = new Date(form.end);
    const now = new Date();
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      setError("Choose a valid start and end time first.");
      return;
    }
    if (startDate < now) {
      setError("Meetings can only be scheduled for now or a future time.");
      return;
    }
    if (endDate <= startDate) {
      setError("End time must be after start time.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const attendeeList = form.attendees
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await createCalendarEvent({
        title: form.title.trim(),
        description: form.description.trim() || null,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        attendees: attendeeList,
      });
      const nextEvent = response.event;
      setEvents((current) =>
        [...current, nextEvent].sort(
          (left, right) => new Date(left.start ?? "").getTime() - new Date(right.start ?? "").getTime(),
        ),
      );
      setDialogOpen(false);
      setForm(buildDefaultEventForm(new Date(nextEvent.start ?? Date.now())));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to create calendar event");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    setDeletingEventId(eventId);
    setError(null);
    try {
      await deleteCalendarEvent(eventId);
      setEvents((current) => current.filter((event) => event.id !== eventId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete calendar event");
    } finally {
      setDeletingEventId((current) => (current === eventId ? null : current));
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl rounded-[1.75rem] border-border bg-card/95 p-0 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="p-6 sm:p-7">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-semibold text-foreground">Create meeting</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-7 text-muted-foreground">
                Schedule a Google Calendar event and let Google generate a Meet link automatically so you can copy or open it right from Notable.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <Field label="Title">
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Team sync"
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className="min-h-24 w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="Agenda or prep notes"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts">
                  <input
                    type="datetime-local"
                    value={form.start}
                    min={minDateTimeValue}
                    onChange={(event) =>
                      setForm((current) => {
                        const nextStart = event.target.value;
                        const nextStartDate = new Date(nextStart);
                        const currentEndDate = new Date(current.end);
                        const adjustedEnd =
                          !Number.isNaN(nextStartDate.getTime()) &&
                          !Number.isNaN(currentEndDate.getTime()) &&
                          currentEndDate <= nextStartDate
                            ? toLocalDateTimeInputValue(new Date(nextStartDate.getTime() + 60 * 60 * 1000))
                            : current.end;
                        return { ...current, start: nextStart, end: adjustedEnd };
                      })
                    }
                    className="w-full bg-transparent text-sm text-foreground outline-none"
                  />
                </Field>
                <Field label="Ends">
                  <input
                    type="datetime-local"
                    value={form.end}
                    min={form.start || minDateTimeValue}
                    onChange={(event) => setForm((current) => ({ ...current, end: event.target.value }))}
                    className="w-full bg-transparent text-sm text-foreground outline-none"
                  />
                </Field>
              </div>

              <Field label="Invitees (optional)">
                <input
                  value={form.attendees}
                  onChange={(event) => setForm((current) => ({ ...current, attendees: event.target.value }))}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  placeholder="name@company.com, another@company.com"
                />
              </Field>
            </div>

            <DialogFooter className="mt-6 gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-background/70 px-5 text-sm font-medium text-foreground/85 transition hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateEvent()}
                disabled={saving || !form.title.trim()}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Creating..." : "Create meeting"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <main className="relative h-screen flex-1 overflow-x-hidden overflow-y-auto pt-16 md:pt-0">
        {!isMobile && (
          <header className="sticky top-16 z-30 border-b border-border/60 bg-background/88 px-4 py-3 backdrop-blur md:top-0 sm:px-6 lg:px-8">
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card/60 px-3 py-2 text-sm font-medium text-foreground/85 transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                <span>Create meeting</span>
              </button>
            </div>
          </header>
        )}

        <div className="mx-auto w-full max-w-6xl overflow-x-hidden px-4 pb-20 pt-4 sm:px-6 sm:pt-6 lg:px-8">
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Calendar</p>
            <h1 className="mt-2 max-w-4xl font-serif-display text-[2.2rem] leading-[0.96] text-foreground/95 sm:text-5xl">
              Plan and join meetings from Notable
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
              Browse your upcoming months, inspect future meetings, and schedule new Google Meet events without bouncing back out to Google Calendar.
            </p>
            {isMobile && (
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card/70 px-4 py-3 text-sm font-medium text-foreground/88 transition hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                Create meeting
              </button>
            )}
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <section className="mt-8 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
            <div className="rounded-[1.75rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/35 p-4 sm:p-5">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Visible month</div>
                      <div className="mt-1 text-2xl font-semibold leading-tight text-foreground sm:text-[1.9rem]">
                        {formatMonthTitle(currentMonth)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentMonth((current) => addMonths(current, -1))}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card/70 text-foreground/75 transition hover:bg-accent"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setCurrentMonth((current) => addMonths(current, 1))}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card/70 text-foreground/75 transition hover:bg-accent"
                        aria-label="Next month"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {isMobile ? (
                    <div className="grid grid-cols-3 gap-2">
                      {buildMonthChips(currentMonth)
                        .slice(2, 5)
                        .map((month) => {
                          const active = isSameMonth(month, currentMonth);
                          return (
                            <button
                              key={month.toISOString()}
                              type="button"
                              onClick={() => setCurrentMonth(month)}
                              className={`rounded-2xl border px-3 py-3 text-left transition ${
                                active
                                  ? "border-foreground bg-foreground text-background shadow-[var(--shadow-soft)]"
                                  : "border-border/80 bg-card/55 text-foreground/82 hover:border-foreground/20 hover:bg-accent/70"
                              }`}
                            >
                              <div
                                className={`text-[10px] uppercase tracking-[0.18em] ${
                                  active ? "text-background/70" : "text-muted-foreground"
                                }`}
                              >
                                {month.toLocaleDateString(undefined, { month: "short" })}
                              </div>
                              <div
                                className={`mt-1 text-lg font-medium leading-none ${
                                  active ? "text-background" : "text-foreground/92"
                                }`}
                              >
                                {month.toLocaleDateString(undefined, { year: "numeric" })}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
                      {buildMonthChips(currentMonth).map((month) => {
                        const active = isSameMonth(month, currentMonth);
                        return (
                          <button
                            key={month.toISOString()}
                            type="button"
                            onClick={() => setCurrentMonth(month)}
                            className={`group shrink-0 rounded-2xl border px-4 py-3 text-left transition ${
                              active
                                ? "border-foreground bg-foreground text-background shadow-[var(--shadow-soft)]"
                                : "border-border/80 bg-card/55 text-foreground/82 hover:border-foreground/20 hover:bg-accent/70"
                            }`}
                          >
                            <div className={`text-[11px] uppercase tracking-[0.18em] ${active ? "text-background/70" : "text-muted-foreground"}`}>
                              {month.toLocaleDateString(undefined, { month: "short" })}
                            </div>
                            <div className={`mt-1 text-base font-medium leading-none ${active ? "text-background" : "text-foreground/92"}`}>
                              {month.toLocaleDateString(undefined, { year: "numeric" })}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {isMobile ? (
                <div className="mt-5 space-y-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">This month</div>
                  {mobileMonthAgenda.length ? (
                    mobileMonthAgenda.map(({ day, events: dayEvents }) => {
                      const isToday = isSameDay(day, new Date());
                      return (
                        <div
                          key={toDateKey(day)}
                          className={`rounded-2xl border p-4 ${
                            isToday ? "border-foreground/25 bg-foreground/[0.04]" : "border-border/70 bg-background/45"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {day.toLocaleDateString(undefined, { weekday: "short" })}
                              </div>
                              <div className="mt-1 text-lg font-semibold text-foreground">
                                {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              </div>
                            </div>
                            <div className="rounded-full bg-foreground/10 px-2.5 py-1 text-[11px] text-foreground/75">
                              {dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}
                            </div>
                          </div>
                          <div className="mt-3 space-y-2">
                            {dayEvents.map((event) => (
                              <div key={event.id} className="rounded-xl border border-border/60 bg-card/70 px-3 py-3">
                                <div className="truncate text-sm font-medium text-foreground/92">{event.title}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatEventDateTime(event.start)}
                                  {event.end ? ` - ${formatEventTime(event.end)}` : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">
                      No meetings scheduled in this month yet.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="mt-6 grid grid-cols-7 gap-2 text-center text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day}>{day}</div>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-7 gap-2">
                    {monthDays.map((day) => {
                      const dateKey = toDateKey(day);
                      const dayEvents = eventMap.get(dateKey) ?? [];
                      const inMonth = day.getMonth() === currentMonth.getMonth();
                      const isToday = isSameDay(day, new Date());

                      return (
                        <div
                          key={dateKey}
                          className={`min-h-28 rounded-2xl border p-2 ${
                            inMonth ? "border-border bg-background/45" : "border-border/50 bg-background/20 text-muted-foreground"
                          } ${isToday ? "ring-1 ring-foreground/30" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${isToday ? "text-foreground" : ""}`}>{day.getDate()}</span>
                            {dayEvents.length ? (
                              <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] text-foreground/75">
                                {dayEvents.length}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 space-y-1">
                            {dayEvents.slice(0, 2).map((event) => (
                              <div key={event.id} className="rounded-xl bg-card px-2 py-1 text-left text-[11px] text-foreground/85">
                                <div className="truncate font-medium">{event.title}</div>
                                <div className="truncate text-muted-foreground">{formatEventTime(event.start)}</div>
                              </div>
                            ))}
                            {dayEvents.length > 2 ? (
                              <div className="text-[11px] text-muted-foreground">+{dayEvents.length - 2} more</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.75rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                    <CalendarDays className="h-4.5 w-4.5 text-foreground/80" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground/92">Upcoming meetings</div>
                    <div className="text-xs text-muted-foreground">Your future Google Calendar events</div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {loading ? (
                    <div className="rounded-2xl border border-border/70 bg-background/45 px-4 py-6 text-sm text-muted-foreground">
                      Loading your calendar...
                    </div>
                  ) : upcomingEvents.length ? (
                    upcomingEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="text-sm font-medium text-foreground/92">{event.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {formatEventDateTime(event.start)}{event.end ? ` - ${formatEventTime(event.end)}` : ""}
                        </div>
                        {event.description ? (
                          <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{event.description}</div>
                        ) : null}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {event.join_url ? (
                            <>
                              <a
                                href={event.join_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/85 transition hover:bg-accent"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open Meet
                              </a>
                              <button
                                type="button"
                                onClick={() => void navigator.clipboard.writeText(event.join_url ?? "")}
                                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/85 transition hover:bg-accent"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Copy link
                              </button>
                            </>
                          ) : null}
                          {event.html_link ? (
                            <a
                              href={event.html_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/85 transition hover:bg-accent"
                            >
                              <CalendarDays className="h-3.5 w-3.5" />
                              Open in Google
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleDeleteEvent(event.id)}
                            disabled={deletingEventId === event.id}
                            className="inline-flex items-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Delete ${event.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingEventId === event.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">
                      No events in this range yet. Create one and it will appear here immediately.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background/60">
                    <CalendarDays className="h-4.5 w-4.5 text-foreground/80" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground/92">Past meetings</div>
                    <div className="text-xs text-muted-foreground">Recent finished calendar events in this visible range</div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {loading ? (
                    <div className="rounded-2xl border border-border/70 bg-background/45 px-4 py-6 text-sm text-muted-foreground">
                      Loading your calendar...
                    </div>
                  ) : pastEvents.length ? (
                    pastEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                        <div className="text-sm font-medium text-foreground/92">{event.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {formatEventDateTime(event.start)}{event.end ? ` - ${formatEventTime(event.end)}` : ""}
                        </div>
                        {event.description ? (
                          <div className="mt-2 line-clamp-2 text-sm text-muted-foreground">{event.description}</div>
                        ) : null}
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          {event.html_link ? (
                            <a
                              href={event.html_link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground/85 transition hover:bg-accent"
                            >
                              <CalendarDays className="h-3.5 w-3.5" />
                              Open in Google
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleDeleteEvent(event.id)}
                            disabled={deletingEventId === event.id}
                            className="inline-flex items-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Delete ${event.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingEventId === event.id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-background/45 px-4 py-8 text-center text-sm text-muted-foreground">
                      No past events in this visible range yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <AskBar
        containerClassName="md:left-64"
        assistantContext={{ page_type: "calendar", visible_month: formatMonthTitle(currentMonth) }}
        onExecutedActions={(actions) => {
          if (
            actions.some(
              (action) =>
                action.status === "success" &&
                (action.action_type === "create_calendar_event" || action.action_type === "delete_calendar_event"),
            )
          ) {
            void refreshEvents().catch(() => undefined);
          }
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="flex min-h-12 w-full items-center rounded-2xl border border-border bg-background/60 px-4 py-3">
        {children}
      </div>
    </label>
  );
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function buildCalendarRange(month: Date) {
  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()) + 1);
  return { timeMin: gridStart, timeMax: gridEnd };
}

function buildMonthGrid(month: Date) {
  const { timeMin, timeMax } = buildCalendarRange(month);
  const days: Date[] = [];
  const cursor = new Date(timeMin);
  while (cursor < timeMax) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildMonthChips(current: Date) {
  return Array.from({ length: 8 }, (_, index) => addMonths(current, index - 2));
}

function isSameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonthTitle(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatEventTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatEventDateTime(value?: string | null) {
  if (!value) return "Unscheduled";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildDefaultEventForm(baseDate: Date) {
  const start = new Date(baseDate);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    title: "",
    description: "",
    start: toLocalDateTimeInputValue(start),
    end: toLocalDateTimeInputValue(end),
    attendees: "",
  };
}

function toLocalDateTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
