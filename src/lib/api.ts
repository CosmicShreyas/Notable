import { getStoredAuthToken } from "./auth";

export type User = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  default_link_sharing?: "team" | "link" | "private";
  transcript_retention_days?: number | null;
  allow_anonymized_summary_samples?: boolean;
  email_summary_snapshots?: boolean;
  created_at: string;
  updated_at: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description?: string | null;
  start?: string | null;
  end?: string | null;
  provider: string;
  join_url?: string | null;
  html_link?: string | null;
};

export type Meeting = {
  id: string;
  owner_id: string;
  title: string;
  summary_template?: string | null;
  transcription_language?: string | null;
  provider?: string | null;
  source_url?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  status: string;
  summary?: string | null;
  notes_markdown?: string | null;
  participants: string[];
  ai_chat_enabled: boolean;
  memory_enabled: boolean;
  action_items: string[];
  transcript_chunks?: {
    id: string;
    speaker_label?: string | null;
    sequence_number: number;
    transcript_text: string;
    started_at?: string | null;
    ended_at?: string | null;
    created_at: string;
    updated_at: string;
  }[];
  chat_messages?: {
    id: string;
    role: string;
    content: string;
    created_at: string;
    updated_at: string;
  }[];
  playback?: {
    has_audio: boolean;
    mime_type?: string | null;
    duration_seconds?: number | null;
    started_at?: string | null;
    ended_at?: string | null;
    chapters: {
      id: string;
      title: string;
      summary?: string | null;
      start_seconds: number;
      end_seconds: number;
    }[];
    highlights: {
      id: string;
      label: string;
      quote: string;
      kind: string;
      start_seconds: number;
      end_seconds: number;
    }[];
  } | null;
  created_at: string;
  updated_at: string;
};

export type MeetingShare = {
  meeting_id: string;
  share_token: string;
  share_url: string;
  visibility: "team" | "link" | "private";
  created_at: string;
  updated_at: string;
};

export type SharedMeetingAccess = {
  status: "granted" | "private_blocked" | "team_blocked" | "sign_in_required" | "not_found";
  visibility: "team" | "link" | "private";
  share_token: string;
  team_domain?: string | null;
  team_name?: string | null;
  owner_name?: string | null;
  meeting?: Meeting | null;
};

export type TeamMember = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
};

export type TeamInvite = {
  id: string;
  email: string;
  status: string;
  created_at: string;
  expires_at: string;
};

export type Team = {
  id: string;
  name: string;
  owner_id: string;
  is_owner: boolean;
  members: TeamMember[];
  pending_invites: TeamInvite[];
  created_at: string;
  updated_at: string;
};

export type VocabularyEntry = {
  id: string;
  canonical: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
};

export type SpeakerIdentity = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type TeamInviteAccess = {
  status: "pending" | "accepted" | "sign_in_required" | "email_mismatch" | "expired" | "not_found";
  invite_token: string;
  team_name?: string | null;
  invited_email?: string | null;
  inviter_name?: string | null;
};

export type SharedInboxItem = {
  meeting_id: string;
  title: string;
  summary?: string | null;
  notes_markdown?: string | null;
  provider?: string | null;
  created_at: string;
  updated_at: string;
  owner_name: string;
  share_token: string;
  share_url: string;
  visibility: "team" | "link" | "private";
  team_name?: string | null;
};

export type GoogleMeetIntegrationStatus = {
  addon_ready: boolean;
  media_api_enabled: boolean;
  cloud_project_number?: string | null;
  addon_launch_url: string;
  notes: string[];
};

export type SearchConnectionsStatus = {
  google_connected: boolean;
  gmail_connected: boolean;
  google_docs_connected: boolean;
  slack_connected: boolean;
  slack_workspace_name?: string | null;
  notes: string[];
};

export type TaskSyncConnectionsStatus = {
  jira_connected: boolean;
  asana_connected: boolean;
  linear_connected: boolean;
  jira_project_key?: string | null;
  asana_project_gid?: string | null;
  linear_team_id?: string | null;
  notes: string[];
};

export type TaskSyncRecord = {
  provider: "jira" | "asana" | "linear";
  external_id: string;
  title: string;
  url?: string | null;
};

export type ActionItemSyncResponse = {
  provider: "jira" | "asana" | "linear";
  synced_count: number;
  items: TaskSyncRecord[];
  message: string;
};

