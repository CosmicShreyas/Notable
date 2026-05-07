from fastapi import APIRouter, Depends, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session, get_optional_current_user
from app.schemas.share import SharedInboxItemResponse, SharedMeetingAccessResponse
from app.services.meeting_service import MeetingService

router = APIRouter()


@router.get("", response_model=list[SharedInboxItemResponse])
async def list_shared_inbox(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> list[SharedInboxItemResponse]:
    service = MeetingService()
    items = await service.list_shared_inbox(db=db, viewer=current_user)
    return [SharedInboxItemResponse.model_validate(item) for item in items]


@router.post("/{share_token}/view", status_code=status.HTTP_204_NO_CONTENT)
async def record_shared_meeting_view(
    share_token: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = MeetingService()
    await service.record_shared_meeting_view(
        db=db,
        share_token=share_token,
        viewer=current_user,
    )


@router.get("/{share_token}", response_model=SharedMeetingAccessResponse)
async def resolve_shared_meeting(
    share_token: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict | None = Depends(get_optional_current_user),
) -> SharedMeetingAccessResponse:
    service = MeetingService()
    access = await service.get_shared_meeting_access(
        db=db,
        share_token=share_token,
        viewer=current_user,
    )
    return SharedMeetingAccessResponse.model_validate(access)
