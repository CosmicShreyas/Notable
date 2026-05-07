import { Mic, Square, ChevronUp, ListChecks, Sparkles, Bot, UserRound, Copy, Pause, Play } from "lucide-react";
import { Waveform } from "./Waveform";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useFolders, FOLDER_COLORS } from "./FoldersProvider";
import {
  getGlobalChatHistory,
  parseApiDate,
  streamGlobalChat,
  type ChatExecutedAction,
} from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";
import { getVibgyorVoiceType, type VibgyorVoiceTypeInstance } from "../lib/vibgyor-voicetype";

type AskBarMessage = {
  role: "user" | "ai";
  text: string;
  time?: string;
};

export type AskBarAssistantContext = {
  page_type?: string;
  meeting_id?: string;
  meeting_title?: string;
  folder_id?: string;
  folder_name?: string;
  meeting_code?: string;
  visible_month?: string;
};

export function AskBar({
  recording = false,
  audioLevel = 0,
  onToggleRecord,
  onListRecentTodos,
  onSubmitMessage,
  showRecordingBadge = true,
  stayOnPage = false,
  showRecorder = false,
  recordingPaused = false,
  onTogglePauseRecording,
  variant = "floating",
  containerClassName = "",
  value,
  onValueChange,
  placeholder,
  assistantContext,
  onExecutedActions,
}: {
  recording?: boolean;
  audioLevel?: number;
  onToggleRecord?: () => void;
  onListRecentTodos?: () => void;
  onSubmitMessage?: (message: string) => void;
  showRecordingBadge?: boolean;
  stayOnPage?: boolean;
  showRecorder?: boolean;
  recordingPaused?: boolean;
  onTogglePauseRecording?: () => void;
  variant?: "floating" | "chat-hero";
  containerClassName?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  assistantContext?: AskBarAssistantContext;
  onExecutedActions?: (actions: ChatExecutedAction[]) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [internalMessage, setInternalMessage] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupRendered, setPopupRendered] = useState(false);
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupStreaming, setPopupStreaming] = useState(false);
  const [popupMessages, setPopupMessages] = useState<AskBarMessage[]>([]);
  const [voiceTypingActive, setVoiceTypingActive] = useState(false);
  const [voiceTypingSupported, setVoiceTypingSupported] = useState(true);
  const popupBottomRef = useRef<HTMLDivElement | null>(null);
  const popupAnimationTimeoutRef = useRef<number | null>(null);
  const voiceTypeRef = useRef<VibgyorVoiceTypeInstance | null>(null);
  const voicePrefixRef = useRef("");
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { folders, createFolder, removeFolder, addNoteToFolder, removeNoteFromFolder } = useFolders();
  const message = value ?? internalMessage;
  const isChatPage = location.pathname === "/chat";

  const setMessage = (nextValue: string) => {
    if (onValueChange) {
      onValueChange(nextValue);
      return;
    }
    setInternalMessage(nextValue);
  };

  useEffect(() => {
    const VoiceType = typeof window !== "undefined" ? getVibgyorVoiceType() : undefined;
    setVoiceTypingSupported(Boolean(VoiceType?.isSupported?.()));
  }, []);

  useEffect(() => {
    if (!recording) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      voiceTypeRef.current?.abort();
      voiceTypeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (popupAnimationTimeoutRef.current) {
      window.clearTimeout(popupAnimationTimeoutRef.current);
      popupAnimationTimeoutRef.current = null;
    }

    if (popupOpen) {
      setPopupRendered(true);
      return;
    }

    if (!popupRendered) return;

    popupAnimationTimeoutRef.current = window.setTimeout(() => {
      setPopupRendered(false);
    }, 220);

    return () => {
      if (popupAnimationTimeoutRef.current) {
        window.clearTimeout(popupAnimationTimeoutRef.current);
        popupAnimationTimeoutRef.current = null;
      }
    };
  }, [popupOpen, popupRendered]);

  useEffect(() => {
    if (!popupOpen || isChatPage || stayOnPage) return;
    if (popupMessages.length > 0 || popupStreaming) return;
    let active = true;
    setPopupLoading(true);
    void getGlobalChatHistory()
      .then((history) => {
        if (!active) return;
        setPopupMessages(
          history.messages.map((item) => ({
            role: item.role === "assistant" ? "ai" : "user",
            text: item.content,
            time: formatTime(item.created_at),
          })),
        );
      })
      .finally(() => {
        if (active) {
          setPopupLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [popupOpen, isChatPage, stayOnPage, popupMessages.length, popupStreaming]);

  useEffect(() => {
    if (!popupOpen || isChatPage || stayOnPage) return;

    const behavior: ScrollBehavior = popupLoading ? "auto" : "smooth";
    const frameId = window.requestAnimationFrame(() => {
      popupBottomRef.current?.scrollIntoView({ behavior, block: "end" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [popupMessages, popupLoading, popupOpen, isChatPage, stayOnPage]);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

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

      if ((action.action_type === "delete_folder" || action.action_type === "delete_current_folder") && (folderName || payload.folder_id)) {
        const existing = folders.find(
          (folder) =>
            (payload.folder_id && folder.id === payload.folder_id) ||
            (folderName && normalizeFolderName(folder.name) === normalizeFolderName(folderName)),
        );
        if (existing) {
          removeFolder(existing.id);
        }
        if (action.action_type === "delete_current_folder") {
          void navigate({ to: "/" });
        }
        continue;
      }

      if (action.action_type === "add_current_note_to_folder" && folderName) {
        const noteId = typeof payload.meeting_id === "string" ? payload.meeting_id : null;
        const title = typeof payload.title === "string" ? payload.title : "Untitled meeting";
        if (!noteId) continue;
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (existing) {
          addNoteToFolder(existing.id, { id: noteId, title });
        } else {
          const folderId = createFolder(folderName, folderColor);
          addNoteToFolder(folderId, { id: noteId, title });
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
        continue;
      }

      if (action.action_type === "delete_current_note") {
        void navigate({ to: "/" });
      }
    }

    onExecutedActions?.(actions);
  };

  const streamGlobalAssistantMessage = async (text: string) => {
    const now = formatTime(new Date().toISOString());
    setPopupRendered(true);
    setPopupOpen(true);
    setPopupStreaming(true);
    setPopupMessages((current) => [
      ...current,
      { role: "user", text, time: now },
      { role: "ai", text: "", time: now },
    ]);

    try {
      await streamGlobalChat(
        {
          message: text,
          include_memory: true,
          client_context: assistantContext ?? null,
        },
        {
          onChunk: (data) => {
            setPopupMessages((current) => {
              const next = [...current];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (!last || last.role !== "ai") return current;
              next[lastIndex] = { ...last, text: `${last.text}${data.text ?? ""}` };
              return next;
            });
          },
          onDone: (data) => {
            applyExecutedActions((data?.executed_actions ?? []) as ChatExecutedAction[]);
            setPopupStreaming(false);
          },
          onError: (data) => {
            setPopupStreaming(false);
            setPopupMessages((current) => {
              const next = [...current];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (!last || last.role !== "ai") return current;
              next[lastIndex] = { ...last, text: data?.message || "Streaming error" };
              return next;
            });
          },
        },
      );
    } catch (error) {
      setPopupStreaming(false);
      setPopupMessages((current) => {
        const next = [...current];
        const lastIndex = next.length - 1;
        const last = next[lastIndex];
        if (!last || last.role !== "ai") return current;
        next[lastIndex] = {
          ...last,
          text: error instanceof Error ? error.message : "Chat failed",
        };
        return next;
      });
    }
  };

  const submitMessage = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (isChatPage || stayOnPage) {
      onSubmitMessage?.(trimmed);
      setMessage("");
      return;
    }

    setMessage("");
    void streamGlobalAssistantMessage(trimmed);
  };

  const submitRecentTodos = () => {
    const prompt = "List recent todos";

    if (isChatPage || stayOnPage) {
      onListRecentTodos?.();
      setMessage("");
      return;
    }

    setMessage("");
    void streamGlobalAssistantMessage(prompt);
  };

  const toggleVoiceTyping = async () => {
    const VoiceType = getVibgyorVoiceType();
    if (!VoiceType?.isSupported?.()) {
      setVoiceTypingSupported(false);
      return;
    }

    if (voiceTypeRef.current?.isActive()) {
      voiceTypeRef.current.stop();
      return;
    }

    voicePrefixRef.current = message.trim() ? `${message.trim()} ` : "";
    voiceTypeRef.current?.abort();
    voiceTypeRef.current = new VoiceType({
      language: typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US",
      continuous: true,
      interimResults: true,
      onStart: () => {
        setVoiceTypingActive(true);
      },
      onTranscript: (data) => {
        setMessage(`${voicePrefixRef.current}${data.combined}`.trim());
      },
      onEnd: () => {
        setVoiceTypingActive(false);
      },
      onError: (error) => {
        if (error.type === "not-supported") {
          setVoiceTypingSupported(false);
        }
        setVoiceTypingActive(false);
      },
    });

    try {
      await voiceTypeRef.current.start();
    } catch {
      setVoiceTypingActive(false);
    }
  };

  if (variant === "chat-hero") {
    return (
      <div className="w-full animate-askbar-rise">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage(message);
          }}
          className="mx-auto flex w-full max-w-3xl items-center gap-2"
        >
          <div className="relative flex flex-1 flex-col gap-3 rounded-2xl border border-border bg-popover/95 px-4 py-4 shadow-[var(--shadow-elevated)] backdrop-blur sm:flex-row sm:items-center sm:px-6 sm:py-5">
            <Sparkles className="hidden h-5 w-5 text-muted-foreground sm:block" />
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={placeholder ?? "Ask anything about your notes..."}
              className="w-full flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {voiceTypingSupported && (
              <button
                type="button"
                onClick={() => void toggleVoiceTyping()}
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition ${
                  voiceTypingActive
                    ? "border-red-500/50 bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.12)]"
                    : "border-border bg-foreground/5 text-foreground/75 hover:bg-foreground/10"
                }`}
                aria-label={voiceTypingActive ? "Stop voice typing" : "Start voice typing"}
                title={voiceTypingActive ? "Stop voice typing" : "Start voice typing"}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={submitRecentTodos}
              className="hidden w-full items-center justify-center gap-1.5 rounded-full bg-foreground/10 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/20 sm:ml-2 sm:flex sm:w-auto sm:py-1.5"
            >
              <ListChecks className="h-3.5 w-3.5" />
              List recent todos
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <>
      {popupRendered && !isChatPage && !stayOnPage && (
        <div
          className={`pointer-events-none fixed bottom-20 left-0 right-0 z-20 px-4 sm:bottom-24 ${containerClassName}`}
        >
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3">
            <div
              className={`pointer-events-auto w-full overflow-hidden rounded-[1.5rem] border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur ${
                popupOpen ? "animate-panel-pop-in" : "animate-panel-pop-out"
              }`}
            >
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-foreground/80">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground/90">Chat</div>
                    <div className="text-xs text-muted-foreground">
                      Ask from here without leaving the page.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setPopupOpen(false)}
                  className="rounded-full p-2 text-foreground/60 transition hover:bg-accent"
                  aria-label="Close chat panel"
                >
                  <ChevronUp className="h-4 w-4 rotate-180" />
                </button>
              </div>

              <div className="max-h-[22rem] space-y-4 overflow-y-auto px-4 py-4 scrollbar-hide sm:max-h-[24rem] sm:px-5">
                {popupLoading ? (
                  <div className="rounded-[1.5rem] border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                    <span className="loading-shimmer-text">Loading your global chat...</span>
                  </div>
                ) : popupMessages.length ? (
                  popupMessages.map((item, index) => (
                    <PopupMessage key={`${item.time}-${index}-${item.role}`} message={item} />
                  ))
                ) : (
                  <div className="rounded-[1.5rem] border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                    Ask anything here. The assistant keeps the global chat context and can also use this page as a hint for commands like <span className="font-medium text-foreground/80">delete this folder</span>.
                  </div>
                )}
                {popupStreaming && !popupMessages.length && (
                  <div className="rounded-[1.5rem] border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                    <span className="loading-shimmer-text">Thinking...</span>
                  </div>
                )}
                <div ref={popupBottomRef} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className={`pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-0 right-0 z-30 flex justify-center px-4 ${containerClassName}`}
      >
        <div className="pointer-events-auto flex w-full max-w-2xl items-center gap-2">
          {showRecorder && recording && onTogglePauseRecording && (
            <button
              type="button"
              onClick={onTogglePauseRecording}
              className={`flex shrink-0 items-center justify-center rounded-full border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur transition hover:bg-accent ${
                isMobile ? "h-[3.25rem] w-[3.25rem]" : "px-3 py-2"
              } text-sm ${recordingPaused ? "text-amber-500" : "text-foreground/80"}`}
              aria-label={recordingPaused ? "Resume recording" : "Pause recording"}
              title={recordingPaused ? "Resume recording" : "Pause recording"}
            >
              {recordingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </button>
          )}

          {showRecorder && (
            <button
              onClick={onToggleRecord}
              className={`flex shrink-0 items-center justify-center rounded-full border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur transition hover:bg-accent ${
                isMobile
                  ? recording
                    ? "min-w-[7.5rem] gap-2 px-3 py-3"
                    : "h-[3.25rem] w-[3.25rem] px-0 py-0"
                  : "gap-2 px-3 py-2"
              } text-sm ${
                recording ? "text-foreground" : "text-foreground/80"
              }`}
              aria-label={recording ? "Stop recording and summarize" : "Start recording"}
            >
              {recording ? (
                <>
                  <span className="relative flex h-2 w-2">
                    {!recordingPaused && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-60" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${recordingPaused ? "bg-amber-500" : "bg-foreground"}`} />
                  </span>
                  {recordingPaused ? (
                    <span className={`${isMobile ? "w-12 text-center text-[11px]" : "w-20 text-xs"} text-foreground/70`}>
                      Paused
                    </span>
                  ) : (
                    <div className={isMobile ? "w-12" : "w-20"}>
                      <Waveform bars={isMobile ? 8 : 14} height={isMobile ? 18 : 20} level={audioLevel} />
                    </div>
                  )}
                  <Square className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  {!isMobile && <ChevronUp className="h-3.5 w-3.5 opacity-60" />}
                </>
              )}
            </button>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitMessage(message);
            }}
            className={`relative flex min-w-0 flex-1 items-center rounded-full border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur ${
              isMobile ? "gap-2 px-4 py-3" : "gap-3 px-5 py-3"
            }`}
          >
            <Sparkles className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={placeholder ?? (isMobile ? "Ask anything about this page" : "Ask anything")}
              className="min-w-0 w-full flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            {voiceTypingSupported && (
              <button
                type="button"
                onClick={() => void toggleVoiceTyping()}
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                  voiceTypingActive
                    ? "border-red-500/50 bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.12)]"
                    : "border-border bg-foreground/5 text-foreground/75 hover:bg-foreground/10"
                }`}
                aria-label={voiceTypingActive ? "Stop voice typing" : "Start voice typing"}
                title={voiceTypingActive ? "Stop voice typing" : "Start voice typing"}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={submitRecentTodos}
              className="hidden w-full items-center justify-center gap-1.5 rounded-full bg-foreground/10 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/20 sm:ml-2 sm:flex sm:w-auto sm:py-1.5"
            >
              <ListChecks className="h-3.5 w-3.5" />
              List recent todos
            </button>
          </form>
        </div>

        {recording && showRecordingBadge && (
          <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-3 py-1 text-[11px] font-medium tabular-nums text-background shadow-md">
            Recording {mm}:{ss}
          </div>
        )}
      </div>
    </>
  );
}

function PopupMessage({ message }: { message: AskBarMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-end gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
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
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(message.text)}
            className="ml-auto rounded p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
            aria-label="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="text-[14px] leading-[1.55rem]">
          {message.text ? (
            <MarkdownRenderer
              markdown={message.text}
              className={isUser ? "markdown-chat markdown-chat-user" : "markdown-chat"}
            />
          ) : (
            <span className="loading-shimmer-text text-muted-foreground">Thinking...</span>
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

function formatTime(value: string) {
  return parseApiDate(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
