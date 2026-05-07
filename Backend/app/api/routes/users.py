from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.user import (
    SearchConnectionsResponse,
    SlackConnectionRequest,
    UserPreferencesUpdateRequest,
    UserResponse,
)
from app.services.external_search_service import ExternalSearchService
from app.schemas.task_sync import (
    AsanaConnectionRequest,
    JiraConnectionRequest,
    LinearConnectionRequest,
    TaskSyncConnectionStatus,
)
from app.services.task_sync_service import TaskSyncService
from app.services.transcription_service import TranscriptionService

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@router.patch("/me/preferences", response_model=UserResponse)
async def update_preferences(
    payload: UserPreferencesUpdateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> UserResponse:
    default_link_sharing = payload.default_link_sharing
    if default_link_sharing not in {None, "team", "link", "private"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported default link sharing option")

    retention_days = payload.transcript_retention_days
    if retention_days not in {None, 5, 10, 30, 60, 90}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported retention period")

    now = datetime.now(timezone.utc)
    updates = {
        "updated_at": now,
    }
    if payload.default_link_sharing is not None:
        updates["default_link_sharing"] = payload.default_link_sharing
    if payload.transcript_retention_days is not None or current_user.get("transcript_retention_days") is not None:
        updates["transcript_retention_days"] = retention_days
    if payload.allow_anonymized_summary_samples is not None:
        updates["allow_anonymized_summary_samples"] = payload.allow_anonymized_summary_samples
    if payload.email_summary_snapshots is not None:
        updates["email_summary_snapshots"] = payload.email_summary_snapshots

    await db["users"].update_one(
        {"id": current_user["id"]},
        {"$set": updates},
    )

    service = TranscriptionService()
    if "transcript_retention_days" in updates:
        await service.apply_retention_policy_to_owner(
            db=db,
            owner_id=current_user["id"],
            retention_days=retention_days,
        )

    updated_user = await db["users"].find_one({"id": current_user["id"]})
    return UserResponse.model_validate(updated_user)


@router.get("/me/search-connections", response_model=SearchConnectionsResponse)
async def get_search_connections(
    current_user: dict = Depends(get_current_user),
) -> SearchConnectionsResponse:
    service = ExternalSearchService()
    status_payload = await service.get_connection_status(owner=current_user)
    return SearchConnectionsResponse.model_validate(status_payload)


@router.post("/me/search-connections/slack", response_model=SearchConnectionsResponse)
async def connect_slack(
    payload: SlackConnectionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> SearchConnectionsResponse:
    token = payload.user_token.strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slack user token is required")

    service = ExternalSearchService()
    try:
        slack_identity = await service.validate_slack_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    now = datetime.now(timezone.utc)
    await db["users"].update_one(
        {"id": current_user["id"]},
        {
            "$set": {
                "slack_user_token": token,
                "slack_team_name": slack_identity.get("team"),
                "slack_user_id": slack_identity.get("user_id"),
                "updated_at": now,
            }
        },
    )

    updated_user = await db["users"].find_one({"id": current_user["id"]})
    status_payload = await service.get_connection_status(owner=updated_user or current_user)
    return SearchConnectionsResponse.model_validate(status_payload)


@router.delete("/me/search-connections/slack", response_model=SearchConnectionsResponse)
async def disconnect_slack(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> SearchConnectionsResponse:
    now = datetime.now(timezone.utc)
    await db["users"].update_one(
        {"id": current_user["id"]},
        {
            "$unset": {
                "slack_user_token": "",
                "slack_team_name": "",
                "slack_user_id": "",
            },
            "$set": {"updated_at": now},
        },
    )
    updated_user = await db["users"].find_one({"id": current_user["id"]})
    service = ExternalSearchService()
    status_payload = await service.get_connection_status(owner=updated_user or current_user)
    return SearchConnectionsResponse.model_validate(status_payload)


@router.get("/me/task-sync-connections", response_model=TaskSyncConnectionStatus)
async def get_task_sync_connections(
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    return TaskSyncConnectionStatus.model_validate(await service.get_connection_status(owner=current_user))


@router.post("/me/task-sync-connections/jira", response_model=TaskSyncConnectionStatus)
async def connect_jira(
    payload: JiraConnectionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    try:
        status_payload = await service.connect_jira(
            db=db,
            owner=current_user,
            site_url=payload.site_url,
            email=payload.email,
            api_token=payload.api_token,
            project_key=payload.project_key,
            issue_type_name=payload.issue_type_name,
        )
    except (ValueError, Exception) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TaskSyncConnectionStatus.model_validate(status_payload)


@router.delete("/me/task-sync-connections/jira", response_model=TaskSyncConnectionStatus)
async def disconnect_jira(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    status_payload = await service.disconnect_jira(db=db, owner=current_user)
    return TaskSyncConnectionStatus.model_validate(status_payload)


@router.post("/me/task-sync-connections/asana", response_model=TaskSyncConnectionStatus)
async def connect_asana(
    payload: AsanaConnectionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    try:
        status_payload = await service.connect_asana(
            db=db,
            owner=current_user,
            personal_access_token=payload.personal_access_token,
            project_gid=payload.project_gid,
            workspace_gid=payload.workspace_gid,
        )
    except (ValueError, Exception) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TaskSyncConnectionStatus.model_validate(status_payload)


@router.delete("/me/task-sync-connections/asana", response_model=TaskSyncConnectionStatus)
async def disconnect_asana(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    status_payload = await service.disconnect_asana(db=db, owner=current_user)
    return TaskSyncConnectionStatus.model_validate(status_payload)


@router.post("/me/task-sync-connections/linear", response_model=TaskSyncConnectionStatus)
async def connect_linear(
    payload: LinearConnectionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    try:
        status_payload = await service.connect_linear(
            db=db,
            owner=current_user,
            api_key=payload.api_key,
            team_id=payload.team_id,
        )
    except (ValueError, Exception) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TaskSyncConnectionStatus.model_validate(status_payload)


@router.delete("/me/task-sync-connections/linear", response_model=TaskSyncConnectionStatus)
async def disconnect_linear(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TaskSyncConnectionStatus:
    service = TaskSyncService()
    status_payload = await service.disconnect_linear(db=db, owner=current_user)
    return TaskSyncConnectionStatus.model_validate(status_payload)
