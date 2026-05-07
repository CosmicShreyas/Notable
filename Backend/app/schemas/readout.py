from datetime import datetime

from pydantic import BaseModel, Field


class ReadoutGenerateRequest(BaseModel):
    timeframe: str = "24h"
    sources: list[str] = Field(default_factory=lambda: ["gmail", "slack"])
    max_items_per_source: int = 8


class ReadoutSourceCount(BaseModel):
    source: str
    label: str
    count: int = 0


class ReadoutResponse(BaseModel):
    id: str
    timeframe: str
    sources: list[str]
    title: str
    summary: str
    key_points: list[str] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    suggested_replies: list[str] = Field(default_factory=list)
    source_counts: list[ReadoutSourceCount] = Field(default_factory=list)
    notices: list[str] = Field(default_factory=list)
    created_at: datetime


class ReadoutListResponse(BaseModel):
    items: list[ReadoutResponse] = Field(default_factory=list)
