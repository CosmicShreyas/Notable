from datetime import datetime

from pydantic import BaseModel, Field


class TaskResponse(BaseModel):
    id: str
    owner_id: str
    meeting_id: str | None = None
    meeting_title: str | None = None
    title: str
    status: str = "open"
    source: str = "meeting_action_item"
    position: float = 0
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    items: list[TaskResponse]


class TaskCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    status: str = "open"
    meeting_id: str | None = None
    meeting_title: str | None = None
    source: str = "manual"


class TaskUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=300)
    status: str | None = None
    position: float | None = None

