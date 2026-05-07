from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.analytics import MeetingAnalyticsResponse
from app.services.analytics_service import AnalyticsService

router = APIRouter()


@router.get("/meetings", response_model=MeetingAnalyticsResponse)
async def get_meeting_analytics(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingAnalyticsResponse:
    service = AnalyticsService()
    return await service.get_meeting_analytics(db=db, owner=current_user)
