from datetime import datetime

from pydantic import BaseModel, Field


class MeetingShareRequest(BaseModel):
    visibility: str = Field(pattern="^(team|link|private)$")


class MeetingShareResponse(BaseModel):
    meeting_id: str
    share_token: str
    share_url: str
    visibility: str
    created_at: datetime
    updated_at: datetime


class SharedMeetingAccessResponse(BaseModel):
    status: str
    visibility: str
    share_token: str
    team_domain: str | None = None
    team_name: str | None = None
    owner_name: str | None = None
    meeting: dict | None = None


class SharedInboxItemResponse(BaseModel):
    meeting_id: str
    title: str
    summary: str | None = None
    notes_markdown: str | None = None
    provider: str | None = None
    created_at: datetime
    updated_at: datetime
    owner_name: str
    share_token: str
    share_url: str
    visibility: str
    team_name: str | None = None