export type MeetingAnalyticsResponse = {
  overview: {
    total_meetings: number;
    summarized_meetings: number;
    meetings_with_recordings: number;
    shared_meetings: number;
    total_action_items: number;
    total_words: number;
    total_questions: number;
    average_duration_minutes: number;
    average_participants: number;
    average_action_items_per_meeting: number;
  };
  provider_breakdown: {
    provider: string;
    label: string;
    meetings: number;
    total_duration_minutes: number;
    average_duration_minutes: number;
    share_count: number;
  }[];
  visibility_breakdown: {
    visibility: string;
    label: string;
    meetings: number;
    total_views: number;
  }[];
  monthly_activity: {
    key: string;
    label: string;
    meetings: number;
    action_items: number;
    words: number;
  }[];
  top_meetings: {
    meeting_id: string;
    title: string;
    provider?: string | null;
    updated_at: string;
    action_items: number;
    words: number;
    duration_minutes: number;
    questions: number;
    participants: number;
    share_visibility?: string | null;
    share_views: number;
  }[];
  highlights: {
    title: string;
    body: string;
  }[];
};

export type Readout = {
  id: string;
  timeframe: string;
  sources: string[];
  title: string;
  summary: string;
  key_points: string[];
  action_items: string[];
  suggested_replies: string[];
  source_counts: {
    source: string;
    label: string;
    count: number;
  }[];
  notices: string[];
  created_at: string;
};

export type Task = {
  id: string;
  owner_id: string;
  meeting_id?: string | null;
  meeting_title?: string | null;
  title: string;
  status: "open" | "blocked" | "done";
  source: string;
  position: number;
  created_at: string;
  updated_at: string;
};

export type CommentMention = {
  user_id: string;
  email: string;
  full_name?: string | null;
};

export type CommentItem = {
  id: string;
  owner_id: string;
  author_user_id: string;
  author_name: string;
  author_email: string;
  author_avatar_url?: string | null;
  entity_type: "note" | "action_item" | "task";
  entity_id: string;
  entity_label?: string | null;
  meeting_id?: string | null;
  body: string;
  mentions: CommentMention[];
  can_delete: boolean;
  created_at: string;
  updated_at: string;
};

export type MeetingChatResponse = {
  meeting_id: string | null;
  scope: string;
  response: string;
  context_used: string[];
  executed_actions: ChatExecutedAction[];
};

export type ChatExecutedAction = {
  action_type: string;
  status: string;
  message: string;
  payload: Record<string, any>;
};

export type ChatHistoryResponse = {
  scope: string;
  messages: {
    id: string;
    role: string;
    content: string;
    created_at: string;
    updated_at: string;
  }[];
};

export type MeetingSummaryResponse = {
  meeting_id: string;
  style: string;
  template?: string;
  summary: string;
  action_items: string[];
  generated_title?: string | null;
};

type RequestOptions = RequestInit & {
  auth?: boolean;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
const API_V1 = `${API_BASE_URL}/api/v1`;
const MEETINGS_CACHE_TTL_MS = 30_000;
const MEETINGS_CACHE_STORAGE_KEY = "notable.meetings-cache";

let meetingsRequestPromise: Promise<{ items: Meeting[] }> | null = null;

function buildHeaders(initHeaders?: HeadersInit, auth = true) {
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");

  if (auth) {
    const token = getStoredAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return headers;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = buildHeaders(options.headers, options.auth ?? true);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_V1}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return JSON.parse(responseText) as T;
}

async function readErrorDetail(response: Response) {
  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

function cloneMeetings(items: Meeting[]): Meeting[] {
  return items.map((item): Meeting => ({
    ...item,
    participants: [...item.participants],
    transcript_chunks: item.transcript_chunks ? item.transcript_chunks.map((chunk) => ({ ...chunk })) : undefined,
    chat_messages: item.chat_messages ? item.chat_messages.map((message) => ({ ...message })) : undefined,
    playback: item.playback
      ? {
          ...item.playback,
          chapters: item.playback.chapters.map((chapter) => ({ ...chapter })),
          highlights: item.playback.highlights.map((highlight) => ({ ...highlight })),
        }
      : item.playback,
  }));
}

type PersistedMeetingsCache = {
  items: Meeting[];
  fetchedAt: number;
  isFullList: boolean;
};

function readPersistedMeetingsCache() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(MEETINGS_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      items?: Meeting[];
      fetchedAt?: number;
      isFullList?: boolean;
    };
    if (
      !Array.isArray(parsed.items) ||
      typeof parsed.fetchedAt !== "number" ||
      typeof parsed.isFullList !== "boolean"
    ) {
      return null;
    }
    if (Date.now() - parsed.fetchedAt >= MEETINGS_CACHE_TTL_MS) {
      window.localStorage.removeItem(MEETINGS_CACHE_STORAGE_KEY);
      return null;
    }
    return {
      items: cloneMeetings(parsed.items),
      fetchedAt: parsed.fetchedAt,
      isFullList: parsed.isFullList,
    };
  } catch {
    return null;
  }
}

