from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MeetingChatRequest(BaseModel):
    message: str = Field(min_length=1)
    include_memory: bool = True
    client_context: dict[str, Any] | None = None


class ChatExecutedAction(BaseModel):
    action_type: str
    status: str
    message: str
    payload: dict[str, Any] = Field(default_factory=dict)


class MeetingChatResponse(BaseModel):
    meeting_id: str | None = None
    scope: str = "meeting"
    response: str
    context_used: list[str]
    executed_actions: list[ChatExecutedAction] = Field(default_factory=list)


class ChatMessageItem(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime
    updated_at: datetime


class ChatHistoryResponse(BaseModel):
    scope: str
    messages: list[ChatMessageItem]
