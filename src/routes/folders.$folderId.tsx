import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import { useFolders } from "../components/FoldersProvider";
import { Folder, FileText, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/folders/$folderId")({
  component: FolderPage,
});

function FolderPage() {
  const { folderId } = Route.useParams();
  const { folders, removeFolder, removeNoteFromFolder } = useFolders();
  const navigate = useNavigate();
  const folder = folders.find((f) => f.id === folderId);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden pt-16 md:pt-0">
        <div className="mx-auto w-full max-w-3xl px-4 pb-44 pt-6 animate-fade-in-up sm:px-6 sm:pt-10">
          {!folder ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-16 text-center sm:px-6">
              <div className="text-sm font-medium">Folder not found</div>
              <Link to="/" className="mt-3 inline-block text-xs text-muted-foreground underline">
                Go home
              </Link>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-foreground/[0.06] text-foreground/70 shadow-[var(--shadow-soft)]"
                    style={
                      folder.color
                        ? {
                            color: folder.color,
                            backgroundColor: `${folder.color}1A`,
                            borderColor: `${folder.color}33`,
                          }
                        : undefined
                    }
                  >
                    <Folder
                      className="h-5 w-5"
                      style={{
                        color: folder.color ?? "currentColor",
                        fill: folder.color ? `${folder.color}26` : "transparent",
                      }}
                    />
                  </div>
                  <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">{folder.name}</h1>
                </div>
                <button
                  onClick={() => {
                    removeFolder(folder.id);
                    navigate({ to: "/" });
                  }}
                  className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete folder
                </button>
              </div>

              {folder.notes.length === 0 ? (
                <div className="mt-10 rounded-2xl border border-dashed border-border bg-card/40 px-4 py-16 text-center sm:px-6">
                  <div className="text-sm font-medium">No notes in this folder yet</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Open a note and use "Add to folder" to organize it here.
                  </div>
                </div>
              ) : (
                <div className="mt-8 rounded-3xl border border-border bg-card/45 p-3 shadow-[var(--shadow-soft)] backdrop-blur">
                  <div className="mb-3 flex items-center justify-between px-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notes in folder</div>
                      <div className="mt-1 text-sm text-foreground/80">
                        {folder.notes.length} saved note{folder.notes.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <ul className="scrollbar-hide max-h-[min(55vh,32rem)] space-y-2 overflow-y-auto pr-1">
                    {folder.notes.map((n) => (
                      <li
                        key={n.id}
                        className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card/90 to-background/30 px-3 py-3 shadow-[var(--shadow-soft)] transition hover:border-border hover:bg-card"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.06] text-foreground/70">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link
                            to="/notes/$noteId"
                            params={{ noteId: n.id }}
                            className="block truncate text-sm font-semibold text-foreground transition hover:text-foreground/75"
                          >
                            {n.title}
                          </Link>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Open note
                          </div>
                        </div>
                        <button
                          onClick={() => removeNoteFromFolder(folder.id, n.id)}
                          className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-destructive"
                          aria-label="Remove from folder"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
        <AskBar
          containerClassName="md:left-64"
          assistantContext={
            folder
              ? {
                  page_type: "folder",
                  folder_id: folder.id,
                  folder_name: folder.name,
                }
              : { page_type: "folder" }
          }
        />
      </main>
    </div>
  );
}