export function getCachedMeetings() {
  const cache = readPersistedMeetingsCache();
  if (!cache?.isFullList) {
    return [];
  }
  return cache.items;
}

function setMeetingsCache(items: Meeting[], isFullList: boolean) {
  const nextCache: PersistedMeetingsCache = {
    items: cloneMeetings(items),
    fetchedAt: Date.now(),
    isFullList,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(MEETINGS_CACHE_STORAGE_KEY, JSON.stringify(nextCache));
  }
}

function mergeMeetingIntoCache(meeting: Meeting) {
  const persisted = readPersistedMeetingsCache();
  if (!persisted || !persisted.isFullList) {
    return;
  }
  const nextItems = [...persisted.items];
  const existingIndex = nextItems.findIndex((item) => item.id === meeting.id);
  if (existingIndex >= 0) {
    nextItems[existingIndex] = {
      ...nextItems[existingIndex],
      ...meeting,
    };
  } else {
    nextItems.unshift(meeting);
  }
  setMeetingsCache(nextItems, true);
}

function removeMeetingFromCache(meetingId: string) {
  const persisted = readPersistedMeetingsCache();
  if (!persisted || !persisted.isFullList) return;
  setMeetingsCache(
    persisted.items.filter((item) => item.id !== meetingId),
    true,
  );
}

export function syncCachedMeeting(meeting: Meeting) {
  mergeMeetingIntoCache(meeting);
}

export function clearMeetingsCache() {
  meetingsRequestPromise = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(MEETINGS_CACHE_STORAGE_KEY);
  }
}

export function parseApiDate(value: string) {
  const normalized =
    /z$/i.test(value) || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
  return new Date(normalized);
}

export async function getGoogleLoginUrl(redirectTo: string) {
  const search = new URLSearchParams({ redirect_to: redirectTo });
  return request<{ authorization_url: string }>(`/auth/google/login?${search.toString()}`, {
    method: "GET",
    auth: false,
  });
}

export async function logoutFromApi() {
  return request<{ detail: string }>("/auth/logout", {
    method: "POST",
  });
}

export async function getMe() {
  return request<User>("/users/me", { method: "GET" });
}

