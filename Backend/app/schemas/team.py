from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class TeamMemberResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None = None
    avatar_url: str | None = None
    role: str
    joined_at: datetime


class TeamInviteResponse(BaseModel):
    id: str
    email: EmailStr
    status: str
    created_at: datetime
    expires_at: datetime


class TeamResponse(BaseModel):
    id: str
    name: str
    owner_id: str
    is_owner: bool
    members: list[TeamMemberResponse]
    pending_invites: list[TeamInviteResponse]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeamCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class TeamInviteRequest(BaseModel):
    email: EmailStr


class TeamInviteAccessResponse(BaseModel):
    status: str
    invite_token: str
    team_name: str | None = None
    invited_email: EmailStr | None = None
    inviter_name: str | None = None
