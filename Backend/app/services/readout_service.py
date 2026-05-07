import json
import re
import uuid
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.schemas.readout import ReadoutGenerateRequest, ReadoutListResponse, ReadoutResponse, ReadoutSourceCount
from app.services.external_search_service import ExternalSearchService
from app.services.ollama_service import OllamaService


class ReadoutService:
    def __init__(self) -> None:
        self.external_search = ExternalSearchService()
        self.ollama = OllamaService()

    async def list_readouts(self, *, db: AsyncIOMotorDatabase, owner: dict) -> ReadoutListResponse:
        documents = await db["readouts"].find({"owner_id": owner["id"]}).sort("created_at", -1).to_list(length=20)
        return ReadoutListResponse(items=[ReadoutResponse.model_validate(document) for document in documents])

    async def generate_readout(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        payload: ReadoutGenerateRequest,
    ) -> ReadoutResponse:
        timeframe = payload.timeframe if payload.timeframe in {"24h", "3d", "7d"} else "24h"
        requested_sources = [source for source in payload.sources if source in {"gmail", "slack"}]
        sources = requested_sources or ["gmail", "slack"]
        max_items_per_source = max(1, min(payload.max_items_per_source, 12))
        since = self._resolve_since(timeframe)

        notices: list[str] = []
        gmail_items: list[dict] = []
        slack_items: list[dict] = []

        if "gmail" in sources:
            gmail_items, gmail_notice = await self.external_search.get_recent_gmail_messages(
                db=db,
                owner=owner,
                since=since,
                limit=max_items_per_source,
            )
            if gmail_notice:
                notices.append(gmail_notice)

        if "slack" in sources:
            slack_items, slack_notice = await self.external_search.get_recent_slack_messages(
                owner=owner,
                since=since,
                limit=max_items_per_source,
            )
            if slack_notice:
                notices.append(slack_notice)

        source_counts = [
            ReadoutSourceCount(source="gmail", label="Gmail", count=len(gmail_items)),
            ReadoutSourceCount(source="slack", label="Slack", count=len(slack_items)),
        ]

        if not gmail_items and not slack_items:
            fallback = ReadoutResponse(
                id=str(uuid.uuid4()),
                timeframe=timeframe,
                sources=sources,
                title="No recent activity to summarize",
                summary="Notable couldn’t find recent Gmail or Slack activity for this timeframe. Reconnect the source in Settings or widen the timeframe and try again.",
                key_points=["No recent messages were available from the selected connected sources."],
                action_items=[],
                suggested_replies=[],
                source_counts=source_counts,
                notices=notices,
                created_at=datetime.now(timezone.utc),
            )
            fallback_document = fallback.model_dump()
            fallback_document["owner_id"] = owner["id"]
            await db["readouts"].insert_one(fallback_document)
            return fallback

        generated = await self._generate_with_model(
            timeframe=timeframe,
            sources=sources,
            gmail_items=gmail_items,
            slack_items=slack_items,
        )

        readout = ReadoutResponse(
            id=str(uuid.uuid4()),
            timeframe=timeframe,
            sources=sources,
            title=generated.get("title") or self._fallback_title(timeframe=timeframe, sources=sources),
            summary=generated.get("summary") or self._fallback_summary(gmail_items=gmail_items, slack_items=slack_items, timeframe=timeframe),
            key_points=self._normalize_list(generated.get("key_points")),
            action_items=self._normalize_list(generated.get("action_items")),
            suggested_replies=self._normalize_list(generated.get("suggested_replies")),
            source_counts=source_counts,
            notices=notices,
            created_at=datetime.now(timezone.utc),
        )

        if not readout.key_points:
            readout.key_points = self._fallback_key_points(gmail_items=gmail_items, slack_items=slack_items)

        readout_document = readout.model_dump()
        readout_document["owner_id"] = owner["id"]
        await db["readouts"].insert_one(readout_document)
        return readout

    async def _generate_with_model(
        self,
        *,
        timeframe: str,
        sources: list[str],
        gmail_items: list[dict],
        slack_items: list[dict],
    ) -> dict:
        system_prompt = (
            "You create crisp executive readouts for inbox and chat activity. "
            "Return strict JSON with keys: title, summary, key_points, action_items, suggested_replies. "
            "summary should be a short markdown block with 1-2 paragraphs. "
            "key_points, action_items, suggested_replies must each be arrays of short strings. "
            "Be specific, avoid hallucinating details, and only use the provided source material."
        )
        user_prompt = (
            f"Timeframe: {timeframe}\n"
            f"Sources: {', '.join(sources)}\n\n"
            f"Gmail items:\n{self._format_gmail_items(gmail_items)}\n\n"
            f"Slack items:\n{self._format_slack_items(slack_items)}\n"
        )
        raw = await self.ollama.chat(system_prompt, user_prompt)
        parsed = self._parse_json_object(raw)
        return parsed if isinstance(parsed, dict) else {}

    def _parse_json_object(self, raw: str) -> dict:
        cleaned = (raw or "").strip()
        if not cleaned:
            return {}

        fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
        candidate = fenced.group(1) if fenced else cleaned
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            brace_match = re.search(r"(\{.*\})", candidate, re.DOTALL)
            if not brace_match:
                return {}
            try:
                data = json.loads(brace_match.group(1))
            except json.JSONDecodeError:
                return {}
        return data if isinstance(data, dict) else {}

    def _fallback_title(self, *, timeframe: str, sources: list[str]) -> str:
        source_label = " and ".join(source.title() for source in sources)
        return f"{source_label} readout for the last {timeframe}"

    def _fallback_summary(self, *, gmail_items: list[dict], slack_items: list[dict], timeframe: str) -> str:
        return (
            f"Here’s your readout for the last {timeframe}. "
            f"Notable reviewed {len(gmail_items)} recent Gmail messages and {len(slack_items)} recent Slack messages, "
            "then pulled out the threads that look most likely to need attention."
        )

    def _fallback_key_points(self, *, gmail_items: list[dict], slack_items: list[dict]) -> list[str]:
        points: list[str] = []
        if gmail_items:
            points.append(f"Gmail is active with {len(gmail_items)} recent messages that may need follow-up.")
            points.extend(
                [f"Email thread: {item.get('subject') or '(no subject)'}" for item in gmail_items[:2]]
            )
        if slack_items:
            points.append(f"Slack has {len(slack_items)} recent messages in active channels.")
            points.extend(
                [f"Slack thread in #{item.get('channel_name') or 'unknown-channel'}" for item in slack_items[:2]]
            )
        return points[:5]

    def _normalize_list(self, value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        items = [str(item).strip() for item in value if str(item).strip()]
        return items[:6]

    def _resolve_since(self, timeframe: str) -> datetime:
        now = datetime.now(timezone.utc)
        if timeframe == "7d":
            return now - timedelta(days=7)
        if timeframe == "3d":
            return now - timedelta(days=3)
        return now - timedelta(hours=24)

    def _format_gmail_items(self, items: list[dict]) -> str:
        if not items:
            return "(none)"
        lines: list[str] = []
        for item in items:
            lines.append(
                "\n".join(
                    [
                        f"Subject: {item.get('subject') or '(no subject)'}",
                        f"From: {item.get('from') or 'Unknown sender'}",
                        f"Date: {item.get('date') or '(unknown date)'}",
                        f"Snippet: {item.get('snippet') or '(no snippet)'}",
                    ]
                )
            )
        return "\n\n".join(lines)

    def _format_slack_items(self, items: list[dict]) -> str:
        if not items:
            return "(none)"
        lines: list[str] = []
        for item in items:
            lines.append(
                "\n".join(
                    [
                        f"Channel: #{item.get('channel_name') or 'unknown-channel'}",
                        f"Sender: {item.get('username') or 'Unknown user'}",
                        f"Time: {item.get('ts') or '(unknown time)'}",
                        f"Text: {item.get('text') or '(no text)'}",
                    ]
                )
            )
        return "\n\n".join(lines)
