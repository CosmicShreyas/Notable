import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BellRing, FolderOpen, Home, MessageSquare, Search, Settings, FileText, Plus, Building2 } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./ui/command";
import { useFolders } from "./FoldersProvider";
import { getCachedMeetings, listMeetings, type Meeting } from "../lib/api";
import { GUIDE_NOTE_ID, GUIDE_NOTE_PREVIEW, GUIDE_NOTE_TITLE } from "../lib/get-started-note";

type SearchTarget = { label: string; to: string; description: string; icon: ElementType };

const pageTargets: SearchTarget[] = [
  { label: "Home", to: "/", description: "Coming up and recent notes", icon: Home },
  { label: "Chat", to: "/chat", description: "Ask Notable about your notes", icon: MessageSquare },
  { label: "My notes", to: "/my-notes", description: "Private notes and drafts", icon: FileText },
  { label: "Shared with me", to: "/shared", description: "Notes shared by your team", icon: FolderOpen },
  { label: "My teams", to: "/teams", description: "Invite teammates and manage your workspace", icon: Building2 },
  { label: "Settings", to: "/settings", description: "Preferences and account", icon: Settings },
];

const quickTargets: SearchTarget[] = [
  { label: "New note", to: "/notes/new", description: "Start a fresh note", icon: Plus },
  { label: "Open chat", to: "/chat", description: "Jump into the AI chat", icon: Search },
  { label: "Open settings", to: "/settings", description: "Adjust Notable preferences", icon: BellRing },
];

export function SpotlightSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { folders } = useFolders();
  const [meetings, setMeetings] = useState<Meeting[]>(() => getCachedMeetings());

  useEffect(() => {
    if (!open) return;

    let active = true;
    void listMeetings().then((data) => {
      if (active) {
        setMeetings(data.items);
      }
    });

    return () => {
      active = false;
    };
  }, [open]);

  const noteTargets = useMemo(
    () => {
      const guideNote = {
        key: GUIDE_NOTE_ID,
        label: GUIDE_NOTE_TITLE,
        to: `/notes/${GUIDE_NOTE_ID}`,
        description: GUIDE_NOTE_PREVIEW,
        keywords: `${GUIDE_NOTE_TITLE} ${GUIDE_NOTE_PREVIEW} guide help tutorial onboarding`,
      };

      const meetingTargets = meetings.map((meeting) => ({
        key: meeting.id,
        label: meeting.title,
        to: `/notes/${meeting.id}`,
        description: meeting.summary ? "Saved meeting note" : "Meeting note",
        keywords: `${meeting.title} ${meeting.notes_markdown ?? ""} ${meeting.summary ?? ""}`,
      }));

      const folderTargets = folders.flatMap((folder) =>
        folder.notes.map((note) => ({
          key: `folder-${folder.id}-${note.id}`,
          label: note.title,
          to: `/notes/${note.id}`,
          description: `In folder ${folder.name}`,
          keywords: `${note.title} ${folder.name}`,
        })),
      );

      const uniqueTargets = new Map<string, (typeof meetingTargets)[number] | typeof guideNote>();
      uniqueTargets.set(guideNote.key, guideNote);
      for (const target of [...meetingTargets, ...folderTargets]) {
        if (!uniqueTargets.has(target.to)) {
          uniqueTargets.set(target.to, target);
        }
      }

      return Array.from(uniqueTargets.values());
    },
    [folders, meetings],
  );

  const go = (to: string) => {
    onOpenChange(false);
    navigate({ to: to as never });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command className="rounded-3xl border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur">
        <CommandInput placeholder="Search notes, pages, and actions..." />
        <CommandList className="scrollbar-hide max-h-[min(65vh,32rem)] px-2 pb-2">
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Pages">
            {pageTargets.map((item) => (
              <CommandItem key={item.to} value={`${item.label} ${item.description}`} onSelect={() => go(item.to)}>
                <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Quick actions">
            {quickTargets.map((item) => (
              <CommandItem key={item.to} value={`${item.label} ${item.description}`} onSelect={() => go(item.to)}>
                <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                </div>
                {item.label === "Open chat" && <CommandShortcut>Enter</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Notes">
            {noteTargets.map((item) => (
              <CommandItem key={item.key} value={`${item.label} ${item.description} ${item.keywords}`} onSelect={() => go(item.to)}>
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.description}</div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
