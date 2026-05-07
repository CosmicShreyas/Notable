from datetime import datetime, timedelta, timezone
import uuid

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.schemas.calendar import CalendarEventResponse


class GoogleOAuthService:
    async def exchange_code_for_tokens(self, code: str) -> dict:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("Google OAuth is not configured in environment variables")

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            return response.json()

    async def refresh_access_token(self, refresh_token: str) -> dict:
        if not settings.google_client_id or not settings.google_client_secret:
            raise ValueError("Google OAuth is not configured in environment variables")

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            response.raise_for_status()
            return response.json()

    async def fetch_user_profile(self, access_token: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://openidconnect.googleapis.com/v1/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()


class GoogleWorkspaceService:
    async def ensure_valid_access_token(self, db: AsyncIOMotorDatabase, user: dict) -> str:
        expires_at = _coerce_utc_datetime(user.get("google_token_expires_at"))
        now = datetime.now(timezone.utc)

        if not expires_at or expires_at <= now + timedelta(minutes=1):
            return await self._refresh_google_access_token(db=db, user=user)

        access_token = user.get("google_access_token")
        if not access_token:
            raise ValueError("Google account is not connected for this user.")

        return access_token

    async def _refresh_google_access_token(self, db: AsyncIOMotorDatabase, user: dict) -> str:
        refresh_token = user.get("google_refresh_token")
        if not refresh_token:
            raise ValueError("Google session expired. Please sign in with Google again.")

        oauth = GoogleOAuthService()
        token_data = await oauth.refresh_access_token(refresh_token=refresh_token)

        new_access_token = token_data.get("access_token")
        if not new_access_token:
            raise ValueError("Google token refresh did not return a new access token.")

        refreshed_at = datetime.now(timezone.utc)
        expires_in_seconds = int(token_data.get("expires_in", 3600))
        update_fields = {
            "google_access_token": new_access_token,
            "google_token_expires_at": refreshed_at + timedelta(seconds=expires_in_seconds),
            "updated_at": refreshed_at,
        }

        if token_data.get("refresh_token"):
            update_fields["google_refresh_token"] = token_data["refresh_token"]
            user["google_refresh_token"] = token_data["refresh_token"]

        await db["users"].update_one({"id": user["id"]}, {"$set": update_fields})

        user["google_access_token"] = new_access_token
        user["google_token_expires_at"] = update_fields["google_token_expires_at"]
        user["updated_at"] = refreshed_at

        return new_access_token


class GoogleCalendarService(GoogleWorkspaceService):
    async def list_events(
        self,
        db: AsyncIOMotorDatabase,
        user: dict,
        *,
        time_min: datetime | None = None,
        time_max: datetime | None = None,
        max_results: int = 250,
    ) -> list[CalendarEventResponse]:
        if not user.get("google_access_token"):
            return []

        access_token = await self.ensure_valid_access_token(db=db, user=user)
        now = datetime.now(timezone.utc)
        request_time_min = time_min or (now - timedelta(hours=12))
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "timeMin": request_time_min.isoformat().replace("+00:00", "Z"),
                    "maxResults": max(1, min(max_results, 2500)),
                    **(
                        {"timeMax": time_max.isoformat().replace("+00:00", "Z")}
                        if time_max
                        else {}
                    ),
                },
            )
            if response.status_code == 401:
                access_token = await self._refresh_google_access_token(db=db, user=user)
                response = await client.get(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={
                        "singleEvents": "true",
                        "orderBy": "startTime",
                        "timeMin": request_time_min.isoformat().replace("+00:00", "Z"),
                        "maxResults": max(1, min(max_results, 2500)),
                        **(
                            {"timeMax": time_max.isoformat().replace("+00:00", "Z")}
                            if time_max
                            else {}
                        ),
                    },
                )

            response.raise_for_status()
            data = response.json()

        events: list[CalendarEventResponse] = []
        for item in data.get("items", []):
            description = item.get("description")
            hangout_link = item.get("hangoutLink")
            conference = item.get("conferenceData", {})
            entry_points = conference.get("entryPoints", [])
            start = _parse_google_datetime(item.get("start", {}))
            end = _parse_google_datetime(item.get("end", {}))

            # Skip meetings that have already ended so the list focuses on active/upcoming calls.
            if end and end < now:
                continue

            join_url = hangout_link or next(
                (
                    entry.get("uri")
                    for entry in entry_points
                    if entry.get("entryPointType") in {"video", "more"}
                ),
                None,
            )

            events.append(
                CalendarEventResponse(
                    id=item["id"],
                    title=item.get("summary", "Untitled event"),
                    description=description,
                    start=start,
                    end=end,
                    join_url=join_url,
                    html_link=item.get("htmlLink"),
                )
            )

        events.sort(
            key=lambda event: (
                0
                if event.start and event.end and event.start <= now <= event.end
                else 1,
                event.start or datetime.max.replace(tzinfo=timezone.utc),
            )
        )

        return events

    async def create_event(
        self,
        *,
        db: AsyncIOMotorDatabase,
        user: dict,
        title: str,
        description: str | None,
        start: datetime,
        end: datetime,
        attendees: list[str] | None = None,
    ) -> CalendarEventResponse:
        if not user.get("google_access_token"):
            raise ValueError("Google Calendar is not connected for this user.")

        access_token = await self.ensure_valid_access_token(db=db, user=user)
        attendee_payload = [{"email": email} for email in (attendees or []) if email]
        payload = {
            "summary": title,
            "description": description,
            "start": {
                "dateTime": start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "timeZone": "UTC",
            },
            "end": {
                "dateTime": end.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                "timeZone": "UTC",
            },
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }
        if attendee_payload:
            payload["attendees"] = attendee_payload

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"conferenceDataVersion": 1, "sendUpdates": "all"},
                json=payload,
            )
            if response.status_code == 401:
                access_token = await self._refresh_google_access_token(db=db, user=user)
                response = await client.post(
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"conferenceDataVersion": 1, "sendUpdates": "all"},
                    json=payload,
                )

            response.raise_for_status()
            item = response.json()

        conference = item.get("conferenceData", {})
        entry_points = conference.get("entryPoints", [])
        join_url = item.get("hangoutLink") or next(
            (
                entry.get("uri")
                for entry in entry_points
                if entry.get("entryPointType") in {"video", "more"}
            ),
            None,
        )

        return CalendarEventResponse(
            id=item["id"],
            title=item.get("summary", title),
            description=item.get("description"),
            start=_parse_google_datetime(item.get("start", {})),
            end=_parse_google_datetime(item.get("end", {})),
            join_url=join_url,
            html_link=item.get("htmlLink"),
        )

    async def delete_event(
        self,
        *,
        db: AsyncIOMotorDatabase,
        user: dict,
        event_id: str,
    ) -> None:
        if not user.get("google_access_token"):
            raise ValueError("Google Calendar is not connected for this user.")

        access_token = await self.ensure_valid_access_token(db=db, user=user)

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.delete(
                f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"sendUpdates": "all"},
            )
            if response.status_code == 401:
                access_token = await self._refresh_google_access_token(db=db, user=user)
                response = await client.delete(
                    f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"sendUpdates": "all"},
                )

            response.raise_for_status()


def _parse_google_datetime(raw: dict) -> datetime | None:
    value = raw.get("dateTime")
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _coerce_utc_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None

        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return None
