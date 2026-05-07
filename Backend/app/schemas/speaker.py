from datetime import datetime

from pydantic import BaseModel, Field


class SpeakerIdentityResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime


class SpeakerIdentityListResponse(BaseModel):
    items: list[SpeakerIdentityResponse] = Field(default_factory=list)


class SpeakerRenameRequest(BaseModel):
    current_label: str = Field(min_length=1)
    new_label: str = Field(min_length=1)
    remember_identity: bool = True
