from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.comment import CommentCreateRequest, CommentListResponse, CommentResponse
from app.services.comment_service import CommentService

router = APIRouter()


@router.get("", response_model=CommentListResponse)
async def list_comments(
    entity_type: str = Query(...),
    entity_id: str = Query(...),
    meeting_id: str | None = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> CommentListResponse:
    service = CommentService()
    try:
        items = await service.list_comments(
            db=db,
            current_user=current_user,
            entity_type=entity_type,
            entity_id=entity_id,
            meeting_id=meeting_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return CommentListResponse(items=items)


@router.post("", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> CommentResponse:
    service = CommentService()
    try:
        return await service.create_comment(
            db=db,
            current_user=current_user,
            entity_type=payload.entity_type,
            entity_id=payload.entity_id,
            body=payload.body,
            entity_label=payload.entity_label,
            meeting_id=payload.meeting_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = CommentService()
    try:
        deleted = await service.delete_comment(db=db, current_user=current_user, comment_id=comment_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
