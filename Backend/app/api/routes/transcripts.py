import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.transcript import (
    TranscriptChunkRequest,
    TranscriptChunkResponse,
    TranscriptDiscardResponse,
    TranscriptFinalizeResponse,
    TranscriptSessionDiscardRequest,
    TranscriptTextChunkRequest,
)
from app.services.transcription_service import TranscriptionService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/{meeting_id}/transcripts/chunk", response_model=TranscriptChunkResponse)
async def transcribe_chunk(
    meeting_id: str,
    payload: TranscriptChunkRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TranscriptChunkResponse:
    service = TranscriptionService()

    try:
        return await service.transcribe_and_store_chunk(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            payload=payload,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Meeting not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{meeting_id}/transcripts/finalize", response_model=TranscriptFinalizeResponse)
async def finalize_recording_transcript(
    meeting_id: str,
    payload: TranscriptChunkRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TranscriptFinalizeResponse:
    service = TranscriptionService()

    try:
        return await service.transcribe_and_store_recording(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            payload=payload,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Meeting not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{meeting_id}/transcripts/text", response_model=TranscriptChunkResponse)
async def store_transcript_text(
    meeting_id: str,
    payload: TranscriptTextChunkRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TranscriptChunkResponse:
    service = TranscriptionService()

    try:
        return await service.store_transcript_text_chunk(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            payload=payload,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Meeting not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/{meeting_id}/transcripts/discard-session", response_model=TranscriptDiscardResponse)
async def discard_transcript_session(
    meeting_id: str,
    payload: TranscriptSessionDiscardRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TranscriptDiscardResponse:
    service = TranscriptionService()

    try:
        return await service.discard_transcript_session(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            payload=payload,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if detail == "Meeting not found" else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.websocket("/live-transcription/ws/{meeting_id}")
async def live_transcription_ws(websocket: WebSocket, meeting_id: str) -> None:
    await websocket.accept()
    service = TranscriptionService()

    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") == "ping":
                await websocket.send_json({"type": "pong", "meeting_id": meeting_id})
                continue
            result = await service.transcribe_stream_message(meeting_id=meeting_id, payload=payload)
            await websocket.send_json(result)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.exception("Live transcription websocket failed for meeting %s", meeting_id)
        await websocket.send_json(
            {
                "meeting_id": meeting_id,
                "status": "error",
                "detail": str(exc),
            }
        )
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
