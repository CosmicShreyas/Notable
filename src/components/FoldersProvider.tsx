import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useAuth } from "./AuthProvider";

export type FolderNote = { id: string; title: string };
export type Folder = { id: string; name: string; notes: FolderNote[]; color?: string };

export const FOLDER_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

type Ctx = {
  folders: Folder[];
  createFolder: (name: string, color?: string) => string;
  removeFolder: (id: string) => void;
  addNoteToFolder: (folderId: string, note: FolderNote) => void;
  removeNoteFromFolder: (folderId: string, noteId: string) => void;
  setFolderColor: (id: string, color: string) => void;
};

const FoldersContext = createContext<Ctx | null>(null);
const STORAGE_KEY_PREFIX = "notable.folders";

function normalizeFolderName(name: string) {
  return name.trim().toLowerCase();
}

function getStorageKey(userId: string | null) {
  return userId ? `${STORAGE_KEY_PREFIX}.${userId}` : null;
}

function readStoredFolders(userId: string | null): Folder[] {
  if (typeof window === "undefined") return [];
  const storageKey = getStorageKey(userId);
  if (!storageKey) return [];

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (folder): folder is Folder =>
        !!folder &&
        typeof folder.id === "string" &&
        typeof folder.name === "string" &&
        Array.isArray(folder.notes),
    );
  } catch {
    return [];
  }
}

export function FoldersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = getStorageKey(user?.id ?? null);

  useEffect(() => {
    setFolders(readStoredFolders(user?.id ?? null));
    setHydrated(true);
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined" || !hydrated || !storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(folders));
    } catch {}
  }, [folders, hydrated, storageKey]);

  const createFolder = (name: string, color?: string) => {
    const trimmed = name.trim();
    const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(trimmed));
    if (existing) {
      return existing.id;
    }

    const id = `f_${Date.now().toString(36)}`;
    setFolders((prev) => [
      ...prev,
      { id, name: trimmed, notes: [], color: color ?? FOLDER_COLORS[prev.length % FOLDER_COLORS.length] },
    ]);
    return id;
  };

  const removeFolder = (id: string) =>
    setFolders((prev) => prev.filter((f) => f.id !== id));

  const addNoteToFolder = (folderId: string, note: FolderNote) =>
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId
          ? f.notes.some((n) => n.id === note.id)
            ? f
            : { ...f, notes: [...f.notes, note] }
          : f,
      ),
    );

  const removeNoteFromFolder = (folderId: string, noteId: string) =>
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId ? { ...f, notes: f.notes.filter((n) => n.id !== noteId) } : f,
      ),
    );

  const setFolderColor = (id: string, color: string) =>
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, color } : f)));

  return (
    <FoldersContext.Provider
      value={{ folders, createFolder, removeFolder, addNoteToFolder, removeNoteFromFolder, setFolderColor }}
    >
      {children}
    </FoldersContext.Provider>
  );
}

export function useFolders() {
  const ctx = useContext(FoldersContext);
  if (!ctx) throw new Error("useFolders must be used within FoldersProvider");
  return ctx;
}
