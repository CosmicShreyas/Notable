import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "../components/Sidebar";
import { AskBar } from "../components/AskBar";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { FOLDER_COLORS, useFolders } from "../components/FoldersProvider";
import {
  type ChatExecutedAction,
  getCachedMeetings,
  getGlobalChatHistory,
  getMeeting,
  listMeetings,
  streamGlobalChat,
  streamMeetingChat,
  type Meeting,
} from "../lib/api";
import { consumePendingChatDraft } from "../lib/chat-draft";
import { useRequireAuth } from "../hooks/use-require-auth";
import {
  MessageSquare,
  History,
  ChevronDown,
  Clock3,
  Bot,
  UserRound,
  Copy,
  Pencil,
} from "lucide-react";

type Msg = {
  role: "user" | "ai";
  text: string;
  time?: string;
  pending?: boolean;
};

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat - Notable" },
      { name: "description", content: "Ask Notable AI about your notes and meetings." },
      { property: "og:title", content: "Chat - Notable" },
      { property: "og:description", content: "Ask Notable AI about your notes and meetings." },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { loading: authLoading } = useRequireAuth();
  const { folders, createFolder, removeFolder, addNoteToFolder, removeNoteFromFolder } = useFolders();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[]>(() => getCachedMeetings());
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamStarted, setStreamStarted] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const pendingDraftRef = useRef<string | null>(null);

  useEffect(() => {
    const draft = consumePendingChatDraft();
    pendingDraftRef.current = draft?.text ?? null;
  }, []);

  useEffect(() => {
    if (authLoading) return;

    let active = true;
    void Promise.all([listMeetings(), getGlobalChatHistory()])
      .then(([meetingData, globalHistory]) => {
        if (!active) return;
        setMeetings(meetingData.items);
        setSelectedMeetingId(null);
        setMessages(mapGlobalMessages(globalHistory.messages));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading]);

  useEffect(() => {
    if (!pendingDraftRef.current || loading) return;
    const draft = pendingDraftRef.current;
    pendingDraftRef.current = null;
    void handleSubmitMessage(draft);
  }, [loading, selectedMeetingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.id === selectedMeetingId) ?? null,
    [meetings, selectedMeetingId],
  );

  const applyExecutedActions = (actions: ChatExecutedAction[]) => {
    for (const action of actions) {
      if (action.status !== "success") continue;
      const payload = action.payload ?? {};
      const folderName = typeof payload.folder_name === "string" ? payload.folder_name.trim() : "";
      const folderColor = resolveFolderColor(typeof payload.folder_color === "string" ? payload.folder_color : undefined);

      if (action.action_type === "create_folder" && folderName) {
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (!existing) {
          createFolder(folderName, folderColor);
        }
        continue;
      }

      if (action.action_type === "delete_folder" && folderName) {
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (existing) {
          removeFolder(existing.id);
        }
        continue;
      }

      if (action.action_type === "add_current_note_to_folder" && folderName) {
        const noteId = typeof payload.meeting_id === "string" ? payload.meeting_id : null;
        const title = typeof payload.title === "string" ? payload.title : "Untitled meeting";
        if (!noteId) continue;
        let existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (!existing) {
          const folderId = createFolder(folderName, folderColor);
          addNoteToFolder(folderId, { id: noteId, title });
        } else {
          addNoteToFolder(existing.id, { id: noteId, title });
        }
        continue;
      }

      if (action.action_type === "remove_current_note_from_folder" && folderName) {
        const noteId = typeof payload.meeting_id === "string" ? payload.meeting_id : null;
        if (!noteId) continue;
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (existing) {
          removeNoteFromFolder(existing.id, noteId);
        }
      }
    }
  };

  const loadMeetingThread = async (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    const detail = await getMeeting(meetingId);
    setMessages(mapMeetingMessages(detail));
    setHistoryOpen(false);
  };

  const handleListRecentTodos = async () => {
    await handleSubmitMessage("List recent todos");
  };

  const handleSubmitMessage = async (text: string) => {
    const now = formatTime(new Date().toISOString());
    const activeMeetingId = selectedMeetingId;

    setStreaming(true);
    setStreamStarted(false);
    setMessages((current) => [
      ...current,
      {
        role: "user",
        time: now,
        text,
      },
      {
        role: "ai",
        time: now,
        text: "",
      },
    ]);

    try {
      const handleDone = async (data: any) => {
        applyExecutedActions((data?.executed_actions ?? []) as ChatExecutedAction[]);
        setStreaming(false);
        setStreamStarted(false);
        if (activeMeetingId) {
          const detail = await getMeeting(activeMeetingId);
          setMessages(mapMeetingMessages(detail));
          setMeetings((current) =>
            current.map((meeting) =>
              meeting.id === activeMeetingId ? { ...meeting, updated_at: new Date().toISOString() } : meeting,
            ),
          );
        }
      };

      const handlers = {
        onStart: () => {
          setStreamStarted(true);
        },
        onChunk: (data: any) => {
          setStreamStarted(true);
          setMessages((current) => {
            const next = [...current];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (!last || last.role !== "ai") return current;
            next[lastIndex] = { ...last, text: `${last.text}${data.text ?? ""}`, pending: false };
            return next;
          });
        },
        onError: (data: any) => {
          setMessages((current) => {
            const next = [...current];
            const lastIndex = next.length - 1;
            const last = next[lastIndex];
            if (!last || last.role !== "ai") return current;
            next[lastIndex] = {
              ...last,
              text: data?.message || "Streaming error",
              pending: false,
            };
            return next;
          });
        },
        onDone: handleDone,
      };

      if (activeMeetingId) {
        await streamMeetingChat(activeMeetingId, { message: text, include_memory: true }, handlers);
      } else {
        await streamGlobalChat({ message: text, include_memory: true }, handlers);
      }
    } catch (error) {
      setStreaming(false);
      setStreamStarted(false);
      setMessages((current) => {
        const next = [...current];
        const lastIndex = next.length - 1;
        const last = next[lastIndex];
        if (last && last.role === "ai" && !last.text) {
          next[lastIndex] = {
            ...last,
            text: error instanceof Error ? error.message : "Chat failed",
            pending: false,
          };
          return next;
        }
        return [
          ...current,
          {
            role: "ai",
            time: now,
            text: error instanceof Error ? error.message : "Chat failed",
          },
        ];
      });
    }
  };

  const handleCopyMessage = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  const handleEditMessage = (text: string) => {
    setDraftMessage(text);
    footerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="relative flex flex-1 flex-col overflow-hidden pt-16 md:pt-0">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.05),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.03),transparent_30%)]"
        />
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 pt-6 sm:px-6 sm:pt-10">
          <header className="relative z-30 flex items-start justify-between gap-4 animate-fade-in-up">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card/70 text-foreground/70 shadow-[var(--shadow-soft)] backdrop-blur">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-serif-display text-4xl text-foreground/90 sm:text-5xl">Chat</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedMeeting ? `Asking about ${selectedMeeting.title}` : "Global chat across all your meetings."}
                </p>
              </div>
            </div>

            <div className="relative">
              <button
                onClick={() => setHistoryOpen((value) => !value)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-2 text-sm font-medium text-foreground/80 shadow-[var(--shadow-soft)] backdrop-blur transition hover:bg-accent"
                aria-label="Open thread history"
              >
                <History className="h-4 w-4" />
                History
                <ChevronDown className={`h-4 w-4 transition ${historyOpen ? "rotate-180" : ""}`} />
              </button>

              {historyOpen && (
                <div className="absolute right-0 top-[calc(100%+0.75rem)] z-40 max-h-[min(24rem,calc(100vh-10rem))] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover/95 p-2 shadow-[var(--shadow-elevated)] backdrop-blur">
                  <div className="px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Recent threads
                  </div>
                  <div className="space-y-1 overflow-y-auto pr-1 scrollbar-hide">
                    <button
                      onClick={() => void (async () => {
                        setSelectedMeetingId(null);
                        const history = await getGlobalChatHistory();
                        setMessages(mapGlobalMessages(history.messages));
                        setHistoryOpen(false);
                      })()}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground/70">
                        <Bot className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">Global chat</div>
                        <div className="truncate text-xs text-muted-foreground">Searches across all meetings</div>
                      </div>
                    </button>
                    {meetings.length ? (
                      meetings.map((thread) => (
                        <button
                          key={thread.id}
                          onClick={() => void loadMeetingThread(thread.id)}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-accent"
                        >
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground/[0.06] text-foreground/70">
                            <Clock3 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{thread.title}</div>
                            <div className="truncate text-xs text-muted-foreground">{formatThreadTime(thread.created_at)}</div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No meeting threads yet.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </header>

          <div className="relative z-0 mt-8 flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-hide">
            <div className="space-y-4 pb-8 pt-1 sm:space-y-5">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
                  <span className="loading-shimmer-text">Loading your AI threads...</span>
                </div>
              ) : messages.length ? (
                messages.map((message, index) => (
                  <ChatBubble
                    key={`${message.role}-${index}`}
                    message={message}
                    onCopy={() => void handleCopyMessage(message.text)}
                    onEdit={message.role === "user" ? () => handleEditMessage(message.text) : undefined}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-12 text-center text-sm text-muted-foreground">
                  Ask your first question and Notable will stream the answer here.
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <footer ref={footerRef} className="shrink-0 pb-4 pt-2 sm:pb-6">
            <AskBar
              variant="chat-hero"
              onListRecentTodos={() => void handleListRecentTodos()}
              onSubmitMessage={(text) => void handleSubmitMessage(text)}
              value={draftMessage}
              onValueChange={setDraftMessage}
            />
          </footer>
        </div>
      </main>
    </div>
  );
}

function normalizeFolderName(value: string) {
  return value.trim().toLowerCase();
}

function resolveFolderColor(rawColor?: string) {
  if (!rawColor) return undefined;
  const normalized = rawColor.trim().toLowerCase();
  const palette: Record<string, string> = {
    red: FOLDER_COLORS[0],
    orange: FOLDER_COLORS[1],
    yellow: FOLDER_COLORS[2],
    green: FOLDER_COLORS[3],
    cyan: FOLDER_COLORS[4],
    teal: FOLDER_COLORS[4],
    blue: FOLDER_COLORS[5],
    violet: FOLDER_COLORS[6],
    purple: FOLDER_COLORS[6],
    pink: FOLDER_COLORS[7],
  };
  if (palette[normalized]) return palette[normalized];
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  return undefined;
}

function ChatBubble({
  message,
  onCopy,
  onEdit,
}: {
  message: Msg;
  onCopy: () => void;
  onEdit?: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-end gap-3 ${isUser ? "justify-end" : "justify-start"} animate-note-message-enter`}>
      {!isUser && (
        <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-foreground/70 shadow-[var(--shadow-soft)]">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={`max-w-[min(28rem,76%)] rounded-[1.05rem] px-3 py-2.5 text-sm shadow-[var(--shadow-soft)] ${
          isUser
            ? "rounded-br-md bg-foreground text-background"
            : "rounded-bl-md border border-border bg-card/60 text-foreground backdrop-blur"
        }`}
      >
        <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] opacity-70">
          <span>{isUser ? "You" : "Notable"}</span>
          {message.time && <span>{message.time}</span>}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onCopy}
              className="rounded p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
              aria-label="Copy message"
              title="Copy"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
                aria-label="Edit message"
                title="Edit and resend"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="text-[14px] leading-[1.55rem]">
          {message.text ? (
            <MarkdownRenderer
              markdown={message.text}
              className={isUser ? "markdown-chat markdown-chat-user" : "markdown-chat"}
            />
          ) : (
            <LoadingThinkingLabel />
          )}
        </div>
      </div>

      {isUser && (
        <div className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-card/70 text-foreground/70 shadow-[var(--shadow-soft)]">
          <UserRound className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

function LoadingThinkingLabel() {
  return (
    <span className="thinking-label text-muted-foreground">
      <span className="loading-shimmer-text">Thinking</span>
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}

function mapMeetingMessages(meeting: Meeting): Msg[] {
  return (meeting.chat_messages ?? []).map((message) => ({
    role: message.role === "assistant" ? "ai" : "user",
    text: message.content,
    time: formatTime(message.created_at),
  }));
}

function mapGlobalMessages(
  messages: {
    role: string;
    content: string;
    created_at: string;
  }[],
): Msg[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "ai" : "user",
    text: message.content,
    time: formatTime(message.created_at),
  }));
}

function formatTime(value: string) {
  return parseApiDate(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatThreadTime(value: string) {
  return parseApiDate(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
}

function parseApiDate(value: string) {
  const normalized =
    /z$/i.test(value) || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  return new Date(normalized);
}
