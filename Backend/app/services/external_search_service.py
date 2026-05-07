import re
from datetime import datetime, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.google_service import GoogleWorkspaceService

GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly"


class ExternalSearchService:
    def __init__(self) -> None:
        self.google = GoogleWorkspaceService()

    async def build_global_search_context(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        query: str,
    ) -> tuple[list[str], list[str], list[str]]:
        context_sections: list[str] = []
        context_used: list[str] = []
        notices: list[str] = []

        gmail_results, gmail_notice = await self._search_gmail(db=db, owner=owner, query=query)
        if gmail_results:
            context_sections.append(self._format_gmail_results(gmail_results))
            context_used.append("Gmail")
        elif gmail_notice:
            notices.append(gmail_notice)

        docs_results, docs_notice = await self._search_google_docs(db=db, owner=owner, query=query)
        if docs_results:
            context_sections.append(self._format_google_docs_results(docs_results))
            context_used.append("Google Docs")
        elif docs_notice:
            notices.append(docs_notice)

        slack_results, slack_notice = await self._search_slack_messages(owner=owner, query=query)
        if slack_results:
            context_sections.append(self._format_slack_results(slack_results))
            context_used.append("Slack")
        elif slack_notice:
            notices.append(slack_notice)

        return context_sections, context_used, notices

    async def get_connection_status(self, *, owner: dict) -> dict:
        granted_scopes = set(_normalize_scopes(owner.get("google_granted_scopes")))
        google_connected = bool(owner.get("google_access_token") or owner.get("google_refresh_token"))
        return {
            "google_connected": google_connected,
            "gmail_connected": google_connected and (
                GMAIL_READONLY_SCOPE in granted_scopes or not granted_scopes
            ),
            "google_docs_connected": google_connected and (
                DRIVE_READONLY_SCOPE in granted_scopes or not granted_scopes
            ),
            "slack_connected": bool(owner.get("slack_user_token")),
            "slack_workspace_name": owner.get("slack_team_name"),
            "notes": self._build_connection_notes(owner=owner, granted_scopes=granted_scopes),
        }

    async def validate_slack_token(self, token: str) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {token}"},
            )
            response.raise_for_status()
            payload = response.json()

        if not payload.get("ok"):
            raise ValueError(payload.get("error") or "Slack rejected the token.")

        return payload

    async def get_recent_gmail_messages(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        since: datetime,
        limit: int = 8,
    ) -> tuple[list[dict], str | None]:
        if not (owner.get("google_access_token") or owner.get("google_refresh_token")):
            return [], None

        try:
            access_token = await self.google.ensure_valid_access_token(db=db, user=owner)
        except ValueError:
            return [], "Reconnect Google in Settings to let Readouts read Gmail."

        newer_than_days = max(1, int((datetime.now(timezone.utc) - since).total_seconds() // 86400) + 1)
        query_candidates = [
            f"in:inbox newer_than:{newer_than_days}d -category:promotions -category:social -category:forums",
            f"in:inbox newer_than:{newer_than_days}d",
            f"newer_than:{newer_than_days}d",
        ]

        async with httpx.AsyncClient(timeout=30) as client:
            message_refs: list[dict] = []
            for query in query_candidates:
                response = await self._gmail_get(
                    client,
                    db=db,
                    owner=owner,
                    access_token=access_token,
                    url="https://gmail.googleapis.com/gmail/v1/users/me/messages",
                    params={"q": query, "maxResults": max(limit * 3, 12)},
                )
                if response.status_code == 403:
                    return [], "Reconnect Google in Settings to let Readouts read Gmail."
                response.raise_for_status()
                payload = response.json()
                message_refs = payload.get("messages", []) or []
                if message_refs:
                    break

            if not message_refs:
                response = await self._gmail_get(
                    client,
                    db=db,
                    owner=owner,
                    access_token=access_token,
                    url="https://gmail.googleapis.com/gmail/v1/users/me/messages",
                    params={"labelIds": "INBOX", "maxResults": max(limit * 4, 20)},
                )
                if response.status_code == 403:
                    return [], "Reconnect Google in Settings to let Readouts read Gmail."
                response.raise_for_status()
                payload = response.json()
                message_refs = payload.get("messages", []) or []

            messages: list[dict] = []
            seen_message_ids: set[str] = set()
            for item in message_refs:
                message_id = str(item.get("id") or "").strip()
                if not message_id or message_id in seen_message_ids:
                    continue
                seen_message_ids.add(message_id)

                detail_response = await self._gmail_get(
                    client,
                    db=db,
                    owner=owner,
                    access_token=access_token,
                    url=f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
                    params=[
                        ("format", "metadata"),
                        ("metadataHeaders", "Subject"),
                        ("metadataHeaders", "From"),
                        ("metadataHeaders", "Date"),
                        ("metadataHeaders", "To"),
                    ],
                )
                if detail_response.status_code >= 400:
                    continue

                detail = detail_response.json()
                internal_date = _timestamp_millis_to_datetime(detail.get("internalDate"))
                if internal_date and internal_date < since:
                    continue

                headers = {
                    header.get("name", "").lower(): header.get("value", "")
                    for header in detail.get("payload", {}).get("headers", [])
                }
                messages.append(
                    {
                        "id": detail.get("id"),
                        "thread_id": detail.get("threadId"),
                        "subject": headers.get("subject") or "(no subject)",
                        "from": headers.get("from") or "Unknown sender",
                        "to": headers.get("to") or "",
                        "date": internal_date.isoformat() if internal_date else _timestamp_millis_to_iso(detail.get("internalDate")),
                        "snippet": detail.get("snippet") or "",
                        "label_ids": [str(label) for label in detail.get("labelIds", []) if str(label).strip()],
                    }
                )
                if len(messages) >= limit:
                    break

        messages.sort(key=lambda item: _datetime_sort_key(item.get("date")), reverse=True)
        return messages[:limit], None

    async def get_recent_slack_messages(
        self,
        *,
        owner: dict,
        since: datetime,
        limit: int = 8,
    ) -> tuple[list[dict], str | None]:
        token = owner.get("slack_user_token")
        if not token:
            return [], None

        query = f"after:{since.strftime('%Y-%m-%d')}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://slack.com/api/search.messages",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "query": query,
                    "count": limit,
                    "sort": "timestamp",
                    "sort_dir": "desc",
                    "highlight": "false",
                },
            )
            response.raise_for_status()
            payload = response.json()

        if not payload.get("ok"):
            error = payload.get("error") or "Slack search failed."
            if error in {"missing_scope", "not_authed", "invalid_auth", "account_inactive"}:
                return [], "Reconnect Slack in Settings with a user token that has the search:read scope."
            return [], None

        matches = payload.get("messages", {}).get("matches", [])
        results = []
        for match in matches[:limit]:
            channel = match.get("channel") or {}
            results.append(
                {
                    "channel_name": channel.get("name") or "unknown-channel",
                    "username": match.get("username") or match.get("user") or "Unknown user",
                    "text": match.get("text") or "",
                    "permalink": match.get("permalink"),
                    "ts": _slack_ts_to_iso(match.get("ts")),
                }
            )
        return results, None

    async def _search_gmail(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        query: str,
    ) -> tuple[list[dict], str | None]:
        if not (owner.get("google_access_token") or owner.get("google_refresh_token")):
            return [], None

        try:
            access_token = await self.google.ensure_valid_access_token(db=db, user=owner)
        except ValueError:
            return [], "Reconnect Google in Settings to let Search Copilot read Gmail."

        params = {
            "q": query.strip(),
            "maxResults": 5,
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
            if response.status_code == 403:
                return [], "Reconnect Google in Settings to let Search Copilot read Gmail."
            response.raise_for_status()
            payload = response.json()

            messages: list[dict] = []
            for item in payload.get("messages", [])[:4]:
                detail_response = await client.get(
                    f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{item['id']}",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=[
                        ("format", "metadata"),
                        ("metadataHeaders", "Subject"),
                        ("metadataHeaders", "From"),
                        ("metadataHeaders", "Date"),
                    ],
                )
                if detail_response.status_code >= 400:
                    continue
                detail = detail_response.json()
                headers = {
                    header.get("name", "").lower(): header.get("value", "")
                    for header in detail.get("payload", {}).get("headers", [])
                }
                internal_date = detail.get("internalDate")
                messages.append(
                    {
                        "id": detail.get("id"),
                        "subject": headers.get("subject") or "(no subject)",
                        "from": headers.get("from") or "Unknown sender",
                        "date": _timestamp_millis_to_iso(internal_date),
                        "snippet": detail.get("snippet") or "",
                    }
                )

        return messages, None

    async def _search_google_docs(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        query: str,
    ) -> tuple[list[dict], str | None]:
        if not (owner.get("google_access_token") or owner.get("google_refresh_token")):
            return [], None

        try:
            access_token = await self.google.ensure_valid_access_token(db=db, user=owner)
        except ValueError:
            return [], "Reconnect Google in Settings to let Search Copilot read Google Docs."

        search_query = _build_drive_query(query)
        if not search_query:
            return [], None

        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.get(
                "https://www.googleapis.com/drive/v3/files",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "q": search_query,
                    "pageSize": 4,
                    "orderBy": "modifiedTime desc",
                    "fields": "files(id,name,modifiedTime,webViewLink,mimeType)",
                },
            )
            if response.status_code == 403:
                return [], "Reconnect Google in Settings to let Search Copilot read Google Docs."
            response.raise_for_status()
            payload = response.json()

            docs: list[dict] = []
            for file_item in payload.get("files", []):
                export_response = await client.get(
                    f"https://www.googleapis.com/drive/v3/files/{file_item['id']}/export",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params={"mimeType": "text/plain"},
                )
                if export_response.status_code >= 400:
                    continue
                text = export_response.text.strip()
                docs.append(
                    {
                        "id": file_item.get("id"),
                        "name": file_item.get("name") or "Untitled document",
                        "modified_time": file_item.get("modifiedTime"),
                        "web_view_link": file_item.get("webViewLink"),
                        "excerpt": _trim_text(text, 900),
                    }
                )

        return docs, None

    async def _search_slack_messages(
        self,
        *,
        owner: dict,
        query: str,
    ) -> tuple[list[dict], str | None]:
        token = owner.get("slack_user_token")
        if not token:
            return [], None

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                "https://slack.com/api/search.messages",
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "query": query.strip(),
                    "count": 5,
                    "sort": "timestamp",
                    "sort_dir": "desc",
                    "highlight": "false",
                },
            )
            response.raise_for_status()
            payload = response.json()

        if not payload.get("ok"):
            error = payload.get("error") or "Slack search failed."
            if error in {"missing_scope", "not_authed", "invalid_auth", "account_inactive"}:
                return [], "Reconnect Slack in Settings with a user token that has the search:read scope."
            return [], None

        matches = payload.get("messages", {}).get("matches", [])
        results = []
        for match in matches[:4]:
            channel = match.get("channel") or {}
            username = match.get("username") or match.get("user") or "Unknown user"
            results.append(
                {
                    "channel_name": channel.get("name") or "unknown-channel",
                    "username": username,
                    "text": match.get("text") or "",
                    "permalink": match.get("permalink"),
                    "ts": _slack_ts_to_iso(match.get("ts")),
                }
            )
        return results, None

    def _build_connection_notes(self, *, owner: dict, granted_scopes: set[str]) -> list[str]:
        notes: list[str] = []
        if (owner.get("google_access_token") or owner.get("google_refresh_token")) and granted_scopes and (
            GMAIL_READONLY_SCOPE not in granted_scopes or DRIVE_READONLY_SCOPE not in granted_scopes
        ):
            notes.append("Google is connected, but some Gmail or Google Docs permissions may still need a reconnect.")
        if owner.get("slack_user_token"):
            notes.append("Slack search is powered by your connected user token.")
        else:
            notes.append("Connect Slack with a user token that has the search:read scope to include Slack in Search Copilot.")
        return notes

    def _format_gmail_results(self, results: list[dict]) -> str:
        lines = ["Relevant Gmail messages:"]
        for item in results:
            lines.append(
                "\n".join(
                    [
                        f"- Subject: {item['subject']}",
                        f"  From: {item['from']}",
                        f"  Date: {item['date'] or '(unknown date)'}",
                        f"  Snippet: {item['snippet'] or '(no snippet)'}",
                    ]
                )
            )
        return "\n".join(lines)

    def _format_google_docs_results(self, results: list[dict]) -> str:
        lines = ["Relevant Google Docs:"]
        for item in results:
            lines.append(
                "\n".join(
                    [
                        f"- Title: {item['name']}",
                        f"  Updated: {item['modified_time'] or '(unknown time)'}",
                        f"  Excerpt: {item['excerpt'] or '(no exported text)'}",
                        f"  Link: {item['web_view_link'] or '(no link)'}",
                    ]
                )
            )
        return "\n".join(lines)

    def _format_slack_results(self, results: list[dict]) -> str:
        lines = ["Relevant Slack messages:"]
        for item in results:
            lines.append(
                "\n".join(
                    [
                        f"- Channel: #{item['channel_name']}",
                        f"  Sender: {item['username']}",
                        f"  Time: {item['ts'] or '(unknown time)'}",
                        f"  Text: {item['text'] or '(no text)'}",
                        f"  Permalink: {item['permalink'] or '(no link)'}",
                    ]
                )
            )
        return "\n".join(lines)

    async def _gmail_get(
        self,
        client: httpx.AsyncClient,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        access_token: str,
        url: str,
        params: dict | list[tuple[str, str]],
    ) -> httpx.Response:
        response = await client.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
        )
        if response.status_code == 401:
            refreshed_token = await self.google._refresh_google_access_token(db=db, user=owner)
            response = await client.get(
                url,
                headers={"Authorization": f"Bearer {refreshed_token}"},
                params=params,
            )
        return response


