import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Home as HomeIcon,
  Calendar,
  Users,
  FolderPlus,
  UserPen,
  Square,
  Sparkles,
  ChevronUp,
  Copy,
  Share2,
  FileText,
  Bot,
  UserRound,
  X,
  Pencil,
  Check,
  Play,
  Pause,
  Flame,
  ListVideo,
  RefreshCcw,
  ExternalLink,
  KanbanSquare,
  Download,
} from "lucide-react";
import { AskBar } from "../components/AskBar";
import { CommentsThread } from "../components/CommentsThread";
import { FolderDialog } from "../components/FolderDialog";
import { FOLDER_COLORS, useFolders } from "../components/FoldersProvider";
import { MeetingShareDialog } from "../components/MeetingShareDialog";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { useSettings } from "../components/SettingsProvider";
import { useIsMobile } from "../hooks/use-mobile";
import { useRequireAuth } from "../hooks/use-require-auth";
import {
  buildTranscriptionWebSocketUrl,
  type ChatExecutedAction,
  createMeeting,
  deleteMeeting,
  discardTranscriptSession,
  exportMeeting,
  finalizeRecordingTranscript,
  getMeeting,
  getMeetingRecordingBlob,
  listTeams,
  parseApiDate,
  syncCachedMeeting,
  syncMeetingActionItems,
  storeTranscriptTextChunk,
  streamMeetingChat,
  streamMeetingSummary,
  updateMeeting,
  getTaskSyncConnections,
  listSpeakerIdentities,
  renameMeetingSpeaker,
  type TaskSyncConnectionsStatus,
  type ActionItemSyncResponse,
  type Meeting,
  type SpeakerIdentity,
} from "../lib/api";
import { triggerFileDownload } from "../lib/download";
import { GUIDE_NOTE_ID, GUIDE_NOTE_MARKDOWN, GUIDE_NOTE_TITLE } from "../lib/get-started-note";

export const Route = createFileRoute("/notes/$noteId")({
  component: NoteDetail,
});

let pendingNewMeetingPromise: Promise<Meeting> | null = null;

type PanelMode = "assistant" | "transcript" | null;
type TranscriptLine = {
  speaker: string;
  text: string;
  time: string;
};
type PlaybackChapter = NonNullable<Meeting["playback"]>["chapters"][number];
type PlaybackHighlight = NonNullable<Meeting["playback"]>["highlights"][number];
type AssistantMessage = {
  role: "user" | "assistant";
  text: string;
  time: string;
  pending?: boolean;
};

type MentionableTeammate = {
  id: string;
  email: string;
  full_name?: string | null;
};

const LANGUAGE_OPTIONS = [
  {
    value: "en",
    label: "Mostly English",
    description: "Best when the meeting is primarily English, even with a few Hindi words mixed in.",
  },
  {
    value: "hi",
    label: "Mostly Hindi + English",
    description: "Best when people mainly speak Hindi but naturally drop English words into the conversation.",
  },
] as const;

type SummaryTemplateKey = "office_meeting" | "standup" | "sales_call" | "interview" | "client_review";

type SummaryTemplateDefinition = {
  key: SummaryTemplateKey;
  name: string;
  shortDescription: string;
  sections: string[];
  actionStyle: string;
  noteSections: string[];
  previewSummary: string;
};

const SUMMARY_TEMPLATES: SummaryTemplateDefinition[] = [
  {
    key: "office_meeting",
    name: "Office meeting",
    shortDescription: "Balanced internal recap for everyday work, decisions, risks, and follow-ups.",
    sections: ["Overview", "Key Points", "Decisions", "Risks", "Action Items", "Follow-up"],
    actionStyle: "Clear owner-ready bullets that move work forward after the meeting.",
    noteSections: ["Context", "Discussion notes", "Decisions", "Risks", "Follow-up questions"],
    previewSummary: [
      "## Overview",
      "A concise executive snapshot of the meeting and why it mattered.",
      "",
      "## Key Points",
      "- Main discussion themes",
      "- Important clarifications",
      "",
      "## Decisions",
      "- What the team agreed to",
      "",
      "## Risks",
      "- Open concerns or blockers",
      "",
      "## Action Items",
      "- Owner-ready next steps",
      "",
      "## Follow-up",
      "Any items that need another check-in.",
    ].join("\n"),
  },
  {
    key: "standup",
    name: "Standup",
    shortDescription: "Fast daily structure focused on progress, plan, blockers, and dependencies.",
    sections: ["Yesterday", "Today", "Blockers", "Dependencies", "Action Items"],
    actionStyle: "Short operational next steps tied to today or the next immediate handoff.",
    noteSections: ["Yesterday", "Today", "Blockers", "Dependencies"],
    previewSummary: [
      "## Yesterday",
      "- Completed work and progress made",
      "",
      "## Today",
      "- Planned work for the day",
      "",
      "## Blockers",
      "- Anything slowing progress",
      "",
      "## Dependencies",
      "- Inputs needed from others",
      "",
      "## Action Items",
      "- Immediate follow-through",
    ].join("\n"),
  },
  {
    key: "sales_call",
    name: "Sales call",
    shortDescription: "Sales-friendly structure for prospect needs, buying signals, objections, and next steps.",
    sections: ["Prospect Context", "Pain Points", "Buying Signals", "Objections", "Next Steps", "Action Items"],
    actionStyle: "CRM-style follow-ups with a clear commercial next move.",
    noteSections: ["Prospect context", "Pain points", "Buying signals", "Objections", "Next steps"],
    previewSummary: [
      "## Prospect Context",
      "Who the buyer is, what stage they are in, and the broader opportunity.",
      "",
      "## Pain Points",
      "- Problems they are trying to solve",
      "",
      "## Buying Signals",
      "- Positive interest signals or urgency cues",
      "",
      "## Objections",
      "- Concerns, pricing pressure, or procurement friction",
      "",
      "## Next Steps",
      "What needs to happen to advance the deal.",
      "",
      "## Action Items",
      "- Owner-tagged sales follow-ups",
    ].join("\n"),
  },
  {
    key: "interview",
    name: "Interview",
    shortDescription: "Structured candidate evaluation with strengths, concerns, evidence, and recommendation.",
    sections: ["Candidate Snapshot", "Strengths", "Concerns", "Evidence", "Recommendation", "Action Items"],
    actionStyle: "Hiring-oriented follow-ups like scorecards, debriefs, and next-round actions.",
    noteSections: ["Candidate snapshot", "Strengths", "Concerns", "Evidence", "Recommendation"],
    previewSummary: [
      "## Candidate Snapshot",
      "Role context and overall impression.",
      "",
      "## Strengths",
      "- Capabilities or behaviors that stood out",
      "",
      "## Concerns",
      "- Risks, gaps, or weak signals",
      "",
      "## Evidence",
      "- Concrete examples from the conversation",
      "",
      "## Recommendation",
      "A grounded recommendation based on the evidence.",
      "",
      "## Action Items",
      "- Debrief and hiring follow-up steps",
    ].join("\n"),
  },
  {
    key: "client_review",
    name: "Client review",
    shortDescription: "Relationship-focused summary for goals, client requests, commitments, and risks.",
    sections: ["Goals", "What Went Well", "Risks", "Client Requests", "Commitments", "Next Steps", "Action Items"],
    actionStyle: "Accountable client follow-through and promise tracking.",
    noteSections: ["Goals", "Wins", "Risks", "Client requests", "Commitments", "Next steps"],
    previewSummary: [
      "## Goals",
      "What the client was trying to achieve in this review.",
      "",
      "## What Went Well",
      "- Positive progress and delivered value",
      "",
      "## Risks",
      "- Gaps, concerns, or timeline pressure",
      "",
      "## Client Requests",
      "- Explicit asks from the client",
      "",
      "## Commitments",
      "- What the team promised back",
      "",
      "## Next Steps",
      "The next relationship or project milestones.",
      "",
      "## Action Items",
      "- Follow-through with clear accountability",
    ].join("\n"),
  },
] as const;

function getSummaryTemplate(templateKey?: string | null) {
  return SUMMARY_TEMPLATES.find((template) => template.key === templateKey) ?? SUMMARY_TEMPLATES[0];
}

function buildTemplateNotesMarkdown(templateKey: SummaryTemplateKey) {
  const template = getSummaryTemplate(templateKey);
  return template.noteSections.map((section) => `## ${section}\n- `).join("\n\n");
}

