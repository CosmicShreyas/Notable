import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BookText, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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
import {
  createVocabularyEntry,
  deleteVocabularyEntry,
  listVocabularyEntries,
  type VocabularyEntry,
  updateVocabularyEntry,
} from "../lib/api";

export const Route = createFileRoute("/vocabulary")({
  component: VocabularyPage,
});

function VocabularyPage() {
  const { loading: authLoading } = useRequireAuth();
  const [entries, setEntries] = useState<VocabularyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VocabularyEntry | null>(null);
  const [editingEntry, setEditingEntry] = useState<VocabularyEntry | null>(null);
  const [canonical, setCanonical] = useState("");
  const [aliasesInput, setAliasesInput] = useState("");

  const refreshEntries = async () => {
    const response = await listVocabularyEntries();
    setEntries(response.items);
    return response;
  };

  useEffect(() => {
    if (authLoading) return;
    let active = true;

    void refreshEntries()
      .then(() => {
        if (!active) return;
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : "Unable to load vocabulary");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  const parsedAliases = useMemo(() => parseAliases(aliasesInput), [aliasesInput]);

  const openCreateDialog = () => {
    setEditingEntry(null);
    setCanonical("");
    setAliasesInput("");
    setDialogOpen(true);
  };

  const openEditDialog = (entry: VocabularyEntry) => {
    setEditingEntry(entry);
    setCanonical(entry.canonical);
    setAliasesInput(entry.aliases.join(", "));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const canonicalValue = canonical.trim();
    if (!canonicalValue) return;

    setSaving(true);
    setError(null);
    try {
      const payload = { canonical: canonicalValue, aliases: parsedAliases };
      if (editingEntry) {
        const updated = await updateVocabularyEntry(editingEntry.id, payload);
        setEntries((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)).sort(sortVocabularyEntries),
        );
      } else {
        const created = await createVocabularyEntry(payload);
        setEntries((current) => [created, ...current].sort(sortVocabularyEntries));
      }
      setDialogOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save vocabulary entry");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      await deleteVocabularyEntry(deleteTarget.id);
      setEntries((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to delete vocabulary entry");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg rounded-[1.75rem] border-border bg-card/95 p-0 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="p-6 sm:p-7">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-semibold text-foreground">
                {editingEntry ? "Edit vocabulary term" : "Add vocabulary term"}
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-7 text-muted-foreground">
                Add the real term you want Notable to prefer. Aliases are optional, because Notable will also try to auto-correct close transcript mistakes against the canonical term itself.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-4">
              <label className="block">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Canonical term</div>
                <div className="flex min-h-12 w-full items-center rounded-2xl border border-border bg-background/60 px-4 py-3">
                  <input
                    value={canonical}
                    onChange={(event) => setCanonical(event.target.value)}
                    placeholder="e.g. Vibgyor Cafe"
                    className="w-full bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </label>

              <label className="block">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">Aliases (optional)</div>
                <div className="rounded-2xl border border-border bg-background/60 px-4 py-3">
                  <textarea
                    value={aliasesInput}
                    onChange={(event) => setAliasesInput(event.target.value)}
                    placeholder="Optional: Vidya Cafe, Vibgyor cafe"
                    className="min-h-24 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Separate aliases with commas if you already know common mistakes. Even without aliases, Notable now tries to match close transcript variants to your canonical term automatically.
                </div>
              </label>
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
                onClick={() => void handleSave()}
                disabled={saving || !canonical.trim()}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-foreground px-5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : editingEntry ? "Save changes" : "Add term"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md rounded-[1.75rem] border-border bg-card/95 p-0 shadow-[var(--shadow-elevated)] backdrop-blur">
          <div className="p-6 sm:p-7">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-semibold text-foreground">Delete vocabulary term?</DialogTitle>
              <DialogDescription className="mt-2 text-sm leading-7 text-muted-foreground">
                {deleteTarget
                  ? `Remove ${deleteTarget.canonical} and its aliases from your correction dictionary?`
                  : "Remove this vocabulary term from your correction dictionary?"}
              </DialogDescription>
            </DialogHeader>

            <DialogFooter className="mt-6 gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-border bg-background/70 px-5 text-sm font-medium text-foreground/85 transition hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-destructive px-5 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Deleting..." : "Delete term"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <main className="relative flex-1 overflow-y-auto overscroll-contain pt-16 md:pt-0">
        <div className="mx-auto min-h-full w-full max-w-5xl px-4 pb-32 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
            <BookText className="h-3.5 w-3.5" />
            Meeting vocabulary
          </div>

          <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">Vocabulary</h1>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
                Teach Notable the names that matter so transcript-based summaries and chat stay faithful to your meetings.
              </p>
            </div>

            <button
              type="button"
              onClick={openCreateDialog}
              className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-2xl border border-border bg-card/60 px-4 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              <Plus className="h-4 w-4" />
              Add term
            </button>
          </div>

          {error && (
            <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <section className="mt-8 rounded-3xl border border-border bg-card/60 p-6 shadow-[var(--shadow-soft)] backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/75">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="text-lg font-medium text-foreground">How correction works</div>
                <div className="mt-1 text-sm leading-6 text-muted-foreground">
                  Notable first applies exact aliases, then uses a conservative fuzzy matcher to catch close transcript mistakes and map them back to your canonical term before that content is shown in the app or sent into AI summary and chat context.
                </div>
              </div>
            </div>
          </section>

          <section className="mt-8 space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-14 text-center text-sm text-muted-foreground">
                <span className="loading-shimmer-text">Loading vocabulary...</span>
              </div>
            ) : !entries.length ? (
              <div className="rounded-3xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground/[0.06] text-foreground/65">
                  <BookText className="h-6 w-6" />
                </div>
                <div className="mt-4 text-lg font-medium text-foreground">No vocabulary terms yet</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Start with names like company names, client names, products, places, or recurring speaker names.
                </div>
              </div>
            ) : (
              entries.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-3xl border border-border bg-card/60 p-5 shadow-[var(--shadow-soft)] backdrop-blur"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Canonical term</div>
                      <h2 className="mt-2 truncate text-2xl font-semibold text-foreground">{entry.canonical}</h2>
                    </div>
                    <div className="flex items-center gap-2 self-start">
                      <button
                        type="button"
                        onClick={() => openEditDialog(entry)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-border bg-background/60 px-4 text-sm font-medium text-foreground transition hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(entry)}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 text-sm font-medium text-destructive transition hover:bg-destructive/15"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Aliases</div>
                    {entry.aliases.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {entry.aliases.map((alias) => (
                          <span
                            key={alias}
                            className="rounded-full border border-border bg-background/55 px-3 py-1.5 text-xs text-foreground/85"
                          >
                            {alias}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-muted-foreground">
                        No aliases yet. The canonical term will still be preserved when it appears exactly.
                      </div>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        </div>

        <AskBar
          containerClassName="md:left-64"
          assistantContext={{ page_type: "vocabulary" }}
          onExecutedActions={(actions) => {
            if (actions.some((action) => action.status === "success" && action.action_type.includes("vocabulary"))) {
              void refreshEntries().catch(() => undefined);
            }
          }}
        />
      </main>
    </div>
  );
}

function parseAliases(value: string) {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sortVocabularyEntries(a: VocabularyEntry, b: VocabularyEntry) {
  return a.canonical.localeCompare(b.canonical);
}