export async function updateUserPreferences(payload: {
  default_link_sharing?: "team" | "link" | "private";
  transcript_retention_days?: number | null;
  allow_anonymized_summary_samples?: boolean;
  email_summary_snapshots?: boolean;
}) {
  return request<User>("/users/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function getSearchConnections() {
  return request<SearchConnectionsStatus>("/users/me/search-connections", { method: "GET" });
}

export async function connectSlackSearch(payload: { user_token: string }) {
  return request<SearchConnectionsStatus>("/users/me/search-connections/slack", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectSlackSearch() {
  return request<SearchConnectionsStatus>("/users/me/search-connections/slack", {
    method: "DELETE",
  });
}

export async function getTaskSyncConnections() {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections", { method: "GET" });
}

export async function getMeetingAnalytics() {
  return request<MeetingAnalyticsResponse>("/analytics/meetings", { method: "GET" });
}

export async function listTasks() {
  return request<{ items: Task[] }>("/tasks", { method: "GET" });
}

export async function createTask(payload: {
  title: string;
  status?: "open" | "blocked" | "done";
  meeting_id?: string | null;
  meeting_title?: string | null;
  source?: string;
}) {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  taskId: string,
  payload: {
    title?: string;
    status?: "open" | "blocked" | "done";
    position?: number;
  },
) {
  return request<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteTask(taskId: string) {
  return request<void>(`/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function listReadouts() {
  return request<{ items: Readout[] }>("/readouts", { method: "GET" });
}

export async function generateReadout(payload: {
  timeframe: "24h" | "3d" | "7d";
  sources: ("gmail" | "slack")[];
  max_items_per_source?: number;
}) {
  return request<Readout>("/readouts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function connectJiraTaskSync(payload: {
  site_url: string;
  email: string;
  api_token: string;
  project_key: string;
  issue_type_name?: string;
}) {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/jira", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectJiraTaskSync() {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/jira", { method: "DELETE" });
}

export async function connectAsanaTaskSync(payload: {
  personal_access_token: string;
  project_gid: string;
  workspace_gid?: string | null;
}) {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/asana", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectAsanaTaskSync() {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/asana", { method: "DELETE" });
}

export async function connectLinearTaskSync(payload: {
  api_key: string;
  team_id: string;
}) {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/linear", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function disconnectLinearTaskSync() {
  return request<TaskSyncConnectionsStatus>("/users/me/task-sync-connections/linear", { method: "DELETE" });
}

export async function listCalendarEvents(filters?: {
  time_min?: string;
  time_max?: string;
}) {
  const searchParams = new URLSearchParams();
  if (filters?.time_min) {
    searchParams.set("time_min", filters.time_min);
  }
  if (filters?.time_max) {
    searchParams.set("time_max", filters.time_max);
  }
  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  return request<{ events: CalendarEvent[] }>(`/calendar/events${suffix}`, { method: "GET" });
}

export async function createCalendarEvent(payload: {
  title: string;
  description?: string | null;
  start: string;
  end: string;
  attendees?: string[];
}) {
  return request<{ event: CalendarEvent }>("/calendar/events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteCalendarEvent(eventId: string) {
  return request<void>(`/calendar/events/${eventId}`, {
    method: "DELETE",
  });
}

export async function listMeetings(filters?: {
  search?: string;
  status?: string;
  provider?: string;
  has_summary?: boolean;
}) {
  const searchParams = new URLSearchParams();
  if (filters?.search?.trim()) {
    searchParams.set("search", filters.search.trim());
  }
  if (filters?.status?.trim()) {
    searchParams.set("status", filters.status.trim());
  }
  if (filters?.provider?.trim()) {
    searchParams.set("provider", filters.provider.trim());
  }
  if (typeof filters?.has_summary === "boolean") {
    searchParams.set("has_summary", String(filters.has_summary));
  }

  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  const shouldUseCache = !suffix;

  if (!shouldUseCache) {
    return request<{ items: Meeting[] }>(`/meetings${suffix}`, { method: "GET" });
  }

  const persistedCache = readPersistedMeetingsCache();

  if (persistedCache) {
    if (!persistedCache.isFullList) {
      clearMeetingsCache();
    } else {
    return {
      items: cloneMeetings(persistedCache.items),
    };
    }
  }

  if (meetingsRequestPromise) {
    const cached = await meetingsRequestPromise;
    return {
      items: cloneMeetings(cached.items),
    };
  }

  meetingsRequestPromise = request<{ items: Meeting[] }>(`/meetings${suffix}`, { method: "GET" })
    .then((response) => {
      setMeetingsCache(response.items, true);
      return {
        items: cloneMeetings(response.items),
      };
    })
    .finally(() => {
      meetingsRequestPromise = null;
    });

  return meetingsRequestPromise;
}

export async function getMeeting(meetingId: string) {
  const meeting = await request<Meeting>(`/meetings/${meetingId}`, { method: "GET" });
  mergeMeetingIntoCache(meeting);
  return meeting;
}

async function downloadApiFile(path: string) {
  const response = await fetch(`${API_V1}${path}`, {
    method: "GET",
    headers: buildHeaders(undefined, true),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename=\"?([^"]+)\"?/i);
  return {
    blob,
    filename: filenameMatch?.[1] ?? "download",
  };
}

export async function exportMeeting(meetingId: string, format: "pdf" | "docx" | "markdown") {
  return downloadApiFile(`/exports/meetings/${meetingId}.${format}`);
}

export async function exportReadout(readoutId: string, format: "pdf" | "docx" | "markdown") {
  return downloadApiFile(`/exports/readouts/${readoutId}.${format}`);
}

export async function exportAnalytics(format: "pdf" | "docx" | "markdown") {
  return downloadApiFile(`/exports/analytics/meetings.${format}`);
}

export async function listComments(payload: {
  entity_type: "note" | "action_item" | "task";
  entity_id: string;
  meeting_id?: string | null;
}) {
  const search = new URLSearchParams({
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
  });
  if (payload.meeting_id) {
    search.set("meeting_id", payload.meeting_id);
  }
  return request<{ items: CommentItem[] }>(`/comments?${search.toString()}`, { method: "GET" });
}

export async function createComment(payload: {
  entity_type: "note" | "action_item" | "task";
  entity_id: string;
  body: string;
  entity_label?: string | null;
  meeting_id?: string | null;
}) {
  return request<CommentItem>("/comments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteComment(commentId: string) {
  return request<void>(`/comments/${commentId}`, {
    method: "DELETE",
  });
}

export async function createMeeting(payload: {
  title: string;
  transcription_language?: string | null;
  source_url?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  participants?: string[];
  notes_markdown?: string | null;
  summary_template?: string | null;
  ai_chat_enabled?: boolean;
  memory_enabled?: boolean;
}) {
  const meeting = await request<Meeting>("/meetings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  mergeMeetingIntoCache(meeting);
  return meeting;
}

export async function updateMeeting(
  meetingId: string,
  payload: {
    title?: string;
    notes_markdown?: string;
    status?: string;
    participants?: string[];
    summary_template?: string | null;
    transcription_language?: string | null;
  },
) {
  const meeting = await request<Meeting>(`/meetings/${meetingId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  mergeMeetingIntoCache(meeting);
  return meeting;
}

export async function listSpeakerIdentities() {
  return request<{ items: SpeakerIdentity[] }>("/meetings/speakers/identities", { method: "GET" });
}

export async function renameMeetingSpeaker(
  meetingId: string,
  payload: {
    current_label: string;
    new_label: string;
    remember_identity?: boolean;
  },
) {
  const meeting = await request<Meeting>(`/meetings/${meetingId}/speakers/rename`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  mergeMeetingIntoCache(meeting);
  return meeting;
}

export async function getMeetingShare(meetingId: string) {
  return request<MeetingShare>(`/meetings/${meetingId}/share`, {
    method: "GET",
  });
}

export async function createOrUpdateMeetingShare(
  meetingId: string,
  payload: { visibility: "team" | "link" | "private" },
) {
  return request<MeetingShare>(`/meetings/${meetingId}/share`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSharedMeeting(shareToken: string) {
  return request<SharedMeetingAccess>(`/share/${shareToken}`, {
    method: "GET",
  });
}

export async function markSharedMeetingViewed(shareToken: string) {
  return request<void>(`/share/${shareToken}/view`, {
    method: "POST",
  });
}

export async function listTeams() {
  return request<Team[]>("/teams", { method: "GET" });
}

export async function createTeam(payload: { name: string }) {
  return request<Team>("/teams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteTeam(teamId: string) {
  return request<void>(`/teams/${teamId}`, {
    method: "DELETE",
  });
}

export async function listVocabularyEntries() {
  return request<{ items: VocabularyEntry[] }>("/vocabulary", { method: "GET" });
}

export async function createVocabularyEntry(payload: { canonical: string; aliases: string[] }) {
  return request<VocabularyEntry>("/vocabulary", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateVocabularyEntry(
  entryId: string,
  payload: { canonical: string; aliases: string[] },
) {
  return request<VocabularyEntry>(`/vocabulary/${entryId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteVocabularyEntry(entryId: string) {
  return request<void>(`/vocabulary/${entryId}`, {
    method: "DELETE",
  });
}

export async function inviteTeamMember(teamId: string, payload: { email: string }) {
  return request<TeamInvite>(`/teams/${teamId}/invites`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function cancelTeamInvite(teamId: string, inviteId: string) {
  return request<void>(`/teams/${teamId}/invites/${inviteId}`, {
    method: "DELETE",
  });
}

export async function getTeamInvite(inviteToken: string) {
  return request<TeamInviteAccess>(`/teams/invites/${inviteToken}`, {
    method: "GET",
  });
}

export async function acceptTeamInvite(inviteToken: string) {
  return request<Team>(`/teams/invites/${inviteToken}/accept`, {
    method: "POST",
  });
}

export async function listSharedInbox() {
  return request<SharedInboxItem[]>("/share", {
    method: "GET",
  });
}

export async function getGoogleMeetIntegrationStatus() {
  return request<GoogleMeetIntegrationStatus>("/google-meet/status", {
    method: "GET",
  });
}

export async function deleteMeeting(meetingId: string) {
  await request<void>(`/meetings/${meetingId}`, {
    method: "DELETE",
  });
  removeMeetingFromCache(meetingId);
}

export async function sendTranscriptChunk(
  meetingId: string,
  payload: {
    audio_base64: string;
    mime_type: string;
    speaker_label?: string | null;
    started_at?: string;
    ended_at?: string;
  },
) {
  return request<{ meeting_id: string; transcript: string; speaker_label?: string | null; sequence_number: number }>(
    `/meetings/${meetingId}/transcripts/chunk`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function finalizeRecordingTranscript(
  meetingId: string,
  payload: {
    audio_base64: string;
    mime_type: string;
    speaker_label?: string | null;
    started_at?: string;
    ended_at?: string;
  },
) {
  return request<{ meeting_id: string; transcript: string; segment_count: number }>(
    `/meetings/${meetingId}/transcripts/finalize`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function getMeetingRecordingBlob(meetingId: string) {
  const headers = buildHeaders(undefined, true);
  const response = await fetch(`${API_V1}/meetings/${meetingId}/recording`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }

  return response.blob();
}

export async function storeTranscriptTextChunk(
  meetingId: string,
  payload: {
    transcript_text: string;
    speaker_label?: string | null;
    started_at?: string;
    ended_at?: string;
  },
) {
  return request<{ meeting_id: string; transcript: string; speaker_label?: string | null; sequence_number: number }>(
    `/meetings/${meetingId}/transcripts/text`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function discardTranscriptSession(
  meetingId: string,
  payload: {
    session_started_at: string;
  },
) {
  return request<{ meeting_id: string; deleted_count: number }>(
    `/meetings/${meetingId}/transcripts/discard-session`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function chatWithMeeting(meetingId: string, payload: { message: string; include_memory?: boolean }) {
  return request<MeetingChatResponse>(`/meetings/${meetingId}/chat`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateSummary(
  meetingId: string,
  payload: { style?: string; template?: string; include_action_items?: boolean; regenerate?: boolean },
) {
  return request<MeetingSummaryResponse>(`/meetings/${meetingId}/summary`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function syncMeetingActionItems(
  meetingId: string,
  payload: { provider: "jira" | "asana" | "linear" },
) {
  return request<ActionItemSyncResponse>(`/meetings/${meetingId}/action-items/sync`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

type StreamHandlers = {
  onStart?: (data: any) => void;
  onChunk?: (data: any) => void;
  onDone?: (data: any) => void;
  onError?: (data: any) => void;
};

export async function streamMeetingChat(
  meetingId: string,
  payload: { message: string; include_memory?: boolean; client_context?: Record<string, any> | null },
  handlers: StreamHandlers,
) {
  return streamSse(`/meetings/${meetingId}/chat/stream`, payload, handlers);
}

export async function streamGlobalChat(
  payload: { message: string; include_memory?: boolean; client_context?: Record<string, any> | null },
  handlers: StreamHandlers,
) {
  return streamSse(`/chat/stream`, payload, handlers);
}

export async function getGlobalChatHistory() {
  return request<ChatHistoryResponse>("/chat", { method: "GET" });
}

export async function streamMeetingSummary(
  meetingId: string,
  payload: { style?: string; template?: string; include_action_items?: boolean; regenerate?: boolean },
  handlers: StreamHandlers,
) {
  return streamSse(`/meetings/${meetingId}/summary/stream`, payload, handlers);
}

async function streamSse(path: string, payload: unknown, handlers: StreamHandlers) {
  const response = await fetch(`${API_V1}${path}`, {
    method: "POST",
    headers: (() => {
      const headers = buildHeaders(undefined, true);
      headers.set("Content-Type", "application/json");
      return headers;
    })(),
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(await readErrorDetail(response));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventText of events) {
      const parsed = parseSseEvent(eventText);
      if (!parsed) continue;
      if (parsed.event === "start") handlers.onStart?.(parsed.data);
      if (parsed.event === "chunk") handlers.onChunk?.(parsed.data);
      if (parsed.event === "done") handlers.onDone?.(parsed.data);
      if (parsed.event === "error") handlers.onError?.(parsed.data);
    }
  }
}

function parseSseEvent(chunk: string) {
  const lines = chunk.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length) return null;

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  } catch {
    return {
      event,
      data: { text: dataLines.join("\n") },
    };
  }
}

export function buildTranscriptionWebSocketUrl(meetingId: string) {
  const wsBase =
    (import.meta.env.VITE_WS_API_BASE_URL as string | undefined) ??
    API_BASE_URL.replace("https://", "wss://").replace("http://", "ws://");
  return `${wsBase}/api/v1/meetings/live-transcription/ws/${meetingId}`;
}

export async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
