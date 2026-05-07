from typing import Literal

from pydantic import BaseModel, Field


TaskSyncProvider = Literal["jira", "asana", "linear"]


class JiraConnectionRequest(BaseModel):
    site_url: str
    email: str
    api_token: str
    project_key: str
    issue_type_name: str = "Task"


class AsanaConnectionRequest(BaseModel):
    personal_access_token: str
    project_gid: str
    workspace_gid: str | None = None


class LinearConnectionRequest(BaseModel):
    api_key: str
    team_id: str


class TaskSyncConnectionStatus(BaseModel):
    jira_connected: bool
    asana_connected: bool
    linear_connected: bool
    jira_project_key: str | None = None
    asana_project_gid: str | None = None
    linear_team_id: str | None = None
    notes: list[str] = Field(default_factory=list)


class TaskSyncRecord(BaseModel):
    provider: TaskSyncProvider
    external_id: str
    title: str
    url: str | None = None


class MeetingActionItemSyncRequest(BaseModel):
    provider: TaskSyncProvider


class MeetingActionItemSyncResponse(BaseModel):
    provider: TaskSyncProvider
    synced_count: int
    items: list[TaskSyncRecord] = Field(default_factory=list)
    message: str
