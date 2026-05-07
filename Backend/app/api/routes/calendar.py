from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.calendar import CalendarEventCreateRequest, CalendarEventCreateResponse, CalendarEventListResponse
from app.services.google_service import GoogleCalendarService

router = APIRouter()


@router.get("/events", response_model=CalendarEventListResponse)
async def list_calendar_events(
    time_min: datetime | None = Query(default=None),
    time_max: datetime | None = Query(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> CalendarEventListResponse:
    service = GoogleCalendarService()
    try:
        events = await service.list_events(db=db, user=current_user, time_min=time_min, time_max=time_max)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Google Calendar request failed.",
        ) from exc

    return CalendarEventListResponse(events=events)


@router.post("/events", response_model=CalendarEventCreateResponse)
async def create_calendar_event(
    payload: CalendarEventCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> CalendarEventCreateResponse:
    if payload.end <= payload.start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time.")
    if payload.start < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Meetings can only be created for now or a future time.")

    service = GoogleCalendarService()
    try:
        event = await service.create_event(
            db=db,
            user=current_user,
            title=payload.title,
            description=payload.description,
            start=payload.start,
            end=payload.end,
            attendees=payload.attendees,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Google Calendar event creation failed.",
        ) from exc

    return CalendarEventCreateResponse(event=event)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_event(
    event_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = GoogleCalendarService()
    try:
        await service.delete_event(db=db, user=current_user, event_id=event_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == status.HTTP_404_NOT_FOUND:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar event not found.") from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Google Calendar event deletion failed.",
        ) from exc
