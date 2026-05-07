from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TranscriptLineResponse(BaseModel):
    id: str
    speaker_label: str | None = None
    sequence_number: int
    transcript_text: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime
    updated_at: datetime


class MeetingPlaybackChapterResponse(BaseModel):
    id: str
    title: str
    summary: str | None = None
    start_seconds: float
    end_seconds: float


class MeetingPlaybackHighlightResponse(BaseModel):
    id: str
    label: str
    quote: str
    kind: str = "highlight"
    start_seconds: float
    end_seconds: float


class MeetingPlaybackResponse(BaseModel):
    has_audio: bool = False
    mime_type: str | None = None
    duration_seconds: float | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    chapters: list[MeetingPlaybackChapterResponse] = Field(default_factory=list)
    highlights: list[MeetingPlaybackHighlightResponse] = Field(default_factory=list)


class MeetingCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    source_url: str | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    participants: list[str] = Field(default_factory=list)
    notes_markdown: str | None = None
    summary_template: str | None = None
    transcription_language: str | None = None
    ai_chat_enabled: bool = True
    memory_enabled: bool = True


class MeetingUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=255)
    notes_markdown: str | None = None
    status: str | None = None
    participants: list[str] | None = None
    summary_template: str | None = None
    transcription_language: str | None = None


class MeetingResponse(BaseModel):
    id: str
    owner_id: str
    title: str
    provider: str | None = None
    source_url: str | None = None
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None
    status: str
    summary: str | None = None
    notes_markdown: str | None = None
    summary_template: str | None = None
    transcription_language: str | None = None
    participants: list[str] = Field(default_factory=list)
    ai_chat_enabled: bool
    memory_enabled: bool
    action_items: list[str] = Field(default_factory=list)
    transcript_chunks: list[TranscriptLineResponse] = Field(default_factory=list)
    chat_messages: list[ChatMessageResponse] = Field(default_factory=list)
    playback: MeetingPlaybackResponse | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeetingListResponse(BaseModel):
    items: list[MeetingResponse]


class MeetingSummaryRequest(BaseModel):
    style: str = Field(default="balanced")
    template: str = Field(default="office_meeting")
    include_action_items: bool = True
    regenerate: bool = False


class MeetingSummaryResponse(BaseModel):
    meeting_id: str
    style: str
    template: str = "office_meeting"
    summary: str
    action_items: list[str]
    generated_title: str | None = None
