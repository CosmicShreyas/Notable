from datetime import datetime

from pydantic import BaseModel, Field


class MeetingAnalyticsOverview(BaseModel):
    total_meetings: int = 0
    summarized_meetings: int = 0
    meetings_with_recordings: int = 0
    shared_meetings: int = 0
    total_action_items: int = 0
    total_words: int = 0
    total_questions: int = 0
    average_duration_minutes: float = 0
    average_participants: float = 0
    average_action_items_per_meeting: float = 0


class MeetingAnalyticsProviderBreakdown(BaseModel):
    provider: str
    label: str
    meetings: int = 0
    total_duration_minutes: float = 0
    average_duration_minutes: float = 0
    share_count: int = 0


class MeetingAnalyticsVisibilityBreakdown(BaseModel):
    visibility: str
    label: str
    meetings: int = 0
    total_views: int = 0


class MeetingAnalyticsTrendPoint(BaseModel):
    key: str
    label: str
    meetings: int = 0
    action_items: int = 0
    words: int = 0


class MeetingAnalyticsTopMeeting(BaseModel):
    meeting_id: str
    title: str
    provider: str | None = None
    updated_at: datetime
    action_items: int = 0
    words: int = 0
    duration_minutes: float = 0
    questions: int = 0
    participants: int = 0
    share_visibility: str | None = None
    share_views: int = 0


class MeetingAnalyticsHighlight(BaseModel):
    title: str
    body: str


class MeetingAnalyticsResponse(BaseModel):
    overview: MeetingAnalyticsOverview
    provider_breakdown: list[MeetingAnalyticsProviderBreakdown] = Field(default_factory=list)
    visibility_breakdown: list[MeetingAnalyticsVisibilityBreakdown] = Field(default_factory=list)
    monthly_activity: list[MeetingAnalyticsTrendPoint] = Field(default_factory=list)
    top_meetings: list[MeetingAnalyticsTopMeeting] = Field(default_factory=list)
    highlights: list[MeetingAnalyticsHighlight] = Field(default_factory=list)
