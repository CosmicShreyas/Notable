import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { useFolders, FOLDER_COLORS } from "./FoldersProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export function FolderDialog({
  open,
  onClose,
  noteId,
  noteTitle,
}: {
  open: boolean;
  onClose: () => void;
  noteId?: string;
  noteTitle?: string;
}) {
  const { folders, createFolder, addNoteToFolder } = useFolders();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const trimmedName = name.trim();
  const duplicateFolder = folders.find((folder) => folder.name.trim().toLowerCase() === trimmedName.toLowerCase());

  if (!open) return null;

  const handleCreate = () => {
    if (!trimmedName) return;
    const id = createFolder(trimmedName, color);
    if (noteId && noteTitle) addNoteToFolder(id, { id: noteId, title: noteTitle });
    setName("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] rounded-2xl border-border bg-popover p-5 sm:max-w-md">
        <DialogHeader className="text-left">
          <div className="flex items-start gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-foreground/[0.08]">
              <FolderPlus className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="font-serif-display text-lg leading-tight">
                {noteId ? "Add to folder" : "New folder"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {noteId ? "Pick or create a folder" : "Organize your notes"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {noteId && folders.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              Existing folders
            </div>
            <ul className="scrollbar-hide max-h-48 space-y-1 overflow-y-auto pr-1">
              {folders.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => {
                      addNoteToFolder(f.id, { id: noteId!, title: noteTitle! });
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2 text-sm transition hover:bg-accent"
                  >
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {f.notes.length} note{f.notes.length === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            {noteId ? "Or create new" : "Folder name"}
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="e.g. Product strategy"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground/30"
          />
        </div>

        {duplicateFolder && (
          <div className="mt-2 text-xs text-muted-foreground">
            A folder with this name already exists. Creating now will use <span className="text-foreground/85">{duplicateFolder.name}</span>.
          </div>
        )}

        <div className="mt-4">
          <label className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Pick ${c}`}
                className={`h-6 w-6 rounded-full border-2 transition ${
                  color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium transition hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!trimmedName}
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-40"
          >
            {duplicateFolder ? (noteId ? "Add to existing" : "Use existing") : noteId ? "Create & add" : "Create folder"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
