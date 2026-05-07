from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.task import TaskCreateRequest, TaskListResponse, TaskResponse, TaskUpdateRequest
from app.services.meeting_service import MeetingService
from app.services.task_board_service import TaskBoardService

router = APIRouter()


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskListResponse:
    service = TaskBoardService()
    items = await service.list_tasks(db=db, owner_id=current_user["id"])
    return TaskListResponse(items=[TaskResponse.model_validate(item) for item in items])


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskResponse:
    service = TaskBoardService()
    meeting_title = payload.meeting_title
    if payload.meeting_id and not meeting_title:
        meeting = await MeetingService().get_meeting(db=db, owner=current_user, meeting_id=payload.meeting_id)
        if meeting:
            meeting_title = meeting.get("title")
    try:
        task = await service.create_task(
            db=db,
            owner_id=current_user["id"],
            title=payload.title,
            status=payload.status,
            meeting_id=payload.meeting_id,
            meeting_title=meeting_title,
            source=payload.source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TaskResponse.model_validate(task)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskResponse:
    service = TaskBoardService()
    try:
        task = await service.update_task(
            db=db,
            owner_id=current_user["id"],
            task_id=task_id,
            title=payload.title,
            status=payload.status,
            position=payload.position,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return TaskResponse.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = TaskBoardService()
    deleted = await service.delete_task(db=db, owner_id=current_user["id"], task_id=task_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    await db["comments"].delete_many(
        {
            "owner_id": current_user["id"],
            "entity_type": "task",
            "entity_id": task_id,
        }
    )