def _normalize_scopes(raw_scopes: object) -> list[str]:
    if isinstance(raw_scopes, list):
        return [str(scope).strip() for scope in raw_scopes if str(scope).strip()]
    if isinstance(raw_scopes, str):
        return [scope.strip() for scope in raw_scopes.split(",") if scope.strip()]
    return []


def _timestamp_millis_to_iso(raw_value: object) -> str | None:
    parsed = _timestamp_millis_to_datetime(raw_value)
    return parsed.isoformat() if parsed else None


def _timestamp_millis_to_datetime(raw_value: object) -> datetime | None:
    if raw_value is None:
        return None
    try:
        millis = int(str(raw_value))
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc)


def _slack_ts_to_iso(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    try:
        seconds = float(str(raw_value))
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def _datetime_sort_key(raw_value: object) -> float:
    if isinstance(raw_value, str):
        try:
            return datetime.fromisoformat(raw_value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0.0
    if isinstance(raw_value, datetime):
        return raw_value.timestamp()
    return 0.0


def _trim_text(value: str, max_length: int) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= max_length:
        return compact
    return compact[: max_length - 1].rstrip() + "…"


def _build_drive_query(query: str) -> str:
    tokens = [
        _escape_drive_query_token(token)
        for token in re.findall(r"[A-Za-z0-9@._-]+", query.lower())
        if len(token) >= 3 and token.lower() not in {"what", "about", "could", "please", "with", "from", "that", "this"}
    ]
    tokens = tokens[:4]
    if not tokens:
        return ""

    search_parts = [
        f"name contains '{token}' or fullText contains '{token}'"
        for token in tokens
    ]
    return (
        "trashed = false and mimeType = 'application/vnd.google-apps.document' and ("
        + " or ".join(search_parts)
        + ")"
    )


def _escape_drive_query_token(token: str) -> str:
    return token.replace("\\", "\\\\").replace("'", "\\'")
