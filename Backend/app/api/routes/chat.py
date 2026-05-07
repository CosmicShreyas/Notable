from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.chat import ChatHistoryResponse, MeetingChatRequest, MeetingChatResponse
from app.services.meeting_service import MeetingService

router = APIRouter()


@router.post("/chat", response_model=MeetingChatResponse)
async def global_chat(
    payload: MeetingChatRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingChatResponse:
    service = MeetingService()
    return await service.chat_globally(
        db=db,
        owner=current_user,
        payload=payload,
    )


@router.get("/chat", response_model=ChatHistoryResponse)
async def get_global_chat_history(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> ChatHistoryResponse:
    service = MeetingService()
    return await service.get_global_chat_history(
        db=db,
        owner=current_user,
    )


@router.post("/chat/stream")
async def stream_global_chat(
    payload: MeetingChatRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    service = MeetingService()
    stream = await service.stream_chat_globally(
        db=db,
        owner=current_user,
        payload=payload,
    )

    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/meetings/{meeting_id}/chat", response_model=MeetingChatResponse)
async def meeting_chat(
    meeting_id: str,
    payload: MeetingChatRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> MeetingChatResponse:
    service = MeetingService()
    response = await service.chat_with_meeting(
        db=db,
        owner=current_user,
        meeting_id=meeting_id,
        payload=payload,
    )
    if not response:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return response


@router.post("/meetings/{meeting_id}/chat/stream")
async def stream_meeting_chat(
    meeting_id: str,
    payload: MeetingChatRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> StreamingResponse:
    service = MeetingService()
    stream = await service.stream_chat_with_meeting(
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