function NoteDetail() {
  const { loading: authLoading } = useRequireAuth();
  const isMobile = useIsMobile();
  const { folders, createFolder, removeFolder, addNoteToFolder, removeNoteFromFolder } = useFolders();
  const { liveIndicator, showConsentNudge, summaryStyle, transcriptionLanguage, linkSharing } = useSettings();
  const navigate = useNavigate();
  const { noteId } = Route.useParams();
  const isGuideNote = noteId === GUIDE_NOTE_ID;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [visiblePanelMode, setVisiblePanelMode] = useState<PanelMode>(null);
  const [panelSurfaceOpen, setPanelSurfaceOpen] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [activeView, setActiveView] = useState<"notes" | "summary">("notes");
  const [folderOpen, setFolderOpen] = useState(false);
  const [speakerDialogOpen, setSpeakerDialogOpen] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [templateChooserOpen, setTemplateChooserOpen] = useState(false);
  const [templatePreviewOpen, setTemplatePreviewOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [transcribingRecording, setTranscribingRecording] = useState(false);
  const [summaryContent, setSummaryContent] = useState("");
  const [typedSummary, setTypedSummary] = useState("");
  const [taskSyncConnections, setTaskSyncConnections] = useState<TaskSyncConnectionsStatus | null>(null);
  const [syncingProvider, setSyncingProvider] = useState<"jira" | "asana" | "linear" | null>(null);
  const [syncResult, setSyncResult] = useState<ActionItemSyncResponse | null>(null);
  const [speakerIdentities, setSpeakerIdentities] = useState<SpeakerIdentity[]>([]);
  const [speakerTargetLabel, setSpeakerTargetLabel] = useState<string | null>(null);
  const [speakerNameDraft, setSpeakerNameDraft] = useState("");
  const [rememberSpeakerIdentity, setRememberSpeakerIdentity] = useState(true);
  const [savingSpeaker, setSavingSpeaker] = useState(false);
  const [summaryTemplateKey, setSummaryTemplateKey] = useState<SummaryTemplateKey>("office_meeting");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingReady, setRecordingReady] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"pdf" | "docx" | "markdown" | null>(null);
  const [mentionableTeammates, setMentionableTeammates] = useState<MentionableTeammate[]>([]);
  const assistantScrollRef = useRef<HTMLDivElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef(false);
  const recordingPausedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(16000);
  const meetingIdRef = useRef<string | null>(null);
  const summaryBufferRef = useRef("");
  const lastSavedNotesRef = useRef<string | null>(null);
  const recordingSessionStartedAtRef = useRef<string | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const sendIntervalRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const sendInFlightRef = useRef(false);
  const sentChunkCountRef = useRef(0);
  const sentSamplesRef = useRef(0);
  const panelAnimationTimeoutRef = useRef<number | null>(null);

  const displayTitle =
    meeting?.title ||
    (noteId === "new" ? "New note" : decodeURIComponent(noteId).replace(/-/g, " "));
  const hasGeneratedSummary = Boolean(summaryContent || typedSummary || isGuideNote);
  const displaySummary = generating ? typedSummary : summaryContent;
  const hasTranscriptData = transcript.length > 0;
  const playback = meeting?.playback ?? null;
  const playbackChapters = playback?.chapters ?? [];
  const playbackHighlights = playback?.highlights ?? [];
  const actionItems = meeting?.action_items ?? [];
  const hasPlaybackAudio = Boolean(playback?.has_audio && meeting?.id);
  const activeMeetingId = meeting?.id ?? null;
  const selectedLanguageLabel =
    LANGUAGE_OPTIONS.find((option) => option.value === (meeting?.transcription_language ?? ""))?.label ?? null;
  const manageableSpeakers = useMemo(() => {
    const labels = (meeting?.transcript_chunks ?? [])
      .map((chunk) => (chunk.speaker_label ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(labels));
  }, [meeting?.transcript_chunks]);
  const selectedSummaryTemplate = useMemo(
    () => getSummaryTemplate(summaryTemplateKey),
    [summaryTemplateKey],
  );

  useEffect(() => {
    meetingIdRef.current = activeMeetingId;
  }, [activeMeetingId]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    recordingPausedRef.current = recordingPaused;
  }, [recordingPaused]);

  useEffect(() => {
    document.title = `${displayTitle} - Notable`;
  }, [displayTitle]);

  useEffect(() => {
    if (isGuideNote || loading) return;
    if (!meeting?.id) return;
    setLanguageDialogOpen(!meeting.transcription_language);
  }, [isGuideNote, loading, meeting?.id, meeting?.transcription_language]);

  useEffect(() => {
    if (authLoading) return;

    let active = true;

    const load = async () => {
      if (isGuideNote) {
        if (!active) return;
        setMeeting({
          id: GUIDE_NOTE_ID,
          owner_id: "guide",
          title: GUIDE_NOTE_TITLE,
          provider: "generic",
          source_url: null,
          scheduled_start: null,
          scheduled_end: null,
          status: "completed",
          summary: GUIDE_NOTE_MARKDOWN,
          notes_markdown: GUIDE_NOTE_MARKDOWN,
          participants: [],
          ai_chat_enabled: false,
          memory_enabled: false,
          action_items: [],
          transcript_chunks: [],
          chat_messages: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        setNotesContent("");
        setSummaryContent(GUIDE_NOTE_MARKDOWN);
        setTypedSummary("");
        setActiveView("summary");
        setSummaryTemplateKey("office_meeting");
        setTranscript([]);
        setAssistantMessages([]);
        setLoading(false);
        return;
      }

      if (noteId === "new") {
        if (!pendingNewMeetingPromise) {
          pendingNewMeetingPromise = createMeeting({
            title: `Untitled meeting ${new Date().toLocaleDateString()}`,
            notes_markdown: "",
            participants: [],
            transcription_language: transcriptionLanguage === "auto" ? null : transcriptionLanguage,
          }).finally(() => {
            pendingNewMeetingPromise = null;
          });
        }
        const created = await pendingNewMeetingPromise;
        if (!active) return;
        setMeeting(created);
        setLoading(false);
        await navigate({ to: "/notes/$noteId", params: { noteId: created.id }, replace: true });
        return;
      }

      const detail = await getMeeting(noteId);
      if (!active) return;
      hydrateMeeting(detail);
      setLoading(false);
    };

    void load().catch((nextError) => {
      if (!active) return;
      setError(nextError instanceof Error ? nextError.message : "Unable to load note");
      setLoading(false);
    });

    return () => {
      active = false;
      cleanupRecordingResources();
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [authLoading, isGuideNote, navigate, noteId]);

  useEffect(() => {
    if (authLoading || isGuideNote) return;
    let active = true;
    void Promise.all([getTaskSyncConnections(), listSpeakerIdentities(), listTeams()])
      .then(([status, identities, teams]) => {
        if (!active) return;
        setTaskSyncConnections(status);
        setSpeakerIdentities(identities.items);
        const flattened = new Map<string, MentionableTeammate>();
        for (const team of teams) {
          for (const member of team.members) {
            if (!member.email) continue;
            flattened.set(member.email, {
              id: member.id,
              email: member.email,
              full_name: member.full_name,
            });
          }
        }
        setMentionableTeammates(Array.from(flattened.values()));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authLoading, isGuideNote]);

  useEffect(() => {
    assistantScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [assistantMessages, panelMode]);

  useEffect(() => {
    transcriptScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [panelMode, transcript]);

  useEffect(() => {
    if (!error) return;
    const timeoutId = window.setTimeout(() => {
      setError((current) => (current === error ? null : current));
    }, 5200);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setRecordingReady(false);
    setPlaybackTime(0);

    if (!meeting?.id || !hasPlaybackAudio) {
      setRecordingUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return () => undefined;
    }

    void getMeetingRecordingBlob(meeting.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setRecordingUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });
      })
      .catch(() => {
        if (!active) return;
        setRecordingUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return null;
        });
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [hasPlaybackAudio, meeting?.id]);

  const handleExportMeeting = async (format: "pdf" | "docx" | "markdown") => {
    if (!meeting?.id || isGuideNote) return;
    setExportingFormat(format);
    try {
      const file = await exportMeeting(meeting.id, format);
      triggerFileDownload(file.blob, file.filename);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to export meeting");
    } finally {
      setExportingFormat(null);
    }
  };

  const exportOptions = [
    { key: "pdf" as const, label: "Export as PDF" },
    { key: "docx" as const, label: "Export as DOCX" },
    { key: "markdown" as const, label: "Export as Markdown" },
  ];

  useEffect(() => {
    if (panelAnimationTimeoutRef.current) {
      window.clearTimeout(panelAnimationTimeoutRef.current);
      panelAnimationTimeoutRef.current = null;
    }

    if (panelMode) {
      setVisiblePanelMode(panelMode);
      const frameId = window.requestAnimationFrame(() => {
        setPanelSurfaceOpen(true);
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    if (!visiblePanelMode) return;

    setPanelSurfaceOpen(false);
    panelAnimationTimeoutRef.current = window.setTimeout(() => {
      setVisiblePanelMode(null);
    }, 220);

    return () => {
      if (panelAnimationTimeoutRef.current) {
        window.clearTimeout(panelAnimationTimeoutRef.current);
        panelAnimationTimeoutRef.current = null;
      }
    };
  }, [panelMode, visiblePanelMode]);

  useEffect(() => {
    if (!meeting?.id || isGuideNote) return;
    if (notesContent === (lastSavedNotesRef.current ?? "")) return;

    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(() => {
      void updateMeeting(meeting.id, { notes_markdown: notesContent })
        .then((updated) => {
          lastSavedNotesRef.current = updated.notes_markdown ?? "";
        })
        .catch(() => undefined);
    }, 500);

    return () => {
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    };
  }, [isGuideNote, meeting?.id, notesContent]);

  const hydrateMeeting = (detail: Meeting) => {
    setMeeting(detail);
    setTitleDraft(detail.title);
    setNotesContent(detail.notes_markdown ?? "");
    setSummaryTemplateKey((detail.summary_template as SummaryTemplateKey | null) ?? "office_meeting");
    lastSavedNotesRef.current = detail.notes_markdown ?? "";
    setSummaryContent(sanitizeSummaryForDisplay(detail.summary ?? ""));
    setTypedSummary("");
    setActiveView(detail.summary ? "summary" : "notes");
    setTranscript(
      (detail.transcript_chunks ?? []).map((line) => ({
        speaker: line.speaker_label || "Speaker",
        text: line.transcript_text,
        time: formatTime(line.created_at),
      })),
    );
    setAssistantMessages(
      (detail.chat_messages ?? []).map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        text: message.content,
        time: formatTime(message.created_at),
      })),
    );
  };

  const closeLiveTranscriptionSocket = () => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (sendIntervalRef.current) {
      window.clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
    if (pingIntervalRef.current) {
      window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }

    const socket = websocketRef.current;
    websocketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    sendInFlightRef.current = false;
  };

  const cleanupRecordingResources = () => {
    closeLiveTranscriptionSocket();

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    processorRef.current?.disconnect();
    processorRef.current = null;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    pcmChunksRef.current = [];
    sampleRateRef.current = 16000;
    sentChunkCountRef.current = 0;
    sentSamplesRef.current = 0;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const sendBufferedAudioChunk = async (force = false) => {
    const socket = websocketRef.current;
    const meetingId = meetingIdRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !meetingId || sendInFlightRef.current) {
      return;
    }

    const nextChunkIndex = pcmChunksRef.current.length;
    if (nextChunkIndex <= sentChunkCountRef.current) {
      return;
    }

    const unsentChunks = pcmChunksRef.current.slice(sentChunkCountRef.current, nextChunkIndex);
    const pcm = mergePcmChunks(unsentChunks);
    if (!pcm.length) {
      return;
    }

    const durationSeconds = pcm.length / sampleRateRef.current;
    if (!force && durationSeconds < 1.6) {
      return;
    }

    const sessionStartedAt = recordingSessionStartedAtRef.current;
    if (!sessionStartedAt) {
      return;
    }

    const startedAt = new Date(parseApiDate(sessionStartedAt).getTime() + (sentSamplesRef.current / sampleRateRef.current) * 1000);
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);

    sendInFlightRef.current = true;
    sentChunkCountRef.current = nextChunkIndex;
    sentSamplesRef.current += pcm.length;

    try {
      socket.send(
        JSON.stringify({
          audio_base64: arrayBufferToBase64(encodeWavBuffer(pcm, sampleRateRef.current)),
          mime_type: "audio/wav",
          speaker_label: "Speaker",
          transcription_language: meeting?.transcription_language ?? undefined,
          started_at: startedAt.toISOString(),
          ended_at: endedAt.toISOString(),
        }),
      );
    } catch (nextError) {
      sendInFlightRef.current = false;
      setError(nextError instanceof Error ? nextError.message : "Live transcription send failed");
    }
  };

  const startLiveTranscriptionSocket = (meetingId: string) => {
    closeLiveTranscriptionSocket();

    const socket = new WebSocket(buildTranscriptionWebSocketUrl(meetingId));
    websocketRef.current = socket;

    socket.onopen = () => {
      if (websocketRef.current !== socket) return;
      sendIntervalRef.current = window.setInterval(() => {
        void sendBufferedAudioChunk();
      }, 1800);

      pingIntervalRef.current = window.setInterval(() => {
        if (websocketRef.current?.readyState === WebSocket.OPEN) {
          websocketRef.current.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    };

    socket.onmessage = (event) => {
      if (websocketRef.current !== socket) return;
      try {
        const payload = JSON.parse(event.data) as {
          status?: string;
          transcript?: string;
          detail?: string;
          speaker_label?: string | null;
        };

        if (payload.status === "error") {
          sendInFlightRef.current = false;
          setError(payload.detail ?? "Live transcription failed");
          return;
        }

        if (!payload.transcript || isLowQualityTranscript(payload.transcript)) {
          sendInFlightRef.current = false;
          return;
        }

        const now = new Date().toISOString();
        const nextLine = {
          speaker: payload.speaker_label || "Speaker",
          text: payload.transcript.trim(),
          time: formatTime(now),
        };

        setTranscript((current) => [...current, nextLine]);

        const sessionStartedAt = recordingSessionStartedAtRef.current;
        const endedAt = now;
        const startedAt = sessionStartedAt ?? now;

        void storeTranscriptTextChunk(meetingId, {
          transcript_text: payload.transcript.trim(),
          speaker_label: payload.speaker_label ?? "Speaker",
          started_at: startedAt,
          ended_at: endedAt,
        }).catch(() => undefined);

        sendInFlightRef.current = false;
      } catch (nextError) {
        sendInFlightRef.current = false;
        setError(nextError instanceof Error ? nextError.message : "Unable to read live transcription");
      }
    };

    socket.onclose = () => {
      if (websocketRef.current !== socket) return;
      closeLiveTranscriptionSocket();
      if (recordingRef.current && !recordingPausedRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          const nextMeetingId = meetingIdRef.current;
          if (recordingRef.current && !recordingPausedRef.current && nextMeetingId) {
            startLiveTranscriptionSocket(nextMeetingId);
          }
        }, 1200);
      }
    };

    socket.onerror = () => {
      if (websocketRef.current !== socket) return;
      setError("Live transcription connection failed");
    };
  };

  const startAudioPipeline = async (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silentGain = audioContext.createGain();

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.85;
    silentGain.gain.value = 0;

    source.connect(analyser);
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    audioSourceRef.current = source;
    processorRef.current = processor;
    silentGainRef.current = silentGain;
    sampleRateRef.current = audioContext.sampleRate;

    processor.onaudioprocess = (event) => {
      if (!recordingRef.current || recordingPausedRef.current) return;
      const inputBuffer = event.inputBuffer;
      const channelCount = inputBuffer.numberOfChannels;
      const frameLength = inputBuffer.length;
      const mono = new Float32Array(frameLength);

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const channelData = inputBuffer.getChannelData(channelIndex);
        for (let sampleIndex = 0; sampleIndex < frameLength; sampleIndex += 1) {
          mono[sampleIndex] += channelData[sampleIndex] / channelCount;
        }
      }

      pcmChunksRef.current.push(mono);
    };

    if (audioContext.state !== "running") {
      void audioContext.resume();
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      const currentAnalyser = analyserRef.current;
      if (!currentAnalyser) return;
      currentAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / data.length);
      const scaled = Math.max(0, Math.min(1, rms * 6));
      setAudioLevel(scaled < 0.04 ? 0 : scaled);
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const startRecording = async (skipConsent = false) => {
    const meetingId = meetingIdRef.current;
    if (!meetingId || recording) return;

    if (showConsentNudge && !skipConsent) {
      setConsentDialogOpen(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      pcmChunksRef.current = [];
      recordingSessionStartedAtRef.current = new Date().toISOString();
      sentChunkCountRef.current = 0;
      sentSamplesRef.current = 0;
      setPanelMode(liveIndicator ? "transcript" : null);
      recordingRef.current = true;
      recordingPausedRef.current = false;
      startLiveTranscriptionSocket(meetingId);
      await startAudioPipeline(stream);
      setRecordingPaused(false);
      setRecording(true);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Microphone access failed");
    }
  };

  const stopRecording = () => {
    recordingRef.current = false;
    recordingPausedRef.current = false;
    setRecording(false);
    setRecordingPaused(false);
    cleanupRecordingResources();
    setPanelMode((current) => (current === "transcript" ? null : current));
  };

  const dismissRecordingSession = async () => {
    const currentMeetingId = meetingIdRef.current;
    const sessionStartedAt = recordingSessionStartedAtRef.current;

    stopRecording();

    if (!currentMeetingId) {
      return;
    }

    try {
      if (sessionStartedAt) {
        await discardTranscriptSession(currentMeetingId, {
          session_started_at: sessionStartedAt,
        });
      }
      recordingSessionStartedAtRef.current = null;
      const refreshed = await getMeeting(currentMeetingId);
      if (shouldDeleteEmptyPlaceholderMeeting(refreshed)) {
        await deleteMeeting(currentMeetingId);
        await navigate({ to: "/", replace: true });
        return;
      }
      hydrateMeeting(refreshed);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to discard recording");
    }
  };

  const pauseRecording = async () => {
    if (!recording || recordingPaused) return;

    await sendBufferedAudioChunk(true);
    for (let attempt = 0; attempt < 6 && sendInFlightRef.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }

    recordingPausedRef.current = true;
    setRecordingPaused(true);
    closeLiveTranscriptionSocket();
    setAudioLevel(0);

    if (audioContextRef.current && audioContextRef.current.state === "running") {
      await audioContextRef.current.suspend();
    }
  };

  const resumeRecording = async () => {
    if (!recording || !recordingPaused) return;

    recordingPausedRef.current = false;
    setRecordingPaused(false);

    if (audioContextRef.current && audioContextRef.current.state !== "running") {
      await audioContextRef.current.resume();
    }

    if (meetingIdRef.current) {
      startLiveTranscriptionSocket(meetingIdRef.current);
    }
  };

  const openShareDialog = async () => {
    if (!meeting?.id || isGuideNote) return;
    setShareDialogOpen(true);
  };

  const openSpeakerRename = (label: string) => {
    setSpeakerTargetLabel(label);
    setSpeakerNameDraft(label);
    setRememberSpeakerIdentity(true);
    setSpeakerDialogOpen(true);
  };

  const handleSaveSpeaker = async () => {
    if (!meeting?.id || !speakerTargetLabel) return;
    const nextName = speakerNameDraft.trim();
    if (!nextName) return;

    setSavingSpeaker(true);
    try {
      const updated = await renameMeetingSpeaker(meeting.id, {
        current_label: speakerTargetLabel,
        new_label: nextName,
        remember_identity: rememberSpeakerIdentity,
      });
      hydrateMeeting(updated);
      if (rememberSpeakerIdentity) {
        const refreshed = await listSpeakerIdentities();
        setSpeakerIdentities(refreshed.items);
      }
      setSpeakerDialogOpen(false);
      setSpeakerTargetLabel(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to rename speaker");
    } finally {
      setSavingSpeaker(false);
    }
  };

  const handleToggleRecord = async () => {
    if (recording) {
      setStopConfirmOpen(true);
      return;
    }

    await startRecording();
  };

  const openTemplateChooser = () => {
    if (!canGenerateSummary || generating || transcribingRecording) return;
    setTemplateChooserOpen(true);
  };

  const handleTogglePauseRecording = async () => {
    if (!recording) return;
    if (recordingPaused) {
      await resumeRecording();
      return;
    }
    await pauseRecording();
  };

  const confirmConsentAndStartRecording = async () => {
    setConsentDialogOpen(false);
    await startRecording(true);
  };

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

      if (action.action_type === "add_current_note_to_folder" && folderName && meeting?.id) {
        const title = typeof payload.title === "string" ? payload.title : meeting.title;
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (existing) {
          addNoteToFolder(existing.id, { id: meeting.id, title });
        } else {
          const folderId = createFolder(folderName, folderColor);
          addNoteToFolder(folderId, { id: meeting.id, title });
        }
        continue;
      }

      if (action.action_type === "remove_current_note_from_folder" && folderName && meeting?.id) {
        const existing = folders.find((folder) => normalizeFolderName(folder.name) === normalizeFolderName(folderName));
        if (existing) {
          removeNoteFromFolder(existing.id, meeting.id);
        }
        continue;
      }

      if (action.action_type === "delete_current_note") {
        void navigate({ to: "/", replace: true });
      }
    }
  };

  const openAssistantThread = async (prompt: string) => {
    if (!meetingIdRef.current) return;

    const now = formatTime(new Date().toISOString());
    setPanelMode("assistant");
    setAssistantMessages((current) => [
      ...current,
      { role: "user", time: now, text: prompt },
      { role: "assistant", time: now, text: "", pending: true },
    ]);

    try {
      await streamMeetingChat(
        meetingIdRef.current,
        { message: prompt, include_memory: true },
        {
          onChunk: (data) => {
            setAssistantMessages((current) => {
              const next = [...current];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (!last || last.role !== "assistant") return current;
              next[lastIndex] = { ...last, text: `${last.text}${data.text ?? ""}`, pending: false };
              return next;
            });
          },
          onDone: async (data) => {
            applyExecutedActions((data?.executed_actions ?? []) as ChatExecutedAction[]);
            if (!meetingIdRef.current) return;
            const detail = await getMeeting(meetingIdRef.current);
            hydrateMeeting(detail);
          },
          onError: (data) => {
            setAssistantMessages((current) => {
              const next = [...current];
              const lastIndex = next.length - 1;
              const last = next[lastIndex];
              if (!last || last.role !== "assistant") return current;
              next[lastIndex] = {
                ...last,
                text: data?.message || "Streaming error",
                pending: false,
              };
              return next;
            });
          },
        },
      );
    } catch (nextError) {
      setAssistantMessages((current) => {
        const next = [...current];
        const lastIndex = next.length - 1;
        const last = next[lastIndex];
        if (!last || last.role !== "assistant") return current;
        next[lastIndex] = {
          ...last,
          text: nextError instanceof Error ? nextError.message : "Chat failed",
        };
        return next;
      });
    }
  };

  const startSummary = async (templateKey: SummaryTemplateKey = summaryTemplateKey) => {
    if (!meetingIdRef.current) return;
    if (summaryContent && !hasTranscriptData) return;

    const nextTemplate = getSummaryTemplate(templateKey);
    const templateNotes = !notesContent.trim() ? buildTemplateNotesMarkdown(templateKey) : null;

    try {
      const updated = await updateMeeting(meetingIdRef.current, {
        summary_template: templateKey,
        ...(templateNotes ? { notes_markdown: templateNotes } : {}),
      });
      hydrateMeeting(updated);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to apply meeting template");
      return;
    }

    if (recording) {
      const mergedPcm = mergePcmChunks(pcmChunksRef.current);
      const recordingSampleRate = sampleRateRef.current;
      const sessionStartedAt = recordingSessionStartedAtRef.current;
      await sendBufferedAudioChunk(true);
      for (let attempt = 0; attempt < 8 && sendInFlightRef.current; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
      stopRecording();

      if (mergedPcm.length && sessionStartedAt) {
        setTranscribingRecording(true);
        try {
          const startedAt = parseApiDate(sessionStartedAt);
          const durationSeconds = mergedPcm.length / recordingSampleRate;
          const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
          await finalizeRecordingTranscript(meetingIdRef.current, {
            audio_base64: arrayBufferToBase64(encodeWavBuffer(mergedPcm, recordingSampleRate)),
            mime_type: "audio/wav",
            speaker_label: "Speaker",
            started_at: startedAt.toISOString(),
            ended_at: endedAt.toISOString(),
          });
          const refreshed = await getMeeting(meetingIdRef.current);
          hydrateMeeting(refreshed);
        } catch (nextError) {
          setTranscribingRecording(false);
          setError(nextError instanceof Error ? nextError.message : "Unable to finalize recording");
          return;
        } finally {
          setTranscribingRecording(false);
        }
      }
    }

    setGenerating(true);
    setTypedSummary("");
    setSummaryContent("");
    summaryBufferRef.current = "";
    setActiveView("summary");

    try {
      await streamMeetingSummary(
        meetingIdRef.current,
        { style: summaryStyle, template: templateKey, include_action_items: true, regenerate: true },
        {
          onChunk: (data) => {
            summaryBufferRef.current += data.text ?? "";
            setTypedSummary(summaryBufferRef.current);
          },
          onDone: (data) => {
            setGenerating(false);
            const nextSummary = sanitizeSummaryForDisplay(data.summary ?? summaryBufferRef.current);
            setSummaryContent(nextSummary);
            setTypedSummary(nextSummary);
            setActiveView("summary");
            setMeeting((current) => {
              if (!current) return current;
              const updatedMeeting = {
                ...current,
                summary: nextSummary,
                title: data.generated_title || current.title,
                summary_template: data.template || nextTemplate.key,
                notes_markdown: templateNotes ?? current.notes_markdown,
                action_items: Array.isArray(data.action_items) ? data.action_items : current.action_items,
              };
              setTitleDraft(updatedMeeting.title);
              syncCachedMeeting(updatedMeeting);
              return updatedMeeting;
            });
          },
        },
      );
      recordingSessionStartedAtRef.current = null;
    } catch (nextError) {
      setTranscribingRecording(false);
      setGenerating(false);
      setError(nextError instanceof Error ? nextError.message : "Summary generation failed");
    }
  };

  const handleTemplateContinue = async () => {
    setTemplatePreviewOpen(false);
    setTemplateChooserOpen(false);
    await startSummary(summaryTemplateKey);
  };

  const saveTitle = async () => {
    if (!meeting?.id) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === meeting.title) {
      setEditingTitle(false);
      setTitleDraft(meeting.title);
      return;
    }

    try {
      const updated = await updateMeeting(meeting.id, { title: nextTitle });
      setMeeting(updated);
      setTitleDraft(updated.title);
      syncCachedMeeting(updated);
      setEditingTitle(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to update title");
    }
  };

  const saveMeetingLanguage = async (language: "en" | "hi") => {
    if (!meeting?.id) return;

    try {
      const updated = await updateMeeting(meeting.id, { transcription_language: language });
      setMeeting(updated);
      syncCachedMeeting(updated);
      setLanguageDialogOpen(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save meeting language");
    }
  };

  const canGenerateSummary = Boolean(
    meeting?.id && (summaryContent ? hasTranscriptData : (notesContent.trim() || hasTranscriptData)),
  );
  const regenerationBlockedByTranscriptRetention = Boolean(summaryContent && !hasTranscriptData && !isGuideNote);
  const activeChapterId =
    playbackChapters.find((chapter) => playbackTime >= chapter.start_seconds && playbackTime < chapter.end_seconds)?.id ?? null;

  const jumpToPlaybackTime = (seconds: number) => {
    const player = audioPlayerRef.current;
    if (!player) return;
    player.currentTime = seconds;
    setPlaybackTime(seconds);
    void player.play().catch(() => undefined);
  };

  const handleSyncActionItems = async (provider: "jira" | "asana" | "linear") => {
    if (!meeting?.id) return;
    setSyncingProvider(provider);
    setSyncResult(null);
    try {
      const result = await syncMeetingActionItems(meeting.id, { provider });
      setSyncResult(result);
      const refreshedConnections = await getTaskSyncConnections().catch(() => null);
      if (refreshedConnections) {
        setTaskSyncConnections(refreshedConnections);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to sync action items");
    } finally {
      setSyncingProvider(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <span className="loading-shimmer-text">Loading note...</span>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card/60 px-1 py-1 backdrop-blur">
          <button
            onClick={() => window.history.back()}
            className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent"
            aria-label="Back"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <Link to="/" className="rounded-full p-1.5 text-foreground/70 transition hover:bg-accent" aria-label="Home">
            <HomeIcon className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {(summaryContent || typedSummary || generating) && (
            <div className="flex items-center rounded-full border border-border bg-card/60 p-1 backdrop-blur">
              <button
                type="button"
                onClick={() => setActiveView("notes")}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  activeView === "notes" ? "bg-foreground text-background" : "text-foreground/75 hover:bg-accent"
                }`}
              >
                Notes
              </button>
              <button
                type="button"
                onClick={() => setActiveView("summary")}
                className={`rounded-full px-3 py-1.5 text-xs transition ${
                  activeView === "summary" ? "bg-foreground text-background" : "text-foreground/75 hover:bg-accent"
                }`}
              >
                Summary
              </button>
            </div>
          )}
          {!isGuideNote && meeting?.id && !isMobile && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={exportingFormat !== null}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-2 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download className="h-3.5 w-3.5" />
                  {exportingFormat ? "Exporting..." : "Export"}
                  <ChevronUp className="h-3 w-3 rotate-180" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48 rounded-2xl border-border bg-popover/95 p-1.5 backdrop-blur">
                {exportOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.key}
                    onClick={() => void handleExportMeeting(option.key)}
                    className="rounded-xl px-3 py-2 text-sm"
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!isGuideNote && (
            recording ? (
              <>
                <button
                  type="button"
                  onClick={() => setStopConfirmOpen(true)}
                  disabled={generating || transcribingRecording}
                  className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-xs font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Square className="h-3 w-3" />
                  Stop & summarize
                </button>
                <button
                  type="button"
                  onClick={() => void handleTogglePauseRecording()}
                  disabled={generating || transcribingRecording}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-2 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {recordingPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  {recordingPaused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={() => void dismissRecordingSession()}
                  disabled={generating || transcribingRecording}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-2 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <X className="h-3.5 w-3.5" />
                  Stop & dismiss
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={openTemplateChooser}
                disabled={!canGenerateSummary || generating}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-2 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                title={
                  regenerationBlockedByTranscriptRetention
                    ? "Summary regeneration is unavailable because the original transcript has been auto-deleted."
                    : undefined
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                {summaryContent ? "Regenerate" : "Summarize"}
              </button>
            )
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-56 pt-24 animate-fade-in-up sm:px-6 sm:pt-28">
        <div className="flex items-start justify-between gap-4">
          {editingTitle ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveTitle();
                  }
                  if (event.key === "Escape") {
                    setEditingTitle(false);
                    setTitleDraft(meeting?.title ?? "");
                  }
                }}
                className="min-w-0 flex-1 bg-transparent pb-1 font-serif-display text-4xl leading-[1.12] text-foreground/90 focus:outline-none sm:text-5xl"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveTitle()}
                className="rounded-full border border-border bg-card/60 p-2 text-foreground/75 transition hover:bg-accent"
                aria-label="Save title"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate pb-1 font-serif-display text-4xl leading-[1.12] text-foreground/90 sm:text-5xl">{displayTitle}</h1>
              {!isGuideNote && (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="rounded-full border border-border bg-card/60 p-2 text-foreground/75 transition hover:bg-accent"
                  aria-label="Edit title"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {meeting?.scheduled_start ? <Pill icon={Calendar} label={formatDateLabel(meeting.scheduled_start)} /> : null}
          <Pill icon={Users} label={formatParticipantsLabel(meeting?.participants ?? [])} />
          {selectedLanguageLabel && <Pill icon={Sparkles} label={selectedLanguageLabel} />}
          {!isGuideNote && (
            <>
              {meeting?.id && isMobile && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={exportingFormat !== null}
                      className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {exportingFormat ? "Exporting..." : "Export"}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-48 rounded-2xl border-border bg-popover/95 p-1.5 backdrop-blur">
                    {exportOptions.map((option) => (
                      <DropdownMenuItem
                        key={option.key}
                        onClick={() => void handleExportMeeting(option.key)}
                        className="rounded-xl px-3 py-2 text-sm"
                      >
                        {option.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <button
                type="button"
                onClick={() => setPanelMode("transcript")}
                disabled={!hasTranscriptData}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                title={!hasTranscriptData ? "Transcript will appear here after a recording is transcribed." : undefined}
              >
                <FileText className="h-3.5 w-3.5" />
                Transcript
              </button>
              <button
                type="button"
                onClick={() => setSpeakerDialogOpen(true)}
                disabled={!manageableSpeakers.length}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
                title={!manageableSpeakers.length ? "Speaker controls appear once the transcript has distinct speaker labels." : undefined}
              >
                <UserPen className="h-3.5 w-3.5" />
                Manage speakers
              </button>
              <button
                onClick={() => void openShareDialog()}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent"
              >
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
              <button
                onClick={() => setFolderOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Add to folder
              </button>
            </>
          )}
        </div>

        {error && <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

        {regenerationBlockedByTranscriptRetention && (
          <div className="mt-6 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
            Transcript retention has removed the original transcript for this meeting, so the AI summary can no longer be regenerated.
          </div>
        )}

        {(transcribingRecording || generating) && (
          <div className="mt-10 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            <span className="loading-shimmer-text">
              {transcribingRecording ? "Transcribing recording..." : "Generating summary..."}
            </span>
          </div>
        )}

        {activeView === "summary" && hasGeneratedSummary ? (
          <>
            <article className="mt-8">
              <MarkdownRenderer markdown={displaySummary} className="markdown-note" />
            </article>
            {!isGuideNote && (hasPlaybackAudio || playbackChapters.length > 0 || playbackHighlights.length > 0) && (
              <section className="mt-8 rounded-[1.75rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Playback</div>
                      <h2 className="mt-2 font-serif-display text-2xl text-foreground/92">Replay the meeting</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        {hasPlaybackAudio
                          ? "Listen back to the captured recording and jump through smart chapters and standout moments."
                          : "This meeting was captured before recording playback was enabled, but the transcript still powers chapters and highlights."}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {playback?.duration_seconds ? <Pill icon={Play} label={formatPlaybackDuration(playback.duration_seconds)} /> : null}
                      {playbackHighlights.length ? <Pill icon={Flame} label={`${playbackHighlights.length} highlights`} /> : null}
                      {playbackChapters.length ? <Pill icon={ListVideo} label={`${playbackChapters.length} chapters`} /> : null}
                    </div>
                  </div>

                  {hasPlaybackAudio ? (
                    <div className="rounded-[1.4rem] border border-border/70 bg-background/50 p-4">
                      <audio
                        ref={audioPlayerRef}
                        src={recordingUrl ?? undefined}
                        controls
                        preload="metadata"
                        className="w-full"
                        onLoadedMetadata={() => setRecordingReady(true)}
                        onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{recordingReady ? `Current position ${formatPlaybackDuration(playbackTime)}` : "Preparing recording..."}</span>
                        {playback?.duration_seconds ? <span>Full length {formatPlaybackDuration(playback.duration_seconds)}</span> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[1.4rem] border border-dashed border-border/70 bg-background/35 px-4 py-4 text-sm text-muted-foreground">
                      Playback audio is not available for this meeting, but you can still use the smart outline below to scan the conversation.
                    </div>
                  )}

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
                    <div className="space-y-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Chapters</div>
                      {playbackChapters.length ? (
                        playbackChapters.map((chapter) => (
                          <button
                            key={chapter.id}
                            type="button"
                            onClick={() => jumpToPlaybackTime(chapter.start_seconds)}
                            className={`w-full rounded-[1.35rem] border px-4 py-4 text-left transition ${
                              activeChapterId === chapter.id
                                ? "border-foreground/25 bg-foreground/6"
                                : "border-border/70 bg-background/45 hover:bg-accent"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground/92">{chapter.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatPlaybackDuration(chapter.start_seconds)} - {formatPlaybackDuration(chapter.end_seconds)}
                              </div>
                            </div>
                            {chapter.summary ? <div className="mt-2 text-sm leading-6 text-muted-foreground">{chapter.summary}</div> : null}
                          </button>
                        ))
                      ) : (
                        <div className="rounded-[1.35rem] border border-border/70 bg-background/45 px-4 py-4 text-sm text-muted-foreground">
                          Chapters will appear after Notable has enough transcript detail to segment the conversation.
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Highlights</div>
                      {playbackHighlights.length ? (
                        playbackHighlights.map((highlight) => (
                          <button
                            key={highlight.id}
                            type="button"
                            onClick={() => jumpToPlaybackTime(highlight.start_seconds)}
                            className="w-full rounded-[1.35rem] border border-border/70 bg-background/45 px-4 py-4 text-left transition hover:bg-accent"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground/92">{highlight.label}</div>
                              <div className="text-xs text-muted-foreground">{formatPlaybackDuration(highlight.start_seconds)}</div>
                            </div>
                            <div className="mt-2 text-sm leading-6 text-muted-foreground">{highlight.quote}</div>
                          </button>
                        ))
                      ) : (
                        <div className="rounded-[1.35rem] border border-border/70 bg-background/45 px-4 py-4 text-sm text-muted-foreground">
                          Highlights will populate automatically once there is enough meeting content to score.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}
            {!isGuideNote && (
              <section className="mt-8 rounded-[1.75rem] border border-border bg-card/50 p-4 shadow-[var(--shadow-soft)] sm:p-5">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Action items</div>
                      <h2 className="mt-2 font-serif-display text-2xl text-foreground/92">Turn follow-ups into tracked work</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                        Sync the action items from this meeting into Jira, Asana, or Linear once those accounts are connected in Settings.
                      </p>
                      <Link
                        to="/tasks"
                        className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background/65 px-3 py-2 text-xs font-medium text-foreground/82 transition hover:bg-accent"
                      >
                        <KanbanSquare className="h-3.5 w-3.5" />
                        Open task board
                      </Link>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {taskSyncConnections?.jira_connected && (
                        <button
                          type="button"
                          onClick={() => void handleSyncActionItems("jira")}
                          disabled={syncingProvider !== null || !actionItems.length}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-45"
                        >
                          <RefreshCcw className={`h-3.5 w-3.5 ${syncingProvider === "jira" ? "animate-spin" : ""}`} />
                          Sync to Jira
                        </button>
                      )}
                      {taskSyncConnections?.asana_connected && (
                        <button
                          type="button"
                          onClick={() => void handleSyncActionItems("asana")}
                          disabled={syncingProvider !== null || !actionItems.length}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-45"
                        >
                          <RefreshCcw className={`h-3.5 w-3.5 ${syncingProvider === "asana" ? "animate-spin" : ""}`} />
                          Sync to Asana
                        </button>
                      )}
                      {taskSyncConnections?.linear_connected && (
                        <button
                          type="button"
                          onClick={() => void handleSyncActionItems("linear")}
                          disabled={syncingProvider !== null || !actionItems.length}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium transition hover:bg-accent disabled:opacity-45"
                        >
                          <RefreshCcw className={`h-3.5 w-3.5 ${syncingProvider === "linear" ? "animate-spin" : ""}`} />
                          Sync to Linear
                        </button>
                      )}
                    </div>
                  </div>

                  {actionItems.length ? (
                    <div className="space-y-3">
                      {actionItems.map((item, index) => (
                        <div key={`${item}-${index}`} className="rounded-[1.2rem] border border-border/70 bg-background/45 px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card/80 text-[11px] text-foreground/70">
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1 text-sm leading-6 text-foreground/90">{item}</div>
                          </div>
                          {meeting?.id ? (
                            <div className="mt-4">
                              <CommentsThread
                                entityType="action_item"
                                entityId={`${meeting.id}:action_item:${index}`}
                                entityLabel={`Action item ${index + 1}`}
                                meetingId={meeting.id}
                                title="Discuss this action item"
                                mentionablePeople={mentionableTeammates}
                              />
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[1.35rem] border border-border/70 bg-background/45 px-4 py-4 text-sm text-muted-foreground">
                      No action items were extracted from this summary yet.
                    </div>
                  )}

                  {syncResult ? (
                    <div className="rounded-[1.35rem] border border-border/70 bg-background/45 px-4 py-4 text-sm text-foreground/85">
                      <div className="font-medium">{syncResult.message}</div>
                      {!!syncResult.items.length && (
                        <div className="mt-3 space-y-2">
                          {syncResult.items.map((item) => (
                            <div key={`${item.provider}-${item.external_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{item.title}</div>
                                <div className="text-xs text-muted-foreground">{item.external_id}</div>
                              </div>
                              {item.url ? (
                                <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-foreground/75 transition hover:text-foreground">
                                  Open
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            )}
            {!isGuideNote && meeting?.id ? (
              <section className="mt-8">
                <CommentsThread
                  entityType="note"
                  entityId={meeting.id}
                  meetingId={meeting.id}
                  title="Notes comments"
                  defaultExpanded
                  mentionablePeople={mentionableTeammates}
                />
              </section>
            ) : null}
          </>
        ) : (
          <textarea
            value={notesContent}
            onChange={(event) => setNotesContent(event.target.value)}
            placeholder="Write your notes here..."
            className="mt-10 min-h-[calc(100vh-18rem)] w-full resize-none overflow-visible bg-transparent text-base leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        )}
      </main>

      {(visiblePanelMode === "assistant" || visiblePanelMode === "transcript") && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-20 px-4 sm:bottom-24">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3">
            <div
              className={`pointer-events-auto w-full overflow-hidden rounded-[1.5rem] border border-border bg-popover/95 shadow-[var(--shadow-elevated)] backdrop-blur ${
                panelSurfaceOpen ? "animate-panel-pop-in" : "animate-panel-pop-out"
              }`}
            >
              <>
                <div className="flex items-center justify-between border-b border-border/70 px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/60 text-foreground/80">
                      {visiblePanelMode === "transcript" ? <Copy className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground/90">
                        {visiblePanelMode === "transcript" ? "Recording" : "Chat"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {visiblePanelMode === "transcript"
                          ? "Live transcript for this recording session."
                          : "Ask about this note or pull recent todos."}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => setPanelMode(null)}
                    className="rounded-full p-2 text-foreground/60 transition hover:bg-accent"
                    aria-label={`Close ${visiblePanelMode === "transcript" ? "transcript" : "chat"} panel`}
                  >
                    <ChevronUp className="h-4 w-4 rotate-180" />
                  </button>
                </div>

                {visiblePanelMode === "transcript" ? (
                  <div className="max-h-[22rem] space-y-4 overflow-y-auto px-4 py-4 scrollbar-hide sm:max-h-[24rem] sm:px-5">
                    {transcript.length ? (
                      transcript.map((line, index) => (
                        <div
                          key={`${line.time}-${index}-${line.text.slice(0, 20)}`}
                          className="rounded-[1.1rem] border border-border/70 bg-background/40 px-4 py-3"
                        >
                          <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {line.speaker} {line.time}
                          </div>
                          <div className="text-sm leading-6 text-foreground/90">{line.text}</div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                        Start speaking and the transcript will appear here.
                      </div>
                    )}
                    <div ref={transcriptScrollRef} />
                  </div>
                ) : (
                  <div className="max-h-[22rem] space-y-4 overflow-y-auto px-4 py-4 scrollbar-hide sm:max-h-[24rem] sm:px-5">
                    {assistantMessages.length ? (
                      assistantMessages.map((message, index) => (
                        <ChatMessage key={`${message.time}-${index}`} message={message} index={index} />
                      ))
                    ) : (
                      <div className="rounded-[1.5rem] border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted-foreground">
                        Ask anything about this note, or use <span className="font-medium text-foreground/80">List recent todos</span> to pull a quick action list.
                      </div>
                    )}
                    <div ref={assistantScrollRef} />
                  </div>
                )}
              </>
            </div>
          </div>
        </div>
      )}

      {!isGuideNote && templateChooserOpen && (
        <div className="fixed inset-x-0 bottom-24 z-40 px-4 sm:px-6">
          <div className="mx-auto w-full max-w-3xl rounded-[1.9rem] border border-border bg-card/92 p-4 shadow-[var(--shadow-soft)] backdrop-blur sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Meeting template</div>
                <h3 className="mt-2 text-lg font-medium text-foreground/95 sm:text-xl">
                  Choose how Notable should structure this summary
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Templates guide the summary structure, action-item style, and the starter note sections Notable can prefill before summarization.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTemplateChooserOpen(false)}
                className="self-start rounded-full border border-border bg-background/65 p-2 text-foreground/75 transition hover:bg-accent"
                aria-label="Close template chooser"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SUMMARY_TEMPLATES.map((template) => {
                const active = template.key === summaryTemplateKey;
                return (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => setSummaryTemplateKey(template.key)}
                    className={`rounded-[1.45rem] border px-4 py-4 text-left transition ${
                      active
                        ? "border-foreground/20 bg-foreground text-background"
                        : "border-border bg-background/45 text-foreground/88 hover:bg-accent"
                    }`}
                  >
                    <div className="text-sm font-medium">{template.name}</div>
                    <div className={`mt-2 text-xs leading-5 ${active ? "text-background/78" : "text-muted-foreground"}`}>
                      {template.shortDescription}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-[1.4rem] border border-border/70 bg-background/45 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Selected template</div>
              <div className="mt-2 text-base font-medium text-foreground/92">{selectedSummaryTemplate.name}</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">{selectedSummaryTemplate.shortDescription}</div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setTemplatePreviewOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background/65 px-4 py-2.5 text-sm text-foreground/85 transition hover:bg-accent"
              >
                <ListVideo className="h-4 w-4" />
                Preview how this looks
              </button>
              <button
                type="button"
                onClick={() => void handleTemplateContinue()}
                disabled={generating || transcribingRecording}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                Continue with {selectedSummaryTemplate.name}
              </button>
            </div>
          </div>
        </div>
      )}

      <AskBar
        showRecorder={!isGuideNote}
        recording={recording}
        recordingPaused={recordingPaused}
        audioLevel={audioLevel}
        showRecordingBadge={false}
        stayOnPage={!isGuideNote}
        containerClassName="fixed"
        onToggleRecord={isGuideNote ? undefined : () => void handleToggleRecord()}
        onTogglePauseRecording={isGuideNote ? undefined : () => void handleTogglePauseRecording()}
        onSubmitMessage={isGuideNote ? undefined : (message) => void openAssistantThread(message)}
        onListRecentTodos={isGuideNote ? undefined : () => void openAssistantThread("List recent todos")}
      />
      {!isGuideNote && (
        <FolderDialog open={folderOpen} onClose={() => setFolderOpen(false)} noteId={meeting?.id} noteTitle={displayTitle} />
      )}
      <Dialog
        open={speakerDialogOpen}
        onOpenChange={(open) => {
          setSpeakerDialogOpen(open);
          if (!open) {
            setSpeakerTargetLabel(null);
            setSpeakerNameDraft("");
            setRememberSpeakerIdentity(true);
          }
        }}
      >
        <DialogContent className="max-w-2xl rounded-2xl border-border bg-popover p-0">
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
                Manage speakers
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
                Rename transcript speakers and remember real names for future meetings. These names also flow into summaries, chat, and analytics.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-3">
              {manageableSpeakers.length ? (
                manageableSpeakers.map((label) => (
                  <div key={label} className="rounded-2xl border border-border/70 bg-background/45 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Current speaker</div>
                        <div className="mt-2 text-sm font-medium text-foreground/92">{label}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openSpeakerRename(label)}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-xs font-medium text-foreground/85 transition hover:bg-accent"
                      >
                        <UserPen className="h-3.5 w-3.5" />
                        Rename
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-background/45 px-4 py-5 text-sm text-muted-foreground">
                  Speaker management becomes available after Notable has transcript speaker labels to work with.
                </div>
              )}
            </div>

            {speakerIdentities.length ? (
              <div className="mt-6 rounded-2xl border border-border/70 bg-background/45 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Remembered identities</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {speakerIdentities.map((identity) => (
                    <button
                      key={identity.id}
                      type="button"
                      onClick={() => setSpeakerNameDraft(identity.name)}
                      className="rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/85 transition hover:bg-accent"
                    >
                      {identity.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {speakerTargetLabel ? (
              <div className="mt-6 rounded-2xl border border-border bg-card/60 p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rename speaker</div>
                <div className="mt-3 text-sm text-muted-foreground">
                  Rename <span className="font-medium text-foreground/90">{speakerTargetLabel}</span> to:
                </div>
                <input
                  value={speakerNameDraft}
                  onChange={(event) => setSpeakerNameDraft(event.target.value)}
                  className="mt-3 w-full rounded-2xl border border-border bg-background/65 px-4 py-3 text-sm text-foreground outline-none"
                  placeholder="Enter a real name"
                />
                <label className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={rememberSpeakerIdentity}
                    onChange={(event) => setRememberSpeakerIdentity(event.target.checked)}
                    className="h-4 w-4 rounded border-border bg-background"
                  />
                  Remember this identity for future meetings
                </label>
                <div className="mt-5 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSpeakerTargetLabel(null);
                      setSpeakerNameDraft("");
                    }}
                    className="rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/80 transition hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSpeaker()}
                    disabled={savingSpeaker || !speakerNameDraft.trim()}
                    className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingSpeaker ? "Saving..." : "Save speaker"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={languageDialogOpen}
        onOpenChange={(open) => {
          if (meeting?.transcription_language) {
            setLanguageDialogOpen(open);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl border-border bg-popover p-0">
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
                Which language are you preferring for this meeting?
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
                Pick the dominant language style for this note. This does not mean people have to speak purely in one language. It just gives transcription a steadier hint.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 space-y-3">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void saveMeetingLanguage(option.value)}
                  className="w-full rounded-2xl border border-border bg-card/50 px-4 py-4 text-left transition hover:border-foreground/20 hover:bg-accent"
                >
                  <div className="text-sm text-foreground/90">{option.label}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={consentDialogOpen} onOpenChange={setConsentDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-popover p-0">
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
                Confirm recording consent
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
                Please make sure everyone in this meeting knows the conversation will be recorded and transcribed before you begin.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConsentDialogOpen(false)}
                className="rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/80 transition hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmConsentAndStartRecording()}
                className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
              >
                I have consent
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <DialogContent className="max-w-md rounded-2xl border-border bg-popover p-0">
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
                Stop recording and generate the summary?
              </DialogTitle>
              <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
                This will end the current recording session, finalize the transcript, and then let you choose the summary template before generation starts.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setStopConfirmOpen(false)}
                className="rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/80 transition hover:bg-accent"
              >
                Keep recording
              </button>
              <button
                type="button"
                onClick={() => {
                  setStopConfirmOpen(false);
                  setTemplateChooserOpen(true);
                }}
                className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
              >
                Choose template
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={templatePreviewOpen} onOpenChange={setTemplatePreviewOpen}>
        <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden rounded-2xl border-border bg-popover p-0">
          <div className="flex max-h-[82vh] flex-col">
            <div className="border-b border-border/70 px-6 py-5">
              <DialogHeader className="text-left">
                <DialogTitle className="text-xl font-medium text-foreground/95 sm:text-2xl">
                  Preview meeting templates
                </DialogTitle>
                <DialogDescription className="pt-2 text-sm leading-6 text-muted-foreground">
                  Switch between templates to see the summary structure, action-item style, and starter note sections before you choose one.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="flex flex-wrap gap-2">
                {SUMMARY_TEMPLATES.map((template) => {
                  const active = template.key === summaryTemplateKey;
                  return (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => setSummaryTemplateKey(template.key)}
                      className={`rounded-full border px-4 py-2 text-sm transition ${
                        active
                          ? "border-foreground/20 bg-foreground text-background"
                          : "border-border bg-background/55 text-foreground/85 hover:bg-accent"
                      }`}
                    >
                      {template.name}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-border/70 bg-background/45 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Summary structure</div>
                <div className="mt-2 text-xl font-medium text-foreground/94">{selectedSummaryTemplate.name}</div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedSummaryTemplate.shortDescription}</p>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-[1.35rem] border border-border/70 bg-card/55 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Preview summary</div>
                    <MarkdownRenderer markdown={selectedSummaryTemplate.previewSummary} className="markdown-note mt-4" />
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[1.35rem] border border-border/70 bg-card/55 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Action-item style</div>
                      <p className="mt-3 text-sm leading-6 text-foreground/88">{selectedSummaryTemplate.actionStyle}</p>
                    </div>

                    <div className="rounded-[1.35rem] border border-border/70 bg-card/55 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Starter note sections</div>
                      <div className="mt-3 space-y-2">
                        {selectedSummaryTemplate.noteSections.map((section) => (
                          <div key={section} className="rounded-full border border-border bg-background/55 px-3 py-1.5 text-sm text-foreground/86">
                            {section}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-border/70 px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setTemplatePreviewOpen(false)}
                  className="rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/82 transition hover:bg-accent"
                >
                  Close preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTemplatePreviewOpen(false);
                    setTemplateChooserOpen(true);
                  }}
                  className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
                >
                  Use {selectedSummaryTemplate.name}
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <MeetingShareDialog
        meetingId={!isGuideNote ? meeting?.id ?? null : null}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
      />
    </div>
  );
}

function sanitizeSummaryForDisplay(markdown: string) {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return normalized;

  const lines = normalized.split("\n");
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine === -1) return normalized;

  const firstLine = lines[firstContentLine].trim();
  const secondLine = lines[firstContentLine + 1]?.trim() ?? "";
  const headingLikePattern = /^(#{1,6}\s+.*|meeting summary:.*|summary:.*)$/i;

  if (headingLikePattern.test(firstLine) && (!secondLine || secondLine === "---")) {
    return lines.slice(firstContentLine + (secondLine === "---" ? 2 : 1)).join("\n").trim();
  }

  return normalized;
}

function deriveTranscriptDelta(previousTranscript: string, currentTranscript: string) {
  if (!currentTranscript) return "";
  if (!previousTranscript) return currentTranscript;
  if (currentTranscript === previousTranscript) return "";
  if (currentTranscript.startsWith(previousTranscript)) {
    return currentTranscript.slice(previousTranscript.length).trim();
  }
  if (currentTranscript.includes(previousTranscript)) {
    return currentTranscript.slice(currentTranscript.indexOf(previousTranscript) + previousTranscript.length).trim();
  }
  if (previousTranscript.includes(currentTranscript)) {
    return "";
  }

  const maxOverlap = Math.min(previousTranscript.length, currentTranscript.length);
  for (let size = maxOverlap; size >= 12; size -= 1) {
    const previousSuffix = previousTranscript.slice(-size).trim();
    const currentPrefix = currentTranscript.slice(0, size).trim();
    if (previousSuffix && previousSuffix === currentPrefix) {
      return currentTranscript.slice(size).trim();
    }
  }

  return currentTranscript;
}

function mergePcmChunks(chunks: Float32Array[]) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function encodeWavBuffer(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function isLowQualityTranscript(transcript: string) {
  const normalized = transcript.trim();
  if (!normalized) return true;
  if (normalized.length <= 2) return true;
  if (/([^\w\s])\1{7,}/.test(normalized)) return true;
  if (/(.)\1{14,}/.test(normalized.replace(/\s+/g, ""))) return true;

  const compact = normalized.replace(/\s+/g, "");
  const uniqueChars = new Set(compact);
  if (compact.length >= 20 && uniqueChars.size <= 3) return true;

  const barLikeChars = [...normalized].filter((char) => ["|", "।", "॥", "¦", "‖"].includes(char)).length;
  if (barLikeChars >= Math.max(8, Math.floor(normalized.length / 3))) return true;

  const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) {
    const counts = new Map<string, number>();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const uniqueTokenCount = counts.size;
    const maxTokenCount = Math.max(...counts.values());
    if (uniqueTokenCount === 1) return true;
    if (uniqueTokenCount === 2 && maxTokenCount >= tokens.length - 1) return true;
  }

  return false;
}

function formatPlaybackDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function Pill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <button className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs text-foreground/80 transition hover:bg-accent">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ChatMessage({ message, index }: { message: AssistantMessage; index: number }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} animate-note-message-enter`}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div
        className={`max-w-[74%] rounded-[1.05rem] border px-3.5 py-2.5 text-sm leading-6 shadow-sm ${
          isUser
            ? "rounded-br-md border-border bg-background/90 text-foreground"
            : "rounded-bl-md border-border/70 bg-foreground/[0.05] text-foreground/90"
        }`}
      >
        <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {isUser ? <UserRound className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
          <span>{isUser ? "You" : "Notable"}</span>
          <span>{message.time}</span>
        </div>
        <div>
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

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(parseApiDate(value));
}

function formatParticipantsLabel(participants: string[]) {
  if (!participants.length) return "1 participant";
  if (participants.length <= 2) return participants.join(", ");
  return `${participants.slice(0, 2).join(", ")} +${participants.length - 2}`;
}


function shouldDeleteEmptyPlaceholderMeeting(meeting: Meeting) {
  const title = meeting.title.trim().toLowerCase();
  const hasPlaceholderTitle = title.startsWith("untitled") || title === "new note";
  const hasContent = Boolean(
    meeting.notes_markdown?.trim() ||
      meeting.summary?.trim() ||
      meeting.transcript_chunks?.length ||
      meeting.chat_messages?.length,
  );
  return hasPlaceholderTitle && !hasContent;
}
