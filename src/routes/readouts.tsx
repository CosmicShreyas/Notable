import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Mail, MessagesSquare, RefreshCcw, Sparkles, X } from "lucide-react";

import { AskBar } from "../components/AskBar";
import { Sidebar } from "../components/Sidebar";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import {
  exportReadout,
  generateReadout,
  getSearchConnections,
  listReadouts,
  type Readout,
  type SearchConnectionsStatus,
} from "../lib/api";
import { triggerFileDownload } from "../lib/download";

export const Route = createFileRoute("/readouts")({
  head: () => ({
    meta: [
      { title: "Readouts - Notable" },
      {
        name: "description",
        content: "Generate AI readouts from your recent Gmail and Slack activity inside Notable.",
      },
    ],
  }),
  component: ReadoutsPage,
});

function ReadoutsPage() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const [connections, setConnections] = useState<SearchConnectionsStatus | null>(null);
  const [readouts, setReadouts] = useState<Readout[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<"24h" | "3d" | "7d">("24h");
  const [includeGmail, setIncludeGmail] = useState(true);
  const [includeSlack, setIncludeSlack] = useState(true);
  const [dismissedReadoutIds, setDismissedReadoutIds] = useState<string[]>([]);
  const [exportingReadoutId, setExportingReadoutId] = useState<string | null>(null);

  const refreshReadouts = async () => {
    const [connectionStatus, readoutResponse] = await Promise.all([getSearchConnections(), listReadouts()]);
    setConnections(connectionStatus);
    setReadouts(readoutResponse.items);
  };

  useEffect(() => {
    if (authLoading) return;
    let active = true;

    void refreshReadouts()
      .then(() => {
        if (!active) return;
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load readouts");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("notable.dismissed-readouts");
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setDismissedReadoutIds(parsed.filter((value) => typeof value === "string"));
      }
    } catch {
      // Ignore corrupted local state and keep the page usable.
    }
  }, []);

  const selectedSources = useMemo(() => {
    const sources: ("gmail" | "slack")[] = [];
    if (includeGmail) sources.push("gmail");
    if (includeSlack) sources.push("slack");
    return sources;
  }, [includeGmail, includeSlack]);

  const visibleReadouts = useMemo(
    () => readouts.filter((item) => !dismissedReadoutIds.includes(item.id)),
    [dismissedReadoutIds, readouts],
  );

  const dismissReadout = (readoutId: string) => {
    setDismissedReadoutIds((current) => {
      if (current.includes(readoutId)) return current;
      const next = [...current, readoutId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem("notable.dismissed-readouts", JSON.stringify(next));
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!selectedSources.length) return;
    setGenerating(true);
    setError(null);
    try {
      const next = await generateReadout({ timeframe, sources: selectedSources, max_items_per_source: 8 });
      setReadouts((current) => [next, ...current.filter((item) => item.id !== next.id)]);
      setDismissedReadoutIds((current) => {
        const nextDismissed = current.filter((id) => id !== next.id);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("notable.dismissed-readouts", JSON.stringify(nextDismissed));
        }
        return nextDismissed;
      });
      await refreshReadouts();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to generate readout");
    } finally {
      setGenerating(false);
    }
  };

  const handleExportReadout = async (readoutId: string, format: "pdf" | "docx" | "markdown") => {
    setExportingReadoutId(`${readoutId}:${format}`);
    try {
      const file = await exportReadout(readoutId, format);
      triggerFileDownload(file.blob, file.filename);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to export readout");
    } finally {
      setExportingReadoutId(null);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <main className="relative flex-1 overflow-y-auto overscroll-contain pt-16 md:pt-0">
        <div className="mx-auto min-h-full w-full max-w-6xl px-4 pb-24 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />
            Email and chat readouts
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-serif-display text-3xl leading-tight text-foreground/90 sm:text-5xl">Readouts</h1>
              <p className="mt-3 max-w-3xl text-sm text-muted-foreground sm:text-base">
                Pull your recent Gmail and Slack activity into a clean AI digest with key points, action items, and
                reply suggestions, all using the same model already powering Notable.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !selectedSources.length}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
            >
              <RefreshCcw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
              {generating ? "Generating..." : "Generate readout"}
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <section className="mt-8 space-y-4">
            <div className="rounded-[1.75rem] border border-border bg-card/60 p-5 shadow-[var(--shadow-soft)] backdrop-blur">
              <div className={`grid gap-5 ${isMobile ? "" : "xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] xl:items-start"}`}>
                <div>
                <div className="text-sm font-medium text-foreground">Generate a new readout</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Readouts use the sources you've already connected in Settings. Pick a timeframe, choose the sources,
                  and Notable will save the digest here for later.
                </div>

                <div className="mt-5">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Timeframe</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "24h", label: "24h" },
                      { value: "3d", label: "3 days" },
                      { value: "7d", label: "7 days" },
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setTimeframe(option.value as "24h" | "3d" | "7d")}
                        className={`rounded-2xl border px-3 py-2 text-sm transition ${isMobile ? "min-w-0" : ""} ${
                          timeframe === option.value
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-background/60 text-foreground/85 hover:bg-accent"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <SourceToggle
                    icon={<Mail className="h-4 w-4" />}
                    label="Gmail"
                    description={
                      connections?.gmail_connected
                        ? "Connected and ready for readouts."
                        : "Reconnect Google in Settings to include Gmail."
                    }
                    checked={includeGmail}
                    onChange={setIncludeGmail}
                    disabled={!connections?.gmail_connected}
                  />
                  <SourceToggle
                    icon={<MessagesSquare className="h-4 w-4" />}
                    label="Slack"
                    description={
                      connections?.slack_connected
                        ? "Connected and ready for readouts."
                        : "Connect Slack in Settings to include chat activity."
                    }
                    checked={includeSlack}
                    onChange={setIncludeSlack}
                    disabled={!connections?.slack_connected}
                  />
                </div>

                {connections?.notes?.length ? (
                  <div className="mt-5 rounded-2xl border border-border/70 bg-background/45 p-4 text-sm text-muted-foreground">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Connection notes</div>
                    <ul className="mt-3 space-y-2">
                      {connections.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
                {!isMobile && (
                  <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-background/35 px-5 py-6 text-sm leading-6 text-muted-foreground">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">How it flows</div>
                    <p className="mt-3">
                      Generate a fresh readout from the sources on the left, then skim the saved digests below in a horizontal rail.
                    </p>
                    <p className="mt-3">
                      This keeps the creation controls anchored at the top while the actual readout results live in their own browsing lane underneath.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              {loading ? (
                <div className="rounded-[1.75rem] border border-border bg-card/60 px-5 py-8 text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
                  Loading your readouts...
                </div>
              ) : visibleReadouts.length ? (
                <div
                  className={`-mx-1 px-1 pb-2 ${
                    isMobile
                      ? "space-y-4"
                      : "flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory"
                  }`}
                >
                  {visibleReadouts.map((readout) => (
                    <ReadoutCard
                      key={readout.id}
                      readout={readout}
                      onDismiss={() => dismissReadout(readout.id)}
                      onExport={handleExportReadout}
                      exportState={exportingReadoutId}
                      horizontal={!isMobile}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.75rem] border border-dashed border-border bg-card/50 px-5 py-10 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
                  Generate your first readout and Notable will save it here.
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <AskBar
        containerClassName="md:left-64"
        assistantContext={{ page_type: "readouts" }}
        onExecutedActions={(actions) => {
          if (actions.some((action) => action.status === "success" && action.action_type === "generate_readout")) {
            void refreshReadouts().catch(() => undefined);
          }
        }}
      />
    </div>
  );
}

function SourceToggle({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
        checked ? "border-foreground/30 bg-background/70" : "border-border bg-background/45"
      } disabled:cursor-not-allowed disabled:opacity-55`}
    >
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card/70 text-foreground/80">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="pr-2 text-sm font-medium text-foreground">{label}</div>
          <div
            className={`h-5 w-9 rounded-full border transition ${
              checked ? "border-foreground bg-foreground" : "border-border bg-card"
            }`}
          >
            <div
              className={`mt-[1px] h-4 w-4 rounded-full bg-background transition ${checked ? "ml-4" : "ml-0.5"}`}
            />
          </div>
        </div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
      </div>
    </button>
  );
}

