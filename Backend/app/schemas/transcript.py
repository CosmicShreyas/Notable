from datetime import datetime

from pydantic import BaseModel, Field


class TranscriptChunkRequest(BaseModel):
    audio_base64: str = Field(description="Base64-encoded audio chunk payload")
    mime_type: str = Field(default="audio/webm")
    speaker_label: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class TranscriptTextChunkRequest(BaseModel):
    transcript_text: str = Field(min_length=1, description="Already transcribed text chunk")
    speaker_label: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class TranscriptSessionDiscardRequest(BaseModel):
    session_started_at: datetime = Field(description="Recording session start time in ISO format")


class TranscriptChunkResponse(BaseModel):
    meeting_id: str
    transcript: str
    speaker_label: str | None = None
    sequence_number: int


class TranscriptFinalizeResponse(BaseModel):
    meeting_id: str
    transcript: str
    segment_count: int


class TranscriptDiscardResponse(BaseModel):
    meeting_id: str
    deleted_count: int
