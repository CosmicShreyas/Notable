from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VocabularyEntryResponse(BaseModel):
    id: str
    canonical: str
    aliases: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VocabularyEntryCreateRequest(BaseModel):
    canonical: str = Field(min_length=1, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class VocabularyEntryUpdateRequest(BaseModel):
    canonical: str = Field(min_length=1, max_length=120)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class VocabularyListResponse(BaseModel):
    items: list[VocabularyEntryResponse]