function ReadoutCard({
  readout,
  onDismiss,
  onExport,
  exportState,
  horizontal,
}: {
  readout: Readout;
  onDismiss: () => void;
  onExport: (readoutId: string, format: "pdf" | "docx" | "markdown") => void;
  exportState: string | null;
  horizontal: boolean;
}) {
  return (
    <article
      className={`rounded-[1.75rem] border border-border bg-card/60 p-4 shadow-[var(--shadow-soft)] backdrop-blur sm:p-5 ${
        horizontal ? "w-full min-w-[min(100%,72rem)] shrink-0 snap-start" : "w-full"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {readout.sources.map((source) => source.toUpperCase()).join(" • ")} • {readout.timeframe}
          </div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">{readout.title}</h2>
          <div className="mt-2 text-xs text-muted-foreground">{new Date(readout.created_at).toLocaleString()}</div>
        </div>

        <div className="flex flex-wrap items-start gap-2 sm:justify-end">
          {readout.source_counts.map((item) => (
            <span
              key={item.source}
              className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground"
            >
              {item.label}: {item.count}
            </span>
          ))}
          {(["pdf", "docx", "markdown"] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => onExport(readout.id, format)}
              disabled={exportState === `${readout.id}:${format}`}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-border bg-background/60 px-2.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {exportState === `${readout.id}:${format}` ? "..." : format}
            </button>
          ))}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/60 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label={`Dismiss ${readout.title}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-border/70 bg-background/45 p-4">
        <MarkdownRenderer markdown={readout.summary} className="markdown-chat" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <ListBlock title="Key points" items={readout.key_points} />
        <ListBlock title="Action items" items={readout.action_items} />
        <ListBlock title="Suggested replies" items={readout.suggested_replies} />
      </div>

      {readout.notices.length ? (
        <div className="mt-5 rounded-2xl border border-border/70 bg-background/45 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes</div>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {readout.notices.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/45 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-foreground/90">
        {items.length ? (
          items.map((item) => <li key={item}>• {item}</li>)
        ) : (
          <li className="text-muted-foreground">Nothing notable here yet.</li>
        )}
      </ul>
    </div>
  );
}
