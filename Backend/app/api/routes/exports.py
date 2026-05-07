from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.services.export_service import ExportService

router = APIRouter()


@router.get("/meetings/{meeting_id}.{export_format}")
async def export_meeting(
    meeting_id: str,
    export_format: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> Response:
    service = ExportService()
    try:
        payload = await service.export_meeting(
            db=db,
            owner=current_user,
            meeting_id=meeting_id,
            export_format=export_format,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return Response(
        content=payload.content,
        media_type=payload.media_type,
        headers={"Content-Disposition": f'attachment; filename="{payload.filename}"'},
    )


@router.get("/readouts/{readout_id}.{export_format}")
async def export_readout(
    readout_id: str,
    export_format: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> Response:
    service = ExportService()
    try:
        payload = await service.export_readout(
            db=db,
            owner=current_user,
            readout_id=readout_id,
            export_format=export_format,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = status.HTTP_404_NOT_FOUND if "not found" in detail.lower() else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return Response(
        content=payload.content,
        media_type=payload.media_type,
        headers={"Content-Disposition": f'attachment; filename="{payload.filename}"'},
    )


@router.get("/analytics/meetings.{export_format}")
async def export_analytics(
    export_format: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> Response:
    service = ExportService()
    try:
        payload = await service.export_analytics(
            db=db,
            owner=current_user,
            export_format=export_format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return Response(
        content=payload.content,
        media_type=payload.media_type,
        headers={"Content-Disposition": f'attachment; filename="{payload.filename}"'},
    )
