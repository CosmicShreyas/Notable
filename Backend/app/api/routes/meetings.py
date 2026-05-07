from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingListResponse,
    MeetingResponse,
    MeetingSummaryRequest,
    MeetingSummaryResponse,
    MeetingUpdateRequest,
)
from app.schemas.speaker import SpeakerIdentityListResponse, SpeakerRenameRequest
from app.schemas.share import MeetingShareRequest, MeetingShareResponse
from app.services.meeting_service import MeetingService
from app.services.speaker_service import SpeakerService
from app.schemas.task_sync import MeetingActionItemSyncRequest, MeetingActionItemSyncResponse
from app.services.task_sync_service import TaskSyncService

router = APIRouter()


@router.post("", response_model=MeetingResponse, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingResponse:
    service = MeetingService()
    meeting = await service.create_meeting(db=db, owner=current_user, payload=payload)
    return service.to_response(meeting)


@router.get("", response_model=MeetingListResponse)
async def list_meetings(
    search: str | None = Query(default=None, description="Filter by title or notes"),
    status_filter: str | None = Query(default=None, alias="status", description="Filter by meeting status"),
    provider: str | None = Query(default=None, description="Filter by meeting provider"),
    has_summary: bool | None = Query(default=None, description="Filter meetings that have or do not have summaries"),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingListResponse:
    service = MeetingService()
    meetings = await service.list_meetings(
        db=db,
        owner=current_user,
        search=search,
        status_filter=status_filter,
        provider=provider,
        has_summary=has_summary,
    )
    return MeetingListResponse(items=[service.to_response(item) for item in meetings])


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingResponse:
    service = MeetingService()
    meeting = await service.get_meeting(db=db, owner=current_user, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return service.to_response(meeting)


@router.patch("/{meeting_id}", response_model=MeetingResponse)
async def update_meeting(
    meeting_id: str,
    payload: MeetingUpdateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingResponse:
    service = MeetingService()
    meeting = await service.update_meeting(
        db=db,
        owner=current_user,
        meeting_id=meeting_id,
        payload=payload,
    )
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return service.to_response(meeting)


@router.get("/speakers/identities", response_model=SpeakerIdentityListResponse)
async def list_speaker_identities(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> SpeakerIdentityListResponse:
    service = SpeakerService()
    items = await service.list_identities(db=db, owner_id=current_user["id"])
    return SpeakerIdentityListResponse(items=items)


@router.post("/{meeting_id}/speakers/rename", response_model=MeetingResponse)
async def rename_meeting_speaker(
    meeting_id: str,
    payload: SpeakerRenameRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingResponse:
    speaker_service = SpeakerService()
    try:
        updated = await speaker_service.rename_speaker_in_meeting(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            current_label=payload.current_label,
            new_label=payload.new_label,
            remember_identity=payload.remember_identity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    meeting_service = MeetingService()
    meeting = await meeting_service.get_meeting(db=db, owner=current_user, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return meeting_service.to_response(meeting)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = MeetingService()
    deleted = await service.delete_meeting(
        db=db,
        owner=current_user,
        meeting_id=meeting_id,
    )
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")


@router.get("/{meeting_id}/recording")
async def stream_meeting_recording(
    meeting_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    service = MeetingService()
    recording = await service.get_recording_path(db=db, owner=current_user, meeting_id=meeting_id)
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not available")

    recording_path, mime_type = recording

    def iter_file():
        with recording_path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 256)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        iter_file(),
        media_type=mime_type,
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Disposition": f'inline; filename="{recording_path.name}"',
        },
    )


@router.post("/{meeting_id}/summary", response_model=MeetingSummaryResponse)
async def generate_summary(
    meeting_id: str,
    payload: MeetingSummaryRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingSummaryResponse:
    service = MeetingService()
    summary = await service.generate_summary(
        db=db,
        owner=current_user,
        meeting_id=meeting_id,
        payload=payload,
    )
    if not summary:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return summary


@router.post("/{meeting_id}/summary/stream")
async def stream_summary(
    meeting_id: str,
    payload: MeetingSummaryRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    service = MeetingService()
    stream = await service.stream_summary(
        db=db,
        owner=current_user,
        meeting_id=meeting_id,
        payload=payload,
    )
    if not stream:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{meeting_id}/share", response_model=MeetingShareResponse)
async def get_meeting_share(
    meeting_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingShareResponse:
    service = MeetingService()
    share = await service.get_share_by_meeting(db=db, owner=current_user, meeting_id=meeting_id)
    if not share:
        visibility = current_user.get("default_link_sharing", "link")
        try:
            share = await service.create_or_update_share(
                db=db,
                owner=current_user,
                meeting_id=meeting_id,
                visibility=visibility,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return MeetingShareResponse.model_validate(service.build_share_response(meeting_id, share))


@router.post("/{meeting_id}/share", response_model=MeetingShareResponse)
async def create_or_update_meeting_share(
    meeting_id: str,
    payload: MeetingShareRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingShareResponse:
    service = MeetingService()
    try:
        share = await service.create_or_update_share(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            visibility=payload.visibility,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return MeetingShareResponse.model_validate(service.build_share_response(meeting_id, share))


@router.post("/{meeting_id}/action-items/sync", response_model=MeetingActionItemSyncResponse)
async def sync_meeting_action_items(
    meeting_id: str,
    payload: MeetingActionItemSyncRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingActionItemSyncResponse:
    meeting_service = MeetingService()
    meeting = await meeting_service.get_meeting(db=db, owner=current_user, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")

    sync_service = TaskSyncService()
    try:
        result = await sync_service.sync_meeting_action_items(
            db=db,
            owner=current_user,
            meeting=meeting,
            provider=payload.provider,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return MeetingActionItemSyncResponse.model_validate(result)
