from datetime import datetime

from pydantic import BaseModel, Field


class CalendarEventResponse(BaseModel):
    id: str
    title: str
    description: str | None = None
    start: datetime | None = None
    end: datetime | None = None
    provider: str = "google"
    join_url: str | None = None
    html_link: str | None = None


class CalendarEventListResponse(BaseModel):
    events: list[CalendarEventResponse]


class CalendarEventCreateRequest(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: str | None = None
    start: datetime
    end: datetime
    attendees: list[str] = Field(default_factory=list)


class CalendarEventCreateResponse(BaseModel):
    event: CalendarEventResponse
