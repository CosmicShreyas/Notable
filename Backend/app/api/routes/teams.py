from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session, get_optional_current_user
from app.schemas.team import (
    TeamCreateRequest,
    TeamInviteAccessResponse,
    TeamInviteRequest,
    TeamInviteResponse,
    TeamResponse,
)
from app.services.team_service import TeamService

router = APIRouter()


@router.get("", response_model=list[TeamResponse])
async def list_my_teams(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> list[TeamResponse]:
    service = TeamService()
    teams = await service.get_user_teams(db=db, user=current_user)
    return [TeamResponse.model_validate(team) for team in teams]


@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    payload: TeamCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TeamResponse:
    service = TeamService()
    try:
        team = await service.create_team(db=db, owner=current_user, name=payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TeamResponse.model_validate(team)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = TeamService()
    try:
        await service.delete_team(db=db, owner=current_user, team_id=team_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{team_id}/invites", response_model=TeamInviteResponse, status_code=status.HTTP_201_CREATED)
async def invite_team_member(
    team_id: str,
    payload: TeamInviteRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TeamInviteResponse:
    service = TeamService()
    try:
        invite = await service.invite_member(
            db=db,
            owner=current_user,
            team_id=team_id,
            email=payload.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TeamInviteResponse.model_validate(invite)


@router.delete("/{team_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_team_invite(
    team_id: str,
    invite_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = TeamService()
    try:
        await service.cancel_invite(
            db=db,
            owner=current_user,
            team_id=team_id,
            invite_id=invite_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/invites/{invite_token}", response_model=TeamInviteAccessResponse)
async def get_team_invite(
    invite_token: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict | None = Depends(get_optional_current_user),
) -> TeamInviteAccessResponse:
    service = TeamService()
    invite = await service.get_invite_access(db=db, invite_token=invite_token, user=current_user)
    return TeamInviteAccessResponse.model_validate(invite)


@router.post("/invites/{invite_token}/accept", response_model=TeamResponse)
async def accept_team_invite(
    invite_token: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> TeamResponse:
    service = TeamService()
    try:
        team = await service.accept_invite(db=db, invite_token=invite_token, user=current_user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TeamResponse.model_validate(team)


@router.get("/shared-meetings")
async def list_shared_team_meetings(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> dict[str, list[dict]]:
    service = TeamService()
    items = await service.list_shared_meetings(db=db, user=current_user)
    return {"items": items}
