from datetime import datetime

from pydantic import BaseModel, Field


class CommentMentionResponse(BaseModel):
    user_id: str
    email: str
    full_name: str | None = None


class CommentResponse(BaseModel):
    id: str
    owner_id: str
    author_user_id: str
    author_name: str
    author_email: str
    author_avatar_url: str | None = None
    entity_type: str
    entity_id: str
    entity_label: str | None = None
    meeting_id: str | None = None
    body: str
    mentions: list[CommentMentionResponse] = Field(default_factory=list)
    can_delete: bool = False
    created_at: datetime
    updated_at: datetime


class CommentListResponse(BaseModel):
    items: list[CommentResponse] = Field(default_factory=list)


class CommentCreateRequest(BaseModel):
    entity_type: str
    entity_id: str
    entity_label: str | None = None
    meeting_id: str | None = None
    body: str = Field(min_length=1, max_length=4000)

