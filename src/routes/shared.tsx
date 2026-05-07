import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import { Users, Inbox, ChevronRight, FileText } from "lucide-react";
import { listSharedInbox, parseApiDate, type SharedInboxItem } from "../lib/api";
import { useRequireAuth } from "../hooks/use-require-auth";

export const Route = createFileRoute("/shared")({
  head: () => ({
    meta: [
      { title: "Shared with me - Notable" },
      { name: "description", content: "Notes and meetings shared with you by your team." },
      { property: "og:title", content: "Shared with me - Notable" },
      { property: "og:description", content: "Notes and meetings shared with you by your team." },
    ],
  }),
  component: SharedPage,
});

function SharedPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<SharedInboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    void listSharedInbox()
      .then((response) => {
        if (active) {
          setItems(response);
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
  }, [authLoading]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden pt-16 md:pt-0">
        <div className="mx-auto w-full max-w-3xl px-4 pb-44 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground/70">
              <Users className="h-5 w-5" />
            </div>
            <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">Shared with me</h1>
          </div>

          {loading ? (
            <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-16 text-center sm:px-6">
              <span className="loading-shimmer-text text-sm text-muted-foreground">Loading shared meetings...</span>
            </div>
          ) : items.length ? (
            <div className="mt-10 space-y-3">
              {items.map((item) => (
                <Link
                  key={item.share_token}
                  to="/share/$shareToken"
                  params={{ shareToken: item.share_token }}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card/60 px-4 py-4 shadow-[var(--shadow-soft)] backdrop-blur transition hover:bg-card"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground/70">
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="truncate text-base font-medium text-foreground">{item.title}</div>
                      {item.visibility === "team" && item.team_name ? (
                        <div className="shrink-0 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {item.team_name}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                      Shared by {item.owner_name}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {formatDate(item.updated_at)}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-16 text-center sm:px-6">
              <Inbox className="mx-auto h-7 w-7 text-muted-foreground" />
              <div className="mt-3 text-sm font-medium">Nothing shared yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Meetings you open from shared links will appear here for quick access later.
              </div>
            </div>
          )}
        </div>
        <AskBar containerClassName="md:left-64" />
      </main>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseApiDate(value));
}
