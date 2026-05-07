from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class UserResponse(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None = None
    avatar_url: str | None = None
    timezone: str
    default_link_sharing: str = "link"
    transcript_retention_days: int | None = None
    allow_anonymized_summary_samples: bool = False
    email_summary_snapshots: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserPreferencesUpdateRequest(BaseModel):
    default_link_sharing: str | None = None
    transcript_retention_days: int | None = None
    allow_anonymized_summary_samples: bool | None = None
    email_summary_snapshots: bool | None = None


class SearchConnectionsResponse(BaseModel):
    google_connected: bool
    gmail_connected: bool
    google_docs_connected: bool
    slack_connected: bool
    slack_workspace_name: str | None = None
    notes: list[str]


class SlackConnectionRequest(BaseModel):
    user_token: str
