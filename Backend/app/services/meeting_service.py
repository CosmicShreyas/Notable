import json
import logging
import math
import os
import re
import secrets
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.schemas.chat import ChatHistoryResponse, MeetingChatRequest, MeetingChatResponse
from app.schemas.meeting import MeetingResponse
from app.schemas.meeting import (
    MeetingCreateRequest,
    MeetingSummaryRequest,
    MeetingSummaryResponse,
    MeetingUpdateRequest,
)
from app.services.assistant_action_service import AssistantActionService
from app.services.external_search_service import ExternalSearchService
from app.services.email_service import EmailService
from app.services.memory_service import MemoryService
from app.services.ollama_service import OllamaService
from app.services.task_board_service import TaskBoardService
from app.services.vocabulary_service import VocabularyService

logger = logging.getLogger(__name__)


class MeetingService:
    def __init__(self) -> None:
        self.ollama = OllamaService()
        self.memory = MemoryService()
        self.actions = AssistantActionService()
        self.external_search = ExternalSearchService()
        self.vocabulary = VocabularyService()
        self.email = EmailService()
        self.task_board = TaskBoardService()

    async def create_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        payload: MeetingCreateRequest,
    ) -> dict:
        now = datetime.now(timezone.utc)
        meeting = {
            "id": str(uuid.uuid4()),
            "owner_id": owner["id"],
            "title": payload.title,
            "provider": self._detect_provider(payload.source_url),
            "source_url": payload.source_url,
            "scheduled_start": payload.scheduled_start,
            "scheduled_end": payload.scheduled_end,
            "status": "scheduled",
            "summary": None,
            "notes_markdown": payload.notes_markdown,
            "summary_template": payload.summary_template or "office_meeting",
            "transcription_language": payload.transcription_language,
            "participants": payload.participants,
            "ai_chat_enabled": payload.ai_chat_enabled,
            "memory_enabled": payload.memory_enabled,
            "action_items": [],
            "created_at": now,
            "updated_at": now,
        }
        await db["meetings"].insert_one(meeting)
        return meeting

    async def list_meetings(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        search: str | None = None,
        status_filter: str | None = None,
        provider: str | None = None,
        has_summary: bool | None = None,
    ) -> list[dict]:
        filters: dict = {"owner_id": owner["id"]}
        and_filters: list[dict] = []

        if search:
            escaped = re.escape(search.strip())
            if escaped:
                and_filters.append(
                    {
                        "$or": [
                            {"title": {"$regex": escaped, "$options": "i"}},
                            {"notes_markdown": {"$regex": escaped, "$options": "i"}},
                            {"summary": {"$regex": escaped, "$options": "i"}},
                        ]
                    }
                )

        if status_filter:
            filters["status"] = status_filter

        if provider:
            filters["provider"] = provider

        if has_summary is True:
            filters["summary"] = {"$exists": True, "$nin": [None, ""]}
        elif has_summary is False:
            and_filters.append(
                {
                    "$or": [
                        {"summary": {"$exists": False}},
                        {"summary": None},
                        {"summary": ""},
                    ]
                }
            )

        if and_filters:
            filters["$and"] = and_filters

        meetings = await db["meetings"].find(filters).sort("updated_at", -1).to_list(length=200)
        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        if not entries:
            return meetings
        return [self.vocabulary.apply_entries_to_meeting(meeting=item, entries=entries) for item in meetings]

    async def get_meeting(self, db: AsyncIOMotorDatabase, owner: dict, meeting_id: str) -> dict | None:
        meeting = await db["meetings"].find_one({"owner_id": owner["id"], "id": meeting_id})
        if not meeting:
            return None
        meeting["transcript_chunks"] = await db["transcript_chunks"].find({"meeting_id": meeting_id}).sort("sequence_number", 1).to_list(length=10000)
        meeting["chat_messages"] = await db["chat_messages"].find({"meeting_id": meeting_id}).sort("created_at", 1).to_list(length=10000)
        return await self.vocabulary.apply_to_meeting(db=db, owner_id=owner["id"], meeting=meeting)

    async def update_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: MeetingUpdateRequest,
    ) -> dict | None:
        updates = {
            key: value
            for key, value in {
                "title": payload.title,
                "notes_markdown": payload.notes_markdown,
                "status": payload.status,
                "participants": payload.participants,
                "summary_template": payload.summary_template,
                "transcription_language": payload.transcription_language,
            }.items()
            if value is not None
        }
        if not updates:
            return await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)

        updates["updated_at"] = datetime.now(timezone.utc)
        result = await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": updates},
        )
        if result.matched_count == 0:
            return None
        return await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)

    async def delete_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
    ) -> bool:
        meeting = await db["meetings"].find_one({"id": meeting_id, "owner_id": owner["id"]})
        if not meeting:
            return False

        meeting_result = await db["meetings"].delete_one({"id": meeting_id, "owner_id": owner["id"]})
        if meeting_result.deleted_count == 0:
            return False

        await db["transcript_chunks"].delete_many({"meeting_id": meeting_id})
        await db["chat_messages"].delete_many({"meeting_id": meeting_id})
        await db["meeting_shares"].delete_many({"meeting_id": meeting_id, "owner_id": owner["id"]})
        await db["comments"].delete_many(
            {
                "owner_id": owner["id"],
                "$or": [
                    {"meeting_id": meeting_id},
                    {"entity_type": "note", "entity_id": meeting_id},
                    {"entity_type": "action_item", "entity_id": {"$regex": f"^{meeting_id}:action_item:"}},
                ],
            }
        )
        await self.task_board.delete_meeting_tasks(db=db, owner_id=owner["id"], meeting_id=meeting_id)
        self._delete_recording_file(meeting)
        return True

    async def create_or_update_share(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        visibility: str,
    ) -> dict | None:
        meeting = await db["meetings"].find_one({"id": meeting_id, "owner_id": owner["id"]})
        if not meeting:
            return None
        team = None
        if visibility == "team":
            team = await db["teams"].find_one({"owner_id": owner["id"]})
            if not team:
                raise ValueError("Create a team first before using team-only sharing")

        now = datetime.now(timezone.utc)
        existing = await db["meeting_shares"].find_one({"meeting_id": meeting_id, "owner_id": owner["id"]})
        if existing:
            updated = {
                **existing,
                "visibility": visibility,
                "team_id": team["id"] if team else None,
                "updated_at": now,
            }
            await db["meeting_shares"].update_one(
                {"id": existing["id"]},
                {"$set": {"visibility": visibility, "team_id": team["id"] if team else None, "updated_at": now}},
            )
            return updated

        share = {
            "id": str(uuid.uuid4()),
            "meeting_id": meeting_id,
            "owner_id": owner["id"],
            "token": self._generate_share_token(),
            "visibility": visibility,
            "team_id": team["id"] if team else None,
            "created_at": now,
            "updated_at": now,
        }
        await db["meeting_shares"].insert_one(share)
        return share

    async def get_share_by_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
    ) -> dict | None:
        return await db["meeting_shares"].find_one({"meeting_id": meeting_id, "owner_id": owner["id"]})

    async def get_shared_meeting_access(
        self,
        db: AsyncIOMotorDatabase,
        share_token: str,
        viewer: dict | None,
    ) -> dict:
        share = await db["meeting_shares"].find_one({"token": share_token})
        if not share:
            return {
                "status": "not_found",
                "share_token": share_token,
                "visibility": "private",
            }

        owner = await db["users"].find_one({"id": share["owner_id"]})
        meeting = await db["meetings"].find_one({"id": share["meeting_id"], "owner_id": share["owner_id"]})
        if not owner or not meeting:
            return {
                "status": "not_found",
                "share_token": share_token,
                "visibility": share["visibility"],
            }

        is_owner = bool(viewer and viewer.get("id") == owner["id"])
        team = await db["teams"].find_one({"id": share.get("team_id")}) if share.get("team_id") else None

        status = "granted"
        if share["visibility"] == "private" and not is_owner:
            status = "private_blocked"
        elif share["visibility"] == "team":
            if is_owner:
                status = "granted"
            elif not viewer:
                status = "sign_in_required"
            elif not share.get("team_id"):
                status = "team_blocked"
            else:
                membership = await db["team_memberships"].find_one(
                    {"team_id": share["team_id"], "user_id": viewer["id"], "status": "active"}
                )
                if not membership:
                    status = "team_blocked"

        payload = {
            "status": status,
            "share_token": share_token,
            "visibility": share["visibility"],
            "owner_name": owner.get("full_name"),
            "team_domain": self._extract_email_domain(owner.get("email")),
            "team_name": team.get("name") if team else None,
        }

        if status == "granted":
            corrected_meeting = await self.vocabulary.apply_to_meeting(db=db, owner_id=owner["id"], meeting=meeting)
            meeting_payload = {
                "id": corrected_meeting["id"],
                "owner_id": corrected_meeting["owner_id"],
                "title": corrected_meeting["title"],
                "provider": corrected_meeting.get("provider"),
                "source_url": corrected_meeting.get("source_url"),
                "scheduled_start": corrected_meeting.get("scheduled_start"),
                "scheduled_end": corrected_meeting.get("scheduled_end"),
                "status": corrected_meeting.get("status", "completed"),
                "summary": corrected_meeting.get("summary"),
                "notes_markdown": corrected_meeting.get("notes_markdown"),
                "transcription_language": corrected_meeting.get("transcription_language"),
                "participants": corrected_meeting.get("participants") or [],
                "ai_chat_enabled": False,
                "memory_enabled": False,
                "created_at": corrected_meeting.get("created_at"),
                "updated_at": corrected_meeting.get("updated_at"),
            }
            payload["meeting"] = meeting_payload

        return payload

    async def record_shared_meeting_view(
        self,
        db: AsyncIOMotorDatabase,
        share_token: str,
        viewer: dict,
    ) -> None:
        access = await self.get_shared_meeting_access(db=db, share_token=share_token, viewer=viewer)
        meeting = access.get("meeting")
        if access.get("status") != "granted" or not meeting:
            return
        if meeting.get("owner_id") == viewer["id"]:
            return

        now = datetime.now(timezone.utc)
        snapshot = {
            "meeting_id": meeting["id"],
            "title": meeting["title"],
            "summary": meeting.get("summary"),
            "notes_markdown": meeting.get("notes_markdown"),
            "provider": meeting.get("provider"),
            "created_at": meeting.get("created_at"),
            "updated_at": now,
            "owner_name": access.get("owner_name") or "Unknown owner",
            "share_token": share_token,
            "share_url": self._share_url_for_token(share_token),
            "visibility": access.get("visibility") or "link",
            "team_name": access.get("team_name"),
            "viewer_user_id": viewer["id"],
            "owner_id": meeting.get("owner_id"),
            "viewed_at": now,
        }
        await db["shared_meeting_views"].update_one(
            {"viewer_user_id": viewer["id"], "share_token": share_token},
            {
                "$set": snapshot,
                "$setOnInsert": {
                    "id": str(uuid.uuid4()),
                },
            },
            upsert=True,
        )

    async def list_shared_inbox(
        self,
        db: AsyncIOMotorDatabase,
        viewer: dict,
    ) -> list[dict]:
        items = await db["shared_meeting_views"].find(
            {"viewer_user_id": viewer["id"]}
        ).sort("updated_at", -1).to_list(length=200)
        return items

    async def generate_summary(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: MeetingSummaryRequest,
    ) -> MeetingSummaryResponse | None:
        meeting = await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)
        if not meeting:
            return None

        if meeting.get("summary") and not payload.regenerate:
            return MeetingSummaryResponse(
                meeting_id=meeting["id"],
                style=payload.style,
                template=meeting.get("summary_template") or payload.template or "office_meeting",
                summary=meeting["summary"],
                action_items=self._extract_action_items(meeting["summary"]),
                generated_title=meeting.get("title"),
            )

        system_prompt, user_prompt = self._build_summary_prompts(meeting=meeting, payload=payload)

        summary = await self.ollama.chat(system_prompt=system_prompt, user_prompt=user_prompt)
        generated_title = await self._generate_meeting_title(meeting=meeting, summary=summary)
        action_items = self._extract_action_items(summary)
        now = datetime.now(timezone.utc)
        title_to_store = generated_title if self._should_auto_rename(meeting.get("title")) else meeting.get("title")
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {
                "$set": {
                    "summary": summary,
                    "status": "completed",
                    "updated_at": now,
                    "title": title_to_store,
                    "action_items": action_items,
                    "summary_template": payload.template or meeting.get("summary_template") or "office_meeting",
                }
            },
        )
        await self._store_anonymized_summary_sample(
            db=db,
            owner=owner,
            meeting=meeting,
            summary=summary,
            style=payload.style,
        )
        await self.task_board.sync_meeting_action_items(
            db=db,
            owner_id=owner["id"],
            meeting_id=meeting_id,
            meeting_title=title_to_store,
            action_items=action_items,
        )
        self._send_summary_snapshot_email(
            owner=owner,
            meeting={**meeting, "id": meeting_id, "title": title_to_store, "summary_template": payload.template or meeting.get("summary_template") or "office_meeting"},
            summary=summary,
            action_items=action_items,
        )

        return MeetingSummaryResponse(
            meeting_id=meeting["id"],
            style=payload.style,
            template=payload.template or meeting.get("summary_template") or "office_meeting",
            summary=summary,
            action_items=action_items,
            generated_title=title_to_store,
        )

    async def stream_summary(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: MeetingSummaryRequest,
    ) -> AsyncIterator[str] | None:
        meeting = await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)
        if not meeting:
            return None

        system_prompt, user_prompt = self._build_summary_prompts(meeting=meeting, payload=payload)

        async def generator() -> AsyncIterator[str]:
            collected: list[str] = []

            try:
                yield self._sse_event(
                    "start",
                    {
                        "meeting_id": meeting["id"],
                        "style": payload.style,
                        "template": payload.template or meeting.get("summary_template") or "office_meeting",
                    },
                )

                async for chunk in self.ollama.chat_stream(system_prompt=system_prompt, user_prompt=user_prompt):
                    collected.append(chunk)
                    yield self._sse_event("chunk", {"text": chunk})

                summary = "".join(collected).strip()
                generated_title = await self._generate_meeting_title(meeting=meeting, summary=summary)
                action_items = self._extract_action_items(summary)
                now = datetime.now(timezone.utc)
                title_to_store = generated_title if self._should_auto_rename(meeting.get("title")) else meeting.get("title")
                await db["meetings"].update_one(
                    {"id": meeting_id, "owner_id": owner["id"]},
                    {
                        "$set": {
                            "summary": summary,
                            "status": "completed",
                            "updated_at": now,
                            "title": title_to_store,
                            "action_items": action_items,
                            "summary_template": payload.template or meeting.get("summary_template") or "office_meeting",
                        }
                    },
                )
                await self._store_anonymized_summary_sample(
                    db=db,
                    owner=owner,
                    meeting=meeting,
                    summary=summary,
                    style=payload.style,
                )
                await self.task_board.sync_meeting_action_items(
                    db=db,
                    owner_id=owner["id"],
                    meeting_id=meeting_id,
                    meeting_title=title_to_store,
                    action_items=action_items,
                )
                self._send_summary_snapshot_email(
                    owner=owner,
                    meeting={
                        **meeting,
                        "id": meeting_id,
                        "title": title_to_store,
                        "summary_template": payload.template or meeting.get("summary_template") or "office_meeting",
                    },
                    summary=summary,
                    action_items=action_items,
                )
                yield self._sse_event(
                    "done",
                    {
                        "meeting_id": meeting["id"],
                        "style": payload.style,
                        "template": payload.template or meeting.get("summary_template") or "office_meeting",
                        "summary": summary,
                        "action_items": action_items,
                        "generated_title": title_to_store,
                    },
                )
            except Exception as exc:
                yield self._sse_event(
                    "error",
                    {
                        "message": str(exc),
                    },
                )
                yield self._sse_event(
                    "done",
                    {
                        "meeting_id": meeting["id"],
                        "style": payload.style,
                        "template": payload.template or meeting.get("summary_template") or "office_meeting",
                        "summary": "".join(collected).strip(),
                        "action_items": [],
                        "generated_title": meeting.get("title"),
                    },
                )

        return generator()

    async def chat_with_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: MeetingChatRequest,
    ) -> MeetingChatResponse | None:
        meeting = await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)
        if not meeting:
            return None

        action_result = await self.actions.maybe_handle_action(
            db=db,
            owner=owner,
            message=payload.message,
            current_meeting=meeting,
            current_context=payload.client_context,
        )
        if action_result is not None:
            response_text, context_used, executed_actions = action_result
            now = datetime.now(timezone.utc)
            await self._persist_chat_exchange(
                db=db,
                meeting_id=meeting["id"],
                owner_id=owner["id"],
                user_message=payload.message,
                assistant_message=response_text,
                now=now,
            )
            return MeetingChatResponse(
                meeting_id=meeting["id"],
                scope="meeting",
                response=response_text,
                context_used=context_used,
                executed_actions=executed_actions,
            )

        system_prompt, user_prompt, context_used = await self._build_chat_prompts(
            db=db,
            owner=owner,
            meeting=meeting,
            payload=payload,
        )
        response_text = await self.ollama.chat(system_prompt=system_prompt, user_prompt=user_prompt)

        now = datetime.now(timezone.utc)
        await self._persist_chat_exchange(
            db=db,
            meeting_id=meeting["id"],
            owner_id=owner["id"],
            user_message=payload.message,
            assistant_message=response_text,
            now=now,
        )

        return MeetingChatResponse(
            meeting_id=meeting["id"],
            scope="meeting",
            response=response_text,
            context_used=context_used,
            executed_actions=[],
        )

    async def chat_globally(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        payload: MeetingChatRequest,
    ) -> MeetingChatResponse:
        action_result = await self.actions.maybe_handle_action(
            db=db,
            owner=owner,
            message=payload.message,
            current_meeting=None,
            current_context=payload.client_context,
        )
        if action_result is not None:
            response_text, context_used, executed_actions = action_result
            now = datetime.now(timezone.utc)
            await self._persist_chat_exchange(
                db=db,
                meeting_id=None,
                owner_id=owner["id"],
                user_message=payload.message,
                assistant_message=response_text,
                now=now,
                scope="global",
            )
            return MeetingChatResponse(
                meeting_id=None,
                scope="global",
                response=response_text,
                context_used=context_used,
                executed_actions=executed_actions,
            )

        system_prompt, user_prompt, context_used = await self._build_global_chat_prompts(
            db=db,
            owner=owner,
            payload=payload,
        )
        response_text = await self.ollama.chat(system_prompt=system_prompt, user_prompt=user_prompt)
        now = datetime.now(timezone.utc)
        await self._persist_chat_exchange(
            db=db,
            meeting_id=None,
            owner_id=owner["id"],
            user_message=payload.message,
            assistant_message=response_text,
            now=now,
            scope="global",
        )
        return MeetingChatResponse(
            meeting_id=None,
            scope="global",
            response=response_text,
            context_used=context_used,
            executed_actions=[],
        )

    async def get_global_chat_history(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
    ) -> ChatHistoryResponse:
        messages = await db["chat_messages"].find(
            {"owner_id": owner["id"], "scope": "global"}
        ).sort("created_at", 1).to_list(length=1000)
        return ChatHistoryResponse(scope="global", messages=messages)

    async def stream_chat_with_meeting(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: MeetingChatRequest,
    ) -> AsyncIterator[str] | None:
        meeting = await self.get_meeting(db=db, owner=owner, meeting_id=meeting_id)
        if not meeting:
            return None

        action_result = await self.actions.maybe_handle_action(
            db=db,
            owner=owner,
            message=payload.message,
            current_meeting=meeting,
            current_context=payload.client_context,
        )
        if action_result is not None:
            response_text, context_used, executed_actions = action_result

            async def action_generator() -> AsyncIterator[str]:
                now = datetime.now(timezone.utc)
                await self._persist_chat_exchange(
                    db=db,
                    meeting_id=meeting["id"],
                    owner_id=owner["id"],
                    user_message=payload.message,
                    assistant_message=response_text,
                    now=now,
                )
                yield self._sse_event(
                    "start",
                    {
                        "meeting_id": meeting["id"],
                        "context_used": context_used,
                    },
                )
                yield self._sse_event("chunk", {"text": response_text})
                yield self._sse_event(
                    "done",
                    {
                        "meeting_id": meeting["id"],
                        "response": response_text,
                        "context_used": context_used,
                        "executed_actions": executed_actions,
                    },
                )

            return action_generator()

        system_prompt, user_prompt, context_used = await self._build_chat_prompts(
            db=db,
            owner=owner,
            meeting=meeting,
            payload=payload,
        )

        async def generator() -> AsyncIterator[str]:
            collected: list[str] = []

            try:
                yield self._sse_event(
                    "start",
                    {
                        "meeting_id": meeting["id"],
                        "context_used": context_used,
                    },
                )

                async for chunk in self.ollama.chat_stream(system_prompt=system_prompt, user_prompt=user_prompt):
                    collected.append(chunk)
                    yield self._sse_event("chunk", {"text": chunk})

                response_text = "".join(collected).strip()
                now = datetime.now(timezone.utc)
                await self._persist_chat_exchange(
                    db=db,
                    meeting_id=meeting["id"],
                    owner_id=owner["id"],
                    user_message=payload.message,
                    assistant_message=response_text,
                    now=now,
                )
                yield self._sse_event(
                    "done",
                    {
                        "meeting_id": meeting["id"],
                        "response": response_text,
                        "context_used": context_used,
                        "executed_actions": [],
                    },
                )
            except Exception as exc:
                partial = "".join(collected).strip()
                if partial:
                    yield self._sse_event("chunk", {"text": "\n"})
                yield self._sse_event(
                    "error",
                    {
                        "message": str(exc),
                    },
                )
                yield self._sse_event(
                    "done",
                    {
                        "meeting_id": meeting["id"],
                        "response": partial,
                        "context_used": context_used,
                    },
                )

        return generator()

    async def stream_chat_globally(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        payload: MeetingChatRequest,
    ) -> AsyncIterator[str]:
        action_result = await self.actions.maybe_handle_action(
            db=db,
            owner=owner,
            message=payload.message,
            current_meeting=None,
            current_context=payload.client_context,
        )
        if action_result is not None:
            response_text, context_used, executed_actions = action_result

            async def action_generator() -> AsyncIterator[str]:
                now = datetime.now(timezone.utc)
                await self._persist_chat_exchange(
                    db=db,
                    meeting_id=None,
                    owner_id=owner["id"],
                    user_message=payload.message,
                    assistant_message=response_text,
                    now=now,
                    scope="global",
                )
                yield self._sse_event(
                    "start",
                    {
                        "scope": "global",
                        "context_used": context_used,
                    },
                )
                yield self._sse_event("chunk", {"text": response_text})
                yield self._sse_event(
                    "done",
                    {
                        "scope": "global",
                        "response": response_text,
                        "context_used": context_used,
                        "executed_actions": executed_actions,
                    },
                )

            return action_generator()

        system_prompt, user_prompt, context_used = await self._build_global_chat_prompts(
            db=db,
            owner=owner,
            payload=payload,
        )

        async def generator() -> AsyncIterator[str]:
            collected: list[str] = []

            try:
                yield self._sse_event(
                    "start",
                    {
                        "scope": "global",
                        "context_used": context_used,
                    },
                )

                async for chunk in self.ollama.chat_stream(system_prompt=system_prompt, user_prompt=user_prompt):
                    collected.append(chunk)
                    yield self._sse_event("chunk", {"text": chunk})

                response_text = "".join(collected).strip()
                now = datetime.now(timezone.utc)
                await self._persist_chat_exchange(
                    db=db,
                    meeting_id=None,
                    owner_id=owner["id"],
                    user_message=payload.message,
                    assistant_message=response_text,
                    now=now,
                    scope="global",
                )
                yield self._sse_event(
                    "done",
                    {
                        "scope": "global",
                        "response": response_text,
                        "context_used": context_used,
                    },
                )
            except Exception as exc:
                partial = "".join(collected).strip()
                if partial:
                    yield self._sse_event("chunk", {"text": "\n"})
                yield self._sse_event("error", {"message": str(exc)})
                yield self._sse_event(
                    "done",
                    {
                        "scope": "global",
                        "response": partial,
                        "context_used": context_used,
                        "executed_actions": [],
                    },
                )

        return generator()

    def _detect_provider(self, source_url: str | None) -> str | None:
        if not source_url:
            return None

        hostname = urlparse(source_url).hostname or ""
        normalized = hostname.lower()
        if "zoom" in normalized:
            return "zoom"
        if "meet.google" in normalized:
            return "google_meet"
        if "teams" in normalized:
            return "microsoft_teams"
        return "generic"

    def to_response(self, meeting: dict) -> MeetingResponse:
        sanitized = {key: value for key, value in meeting.items() if not key.startswith("_")}
        sanitized.setdefault("participants", [])
        sanitized["playback"] = self._build_playback_payload(sanitized)
        return MeetingResponse.model_validate(sanitized)

    async def get_recording_path(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
    ) -> tuple[Path, str] | None:
        meeting = await db["meetings"].find_one({"id": meeting_id, "owner_id": owner["id"]})
        if not meeting or not meeting.get("recording_available"):
            return None

        recording_path = self._recording_path(meeting)
        if not recording_path.exists():
            return None

        return recording_path, str(meeting.get("recording_mime_type") or "audio/wav")

    def build_share_response(self, meeting_id: str, share: dict) -> dict:
        return {
            "meeting_id": meeting_id,
            "share_token": share["token"],
            "share_url": self._share_url_for_token(share["token"]),
            "visibility": share["visibility"],
            "created_at": share["created_at"],
            "updated_at": share["updated_at"],
        }

    async def _build_chat_prompts(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting: dict,
        payload: MeetingChatRequest,
    ) -> tuple[str, str, list[str]]:
        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        context_lines = [
            f"Meeting title: {meeting['title']}",
            "Current meeting transcript:",
            self._build_transcript_text(meeting.get("transcript_chunks", []), entries=entries) or "(no transcript yet)",
            "Current meeting summary:",
            self.vocabulary.apply_entries_to_text(meeting.get("summary"), entries) or "(no summary yet)",
            "Current notes:",
            self.vocabulary.apply_entries_to_text(meeting.get("notes_markdown"), entries) or "(no notes yet)",
        ]

        recalled = []
        if payload.include_memory and meeting.get("memory_enabled"):
            recalled = await self.memory.recall_relevant_meetings(
                db=db,
                owner_id=owner["id"],
                query=payload.message,
                entries=entries,
            )
            if recalled:
                context_lines.append("Relevant previous meetings:")
                for item in recalled:
                    if item["id"] == meeting["id"]:
                        continue
                    context_lines.append(
                        f"- {self.vocabulary.apply_entries_to_text(item['title'], entries) or item['title']}: "
                        f"{self.vocabulary.apply_entries_to_text(item.get('summary') or item.get('notes_markdown'), entries) or 'No stored memory'}"
                    )

        system_prompt = (
            "You are Notable AI, a professional meeting chat assistant. "
            "You are the AI assistant inside the Notable app. "
            "Respond like a thoughtful, friendly chatbot helping the user understand what happened in a meeting. "
            "Always respond in clear Markdown only, but keep the tone conversational, direct, and helpful. "
            "Answer the user's exact question first instead of pasting the full meeting summary. "
            "Only produce a structured summary when the user explicitly asks for a summary, recap, or action items list. "
            "When useful, explain the answer in plain language and mention what evidence came from the transcript, notes, summary, or memory. "
            "Answer only from the provided transcript, notes, summary, and recalled meeting memory. "
            "If the user asks about your identity, your role, or what you can do in Notable, answer that directly as Notable AI instead of pretending it must come from meeting evidence. "
            "For general greetings or assistant-level questions, respond naturally as the app assistant. "
            "If the answer is not grounded in that context, say so clearly and do not invent details. "
            "Do not use emojis, decorative symbols, or overly formal report-style phrasing unless the user asks for it."
        )
        user_prompt = (
            "\n".join(context_lines)
            + f"\n\nUser question: {payload.message}"
            + "\n\nImportant response rules:\n"
            + "- Give a direct answer to the question.\n"
            + "- If the user is asking who you are or what you do, answer as Notable AI inside the Notable app.\n"
            + "- Do not restate the whole meeting summary unless asked.\n"
            + "- If the user asks what happened, explain it naturally like a chat assistant would.\n"
            + "- If there were no decisions or action items, say that plainly.\n"
        )
        context_used = [meeting["title"]] + [
            self.vocabulary.apply_entries_to_text(item["title"], entries) or item["title"]
            for item in recalled
            if item["id"] != meeting["id"]
        ]
        return system_prompt, user_prompt, context_used

    async def _build_global_chat_prompts(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        payload: MeetingChatRequest,
    ) -> tuple[str, str, list[str]]:
        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        prioritize_latest = self._is_latest_meeting_query(payload.message)
        if prioritize_latest:
            recalled = await db["meetings"].find({"owner_id": owner["id"]}).sort("updated_at", -1).to_list(length=5)
        else:
            recalled = await self.memory.recall_relevant_meetings(
                db=db,
                owner_id=owner["id"],
                query=payload.message,
                limit=6,
                entries=entries,
            )
            if not recalled:
                recalled = await db["meetings"].find({"owner_id": owner["id"]}).sort("updated_at", -1).to_list(length=5)

        context_lines = [
            "You are answering across the user's meetings, notes, summaries, transcripts, Gmail, Google Docs, and Slack when that data is available.",
            "Relevant meetings:",
        ]

        if prioritize_latest:
            context_lines.append(
                "These meetings are ordered from newest to oldest by updated_at. "
                "If the user asks about the latest, newest, most recent, or last meeting, prioritize the first meeting in this list unless they ask to compare multiple meetings."
            )

        for item in recalled:
            transcript_chunks = await db["transcript_chunks"].find({"meeting_id": item["id"]}).sort("sequence_number", 1).to_list(length=50)
            transcript_excerpt = self._build_transcript_text(transcript_chunks, entries=entries)
            context_lines.append(
                "\n".join(
                    [
                        f"Title: {self.vocabulary.apply_entries_to_text(item.get('title'), entries) or 'Untitled meeting'}",
                        f"Updated at: {item.get('updated_at')}",
                        f"Summary: {self.vocabulary.apply_entries_to_text(item.get('summary'), entries) or '(no summary yet)'}",
                        f"Notes: {self.vocabulary.apply_entries_to_text(item.get('notes_markdown'), entries) or '(no notes yet)'}",
                        f"Transcript: {transcript_excerpt or '(no transcript yet)'}",
                    ]
                )
            )

        external_context_sections, external_context_used, external_notices = await self.external_search.build_global_search_context(
            db=db,
            owner=owner,
            query=payload.message,
        )
        if external_context_sections:
            context_lines.append("\nExternal workspace results:")
            context_lines.extend(external_context_sections)
        if external_notices and self._is_external_source_query(payload.message):
            context_lines.append("\nConnection notes:")
            context_lines.extend(f"- {notice}" for notice in external_notices)

        system_prompt = (
            "You are Notable AI, a professional meeting chat assistant. "
            "You are the AI assistant inside the Notable app. "
            "Respond like a thoughtful, friendly chatbot helping the user understand what happened across their meetings and connected workspace sources. "
            "Always respond in clear Markdown only, but keep the tone conversational, direct, and helpful. "
            "Answer the user's exact question first instead of pasting long summaries. "
            "Use the provided meeting context and connected-source context for grounded answers. "
            "When the user asks about the latest, newest, most recent, or last meeting, answer from the newest meeting by updated_at instead of picking an older semantically related meeting. "
            "If the user asks about your identity, your role, or what you can do in Notable, answer that directly as Notable AI. "
            "For general greetings or assistant-level questions, respond naturally as the app assistant. "
            "If a meeting-related answer is ambiguous or not grounded, say so clearly. "
            "If Gmail, Google Docs, or Slack context is relevant, cite the source names in the answer naturally. "
            "Do not use emojis, decorative symbols, or overly formal report-style phrasing unless the user asks for it."
        )
        user_prompt = (
            "\n\n".join(context_lines)
            + f"\n\nUser question: {payload.message}"
            + "\n\nImportant response rules:\n"
            + "- If the user is asking who you are or what you do, answer as Notable AI inside the Notable app.\n"
            + "- Answer globally across meetings unless the user asks about one specific meeting.\n"
            + "- Mention meeting titles when comparing or combining information.\n"
            + "- Mention Gmail, Google Docs, or Slack explicitly when you rely on those sources.\n"
            + "- If multiple meetings conflict, say that clearly instead of blending them.\n"
        )
        context_used = [
            self.vocabulary.apply_entries_to_text(item["title"], entries) or item["title"]
            for item in recalled
            if item.get("title")
        ]
        for source_name in external_context_used:
            if source_name not in context_used:
                context_used.append(source_name)
        return system_prompt, user_prompt, context_used

    def _is_latest_meeting_query(self, message: str) -> bool:
        normalized = " ".join(message.lower().split())
        patterns = [
            r"\blatest meeting\b",
            r"\bnewest meeting\b",
            r"\bmost recent meeting\b",
            r"\blast meeting\b",
            r"\brecent meeting\b",
            r"\bwhat was the latest\b",
            r"\bwhat was the most recent\b",
            r"\bwhat happened in the latest\b",
            r"\bwhat happened in the most recent\b",
        ]
        return any(re.search(pattern, normalized) for pattern in patterns)

    def _is_external_source_query(self, message: str) -> bool:
        normalized = " ".join(message.lower().split())
        return any(keyword in normalized for keyword in ("gmail", "email", "mail", "doc", "docs", "document", "slack"))

    def _build_summary_prompts(
        self,
        meeting: dict,
        payload: MeetingSummaryRequest,
    ) -> tuple[str, str]:
        summary_context = self._resolve_summary_context(meeting)
        source_mode = summary_context["mode"]
        transcript_text = summary_context["transcript"]
        notes_text = summary_context["notes"]
        template_key = payload.template or meeting.get("summary_template") or "office_meeting"
        template = self._get_summary_template_config(template_key)

        system_prompt = (
            "You are Notable AI, a professional summary generator for meetings. "
            "Always respond in polished Markdown only. Produce executive-grade summaries with clear sections, "
            "decisions, risks, action items, and follow-ups. Keep the tone professional and do not invent facts "
            "not present in the transcript or notes. Do not use emojis, decorative symbols, or casual phrasing. "
            "Do not include the meeting title as a heading because the product UI already displays it. "
            "The Notes tab in the product is always the user's manual workspace, so never rewrite or mirror the raw "
            "notes back as a note editor. Only generate the Summary tab output. "
            f"Use the {template['name']} template. Follow these sections in order: {', '.join(template['sections'])}. "
            f"Action item style: {template['action_style']}. "
            f"When a section has no evidence, say so briefly instead of inventing content."
        )

        source_instructions = {
            "transcript_only": (
                "Primary source mode: transcript-only.\n"
                "Generate the summary from the meeting transcript.\n"
                "There are no manual notes to summarize.\n"
            ),
            "notes_only": (
                "Primary source mode: notes-only.\n"
                "There is no meeting transcript available.\n"
                "Turn the user's manual notes into a clean professional meeting summary.\n"
                "Do not quote the notes verbatim unless necessary.\n"
            ),
            "hybrid": (
                "Primary source mode: hybrid.\n"
                "Summarize the spoken meeting from the transcript first.\n"
                "Use the user's manual notes only as supporting context to clarify or reinforce details.\n"
                "Do not let the notes override the transcript unless the transcript is ambiguous.\n"
            ),
            "empty": (
                "Primary source mode: empty.\n"
                "No transcript or notes are available. State clearly that there is not enough content to summarize.\n"
            ),
        }[source_mode]
        expected_sections = "\n- ".join(str(section) for section in template["sections"])

        user_prompt = (
            f"Meeting title: {meeting['title']}\n"
            f"Summary style: {payload.style}\n"
            f"Summary template: {template['name']} ({template_key})\n"
            f"Include action items: {payload.include_action_items}\n\n"
            f"Template guidance:\n{template['guidance']}\n\n"
            f"Expected sections:\n- {expected_sections}\n\n"
            f"{source_instructions}\n"
            f"Manual notes:\n{notes_text or '(none)'}\n\n"
            f"Transcript:\n{transcript_text or '(none)'}\n"
        )
        return system_prompt, user_prompt

    def _get_summary_template_config(self, template_key: str | None) -> dict[str, object]:
        templates: dict[str, dict[str, object]] = {
            "office_meeting": {
                "name": "Office meeting",
                "sections": ["Overview", "Key Points", "Decisions", "Risks", "Action Items", "Follow-up"],
                "action_style": "Use practical owner-ready bullets that call out what needs to happen next.",
                "guidance": (
                    "Summarize the meeting like a polished internal office recap. Highlight what was discussed, "
                    "what decisions landed, where there is risk or ambiguity, and what follow-up work is required."
                ),
            },
            "standup": {
                "name": "Standup",
                "sections": ["Yesterday", "Today", "Blockers", "Dependencies", "Action Items"],
                "action_style": "Keep action items short, operational, and tied to immediate next steps.",
                "guidance": (
                    "Treat the summary like a daily standup readout. Focus on completed work, today's plan, blockers, "
                    "handoffs, and anything the team needs to unblock quickly."
                ),
            },
            "sales_call": {
                "name": "Sales call",
                "sections": ["Prospect Context", "Pain Points", "Buying Signals", "Objections", "Next Steps", "Action Items"],
                "action_style": "Frame action items like CRM follow-ups with a clear sales owner and next move.",
                "guidance": (
                    "Summarize this as a sales conversation. Surface business pains, evaluation signals, stakeholder concerns, "
                    "objections, timing, and the clearest next steps to move the deal forward."
                ),
            },
            "interview": {
                "name": "Interview",
                "sections": ["Candidate Snapshot", "Strengths", "Concerns", "Evidence", "Recommendation", "Action Items"],
                "action_style": "Use hiring-oriented follow-ups such as scorecard updates, debriefs, and next-round actions.",
                "guidance": (
                    "Treat the conversation like an interview evaluation. Capture strengths, concerns, evidence from examples, "
                    "and an honest recommendation grounded in the transcript."
                ),
            },
            "client_review": {
                "name": "Client review",
                "sections": ["Goals", "What Went Well", "Risks", "Client Requests", "Commitments", "Next Steps", "Action Items"],
                "action_style": "Write action items as accountable client follow-through commitments.",
                "guidance": (
                    "Summarize this as a client review. Focus on client goals, progress, open risks, explicit asks, "
                    "promises made, and the next commitments from the team."
                ),
            },
        }
        return templates.get(template_key or "", templates["office_meeting"])

    def _send_summary_snapshot_email(
        self,
        *,
        owner: dict,
        meeting: dict,
        summary: str,
        action_items: list[str],
    ) -> None:
        email = (owner.get("email") or "").strip()
        if not email:
            return
        if owner.get("email_summary_snapshots", True) is False:
            return

        try:
            self.email.ensure_configured()
        except ValueError:
            return

        try:
            template = self._get_summary_template_config(meeting.get("summary_template"))
            subject = f'Your Notable summary is ready: {meeting.get("title") or "Meeting summary"}'
            open_url = f"{settings.frontend_url.rstrip('/')}/notes/{meeting['id']}"
            excerpt = self._summary_email_excerpt(summary)
            html = self._build_summary_snapshot_email_html(
                recipient_name=owner.get("full_name") or "there",
                meeting_title=meeting.get("title") or "Meeting summary",
                meeting_url=open_url,
                summary_excerpt=excerpt,
                action_items=action_items,
                template_name=str(template["name"]),
            )
            text = self._build_summary_snapshot_email_text(
                recipient_name=owner.get("full_name") or "there",
                meeting_title=meeting.get("title") or "Meeting summary",
                meeting_url=open_url,
                summary_excerpt=excerpt,
                action_items=action_items,
                template_name=str(template["name"]),
            )
            self.email.send_html_email(to_email=email, subject=subject, html=html, text=text)
        except Exception:
            logger.exception("Failed to send summary snapshot email", extra={"meeting_id": meeting.get("id"), "owner_id": owner.get("id")})

    def _summary_email_excerpt(self, summary: str, limit: int = 700) -> str:
        plain = re.sub(r"`([^`]*)`", r"\1", summary or "")
        plain = re.sub(r"#+\s*", "", plain)
        plain = re.sub(r"[*_>-]", " ", plain)
        plain = re.sub(r"\[(.*?)\]\((.*?)\)", r"\1", plain)
        plain = re.sub(r"\s+", " ", plain).strip()
        if len(plain) <= limit:
            return plain
        return plain[: limit - 1].rstrip() + "…"

    def _build_summary_snapshot_email_html(
        self,
        *,
        recipient_name: str,
        meeting_title: str,
        meeting_url: str,
        summary_excerpt: str,
        action_items: list[str],
        template_name: str,
    ) -> str:
        action_items_html = "".join(
            f'<li style="margin:0 0 10px 0;line-height:1.7;color:#e4e4e7;">{self._escape_html(item)}</li>'
            for item in action_items[:4]
        ) or '<li style="margin:0;line-height:1.7;color:#a1a1aa;">No action items were extracted yet.</li>'
        return f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#f4f4f5;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:680px;margin:0 auto;padding:40px 20px;">
      <div style="border:1px solid #262626;border-radius:30px;background:#111111;padding:36px;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="height:42px;width:42px;border-radius:12px;background:#f4f4f5;color:#0a0a0a;font-weight:700;font-size:14px;line-height:42px;text-align:center;">N</div>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <div style="font-family:Georgia,serif;font-size:34px;line-height:1;color:#f4f4f5;">Notable</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:28px;color:#a1a1aa;font-size:12px;letter-spacing:.22em;text-transform:uppercase;">Summary snapshot</div>
        <h1 style="margin:14px 0 0;font-family:'Instrument Serif',Georgia,serif;font-size:48px;line-height:1.04;font-weight:400;color:#fafafa;">
          {self._escape_html(meeting_title)}
        </h1>
        <p style="margin:18px 0 0;color:#d4d4d8;font-size:16px;line-height:1.8;">
          Hi {self._escape_html(recipient_name)}, your Notable summary is ready. This snapshot uses the
          <span style="color:#fafafa;">{self._escape_html(template_name)}</span> template so you can quickly remember the shape of the meeting before you dive back in.
        </p>

        <div style="margin-top:26px;border:1px solid #27272a;border-radius:24px;background:#0d0d0d;padding:22px;">
          <div style="color:#a1a1aa;font-size:11px;letter-spacing:.18em;text-transform:uppercase;">Quick snapshot</div>
          <p style="margin:14px 0 0;color:#f4f4f5;font-size:15px;line-height:1.9;">{self._escape_html(summary_excerpt or 'Your summary is ready inside Notable.')}</p>
        </div>

        <div style="margin-top:22px;border:1px solid #27272a;border-radius:24px;background:#0d0d0d;padding:22px;">
          <div style="color:#a1a1aa;font-size:11px;letter-spacing:.18em;text-transform:uppercase;">Action items</div>
          <ul style="margin:14px 0 0 18px;padding:0;">{action_items_html}</ul>
        </div>

        <div style="margin-top:28px;">
          <a href="{meeting_url}" style="display:inline-flex;align-items:center;justify-content:center;padding:14px 22px;border-radius:999px;background:#f4f4f5;color:#0a0a0a;text-decoration:none;font-weight:600;">
            Open in Notable
          </a>
        </div>
        <p style="margin:24px 0 0;color:#71717a;font-size:13px;line-height:1.8;">
          If the button doesn't work, copy and open this link:
          <br />
          <a href="{meeting_url}" style="color:#fafafa;text-decoration:none;word-break:break-all;">{meeting_url}</a>
        </p>
      </div>
    </div>
  </body>
</html>
""".strip()

    def _build_summary_snapshot_email_text(
        self,
        *,
        recipient_name: str,
        meeting_title: str,
        meeting_url: str,
        summary_excerpt: str,
        action_items: list[str],
        template_name: str,
    ) -> str:
        items_text = "\n".join(f"- {item}" for item in action_items[:4]) or "- No action items were extracted yet."
        return (
            f"Hi {recipient_name},\n\n"
            f'Your Notable summary is ready for "{meeting_title}".\n'
            f"Template: {template_name}\n\n"
            f"Quick snapshot:\n{summary_excerpt or 'Your summary is ready inside Notable.'}\n\n"
            f"Action items:\n{items_text}\n\n"
            f"Open in Notable:\n{meeting_url}\n"
        )

    def _escape_html(self, value: str) -> str:
        return (
            value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#39;")
        )

    async def _generate_meeting_title(self, meeting: dict, summary: str) -> str:
        summary_context = self._resolve_summary_context(meeting)
        transcript_text = summary_context["transcript"]
        notes_text = summary_context["notes"]
        system_prompt = (
            "You are Notable AI, generating professional meeting titles. "
            "Return only a concise plain-text title with no markdown, no quotes, no punctuation decoration, "
            "and no emojis. Keep it under 8 words."
        )
        user_prompt = (
            f"Existing title: {meeting.get('title') or 'Untitled meeting'}\n\n"
            f"Manual notes:\n{notes_text or '(none)'}\n\n"
            f"Transcript:\n{transcript_text or '(none)'}\n\n"
            f"Summary:\n{summary}\n\n"
            "Generate the most accurate professional meeting title based on the strongest available source. "
            "Prefer transcript evidence when it exists. If there is no transcript, infer the title from the manual notes and summary."
        )
        generated = (await self.ollama.chat(system_prompt=system_prompt, user_prompt=user_prompt)).strip()
        clean_title = " ".join(generated.replace("\n", " ").split()).strip(" -:#*`\"'")
        return clean_title or (meeting.get("title") or "Untitled meeting")

    def _should_auto_rename(self, current_title: str | None) -> bool:
        if not current_title:
            return True
        normalized = current_title.strip().lower()
        return normalized.startswith("untitled") or normalized == "new note"

    async def _persist_chat_exchange(
        self,
        db: AsyncIOMotorDatabase,
        meeting_id: str | None,
        owner_id: str,
        user_message: str,
        assistant_message: str,
        now: datetime,
        scope: str = "meeting",
    ) -> None:
        await db["chat_messages"].insert_many(
            [
                {
                    "id": str(uuid.uuid4()),
                    "meeting_id": meeting_id,
                    "owner_id": owner_id,
                    "scope": scope,
                    "role": "user",
                    "content": user_message,
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": str(uuid.uuid4()),
                    "meeting_id": meeting_id,
                    "owner_id": owner_id,
                    "scope": scope,
                    "role": "assistant",
                    "content": assistant_message,
                    "created_at": now,
                    "updated_at": now,
                },
            ]
        )
        if meeting_id:
            await db["meetings"].update_one(
                {"id": meeting_id, "owner_id": owner_id},
                {"$set": {"updated_at": now}},
            )

    def _sse_event(self, event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

    def _build_transcript_text(self, chunks: list[dict], entries: list[dict] | None = None) -> str:
        ordered = sorted(chunks, key=lambda chunk: chunk.get("sequence_number", 0))
        return "\n".join(
            f"{self.vocabulary.apply_entries_to_text(chunk.get('speaker_label') or 'Speaker', entries or []) or 'Speaker'}: "
            f"{self.vocabulary.apply_entries_to_text(chunk.get('transcript_text', ''), entries or []) or ''}"
            for chunk in ordered
        )

    def _build_playback_payload(self, meeting: dict) -> dict:
        transcript_chunks = meeting.get("transcript_chunks") or []
        duration_seconds = self._resolve_recording_duration(meeting, transcript_chunks)
        return {
            "has_audio": bool(meeting.get("recording_available")),
            "mime_type": meeting.get("recording_mime_type"),
            "duration_seconds": duration_seconds,
            "started_at": meeting.get("recording_started_at"),
            "ended_at": meeting.get("recording_ended_at"),
            "chapters": self._build_playback_chapters(transcript_chunks, duration_seconds),
            "highlights": self._build_playback_highlights(transcript_chunks, duration_seconds),
        }

    def _resolve_recording_duration(self, meeting: dict, transcript_chunks: list[dict]) -> float | None:
        explicit = meeting.get("recording_duration_seconds")
        if isinstance(explicit, (int, float)) and explicit > 0:
            return round(float(explicit), 2)

        started_candidates = [
            chunk.get("started_at")
            for chunk in transcript_chunks
            if isinstance(chunk.get("started_at"), datetime)
        ]
        ended_candidates = [
            chunk.get("ended_at")
            for chunk in transcript_chunks
            if isinstance(chunk.get("ended_at"), datetime)
        ]
        if started_candidates and ended_candidates:
            return round(max((max(ended_candidates) - min(started_candidates)).total_seconds(), 0.0), 2)
        return None

    def _build_playback_chapters(self, transcript_chunks: list[dict], duration_seconds: float | None) -> list[dict]:
        if not transcript_chunks:
            return []
        meeting_started_at = min(
            (chunk.get("started_at") for chunk in transcript_chunks if isinstance(chunk.get("started_at"), datetime)),
            default=None,
        )

        if len(transcript_chunks) <= 3:
            groups = [[chunk] for chunk in transcript_chunks]
        else:
            target_group_count = min(5, max(2, math.ceil(len(transcript_chunks) / 4)))
            group_size = max(1, math.ceil(len(transcript_chunks) / target_group_count))
            groups = [transcript_chunks[index : index + group_size] for index in range(0, len(transcript_chunks), group_size)]

        chapters: list[dict] = []
        total_groups = max(len(groups), 1)
        for index, group in enumerate(groups, start=1):
            combined_text = " ".join(str(chunk.get("transcript_text") or "").strip() for chunk in group).strip()
            if not combined_text:
                continue
            start_seconds, end_seconds = self._resolve_time_window(
                group,
                duration_seconds,
                meeting_started_at=meeting_started_at,
                fallback_index=index - 1,
                fallback_total=total_groups,
            )
            chapters.append(
                {
                    "id": f"chapter-{index}",
                    "title": self._titleize_playback_text(combined_text),
                    "summary": self._truncate_text(combined_text, 180),
                    "start_seconds": start_seconds,
                    "end_seconds": end_seconds,
                }
            )
        return chapters

    def _build_playback_highlights(self, transcript_chunks: list[dict], duration_seconds: float | None) -> list[dict]:
        meeting_started_at = min(
            (chunk.get("started_at") for chunk in transcript_chunks if isinstance(chunk.get("started_at"), datetime)),
            default=None,
        )
        scored: list[tuple[float, int, dict]] = []
        for index, chunk in enumerate(transcript_chunks):
            text = str(chunk.get("transcript_text") or "").strip()
            if len(text) < 18:
                continue
            normalized = text.lower()
            score = len(text) / 90
            if "?" in text:
                score += 1.2
            if any(keyword in normalized for keyword in ("decide", "decision", "agreed", "approved", "final")):
                score += 1.5
            if any(keyword in normalized for keyword in ("action", "follow up", "next step", "owner", "deadline", "send", "share", "deliver")):
                score += 1.2
            if re.search(r"\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|eod)\b", normalized):
                score += 0.9
            if re.search(r"\b\d+\b", normalized):
                score += 0.3
            scored.append((score, index, chunk))

        highlights: list[dict] = []
        used_starts: list[float] = []
        total_windows = max(min(len(scored), 4), 1)
        for _, rank_index, chunk in sorted(scored, key=lambda item: (item[0], -item[1]), reverse=True):
            start_seconds, end_seconds = self._resolve_time_window(
                [chunk],
                duration_seconds,
                meeting_started_at=meeting_started_at,
                fallback_index=len(highlights),
                fallback_total=total_windows,
            )
            if any(abs(start_seconds - used_start) < 25 for used_start in used_starts):
                continue
            text = str(chunk.get("transcript_text") or "").strip()
            highlights.append(
                {
                    "id": f"highlight-{len(highlights) + 1}",
                    "label": self._classify_highlight_label(text),
                    "quote": self._truncate_text(text, 180),
                    "kind": "highlight",
                    "start_seconds": start_seconds,
                    "end_seconds": end_seconds,
                }
            )
            used_starts.append(start_seconds)
            if len(highlights) >= 4:
                break
        return highlights

    def _resolve_time_window(
        self,
        chunks: list[dict],
        duration_seconds: float | None,
        *,
        meeting_started_at: datetime | None = None,
        fallback_index: int,
        fallback_total: int,
    ) -> tuple[float, float]:
        started_candidates = [
            chunk.get("started_at")
            for chunk in chunks
            if isinstance(chunk.get("started_at"), datetime)
        ]
        ended_candidates = [
            chunk.get("ended_at")
            for chunk in chunks
            if isinstance(chunk.get("ended_at"), datetime)
        ]

        if started_candidates and ended_candidates and isinstance(meeting_started_at, datetime):
            start_seconds = max((min(started_candidates) - meeting_started_at).total_seconds(), 0.0)
            end_seconds = max((max(ended_candidates) - meeting_started_at).total_seconds(), start_seconds + 1)
            return round(start_seconds, 2), round(end_seconds, 2)

        if duration_seconds and fallback_total > 0:
            window = duration_seconds / fallback_total
            start_seconds = fallback_index * window
            end_seconds = min(duration_seconds, start_seconds + window)
            return round(start_seconds, 2), round(max(end_seconds, start_seconds + 1), 2)

        start_seconds = float(fallback_index * 45)
        return round(start_seconds, 2), round(start_seconds + 45, 2)

    def _titleize_playback_text(self, text: str) -> str:
        compact = re.sub(r"\s+", " ", text).strip()
        compact = re.sub(r"^[^A-Za-z0-9]+", "", compact)
        if not compact:
            return "Discussion segment"
        candidate = " ".join(compact.split(" ")[:7]).strip(" ,.;:-")
        return candidate[:1].upper() + candidate[1:] if candidate else "Discussion segment"

    def _classify_highlight_label(self, text: str) -> str:
        normalized = text.lower()
        if "?" in text:
            return "Key question"
        if any(keyword in normalized for keyword in ("decide", "decision", "agreed", "approved", "final")):
            return "Decision"
        if any(keyword in normalized for keyword in ("action", "follow up", "next step", "owner", "deadline")):
            return "Action item"
        if any(keyword in normalized for keyword in ("launch", "release", "timeline", "date", "ship")):
            return "Timeline"
        return "Highlight"

    def _truncate_text(self, text: str, max_length: int) -> str:
        compact = re.sub(r"\s+", " ", text).strip()
        if len(compact) <= max_length:
            return compact
        return compact[: max_length - 1].rstrip() + "…"

    def _recording_path(self, meeting: dict) -> Path:
        extension = str(meeting.get("recording_file_extension") or "wav").strip(".") or "wav"
        return settings.recordings_storage_path / f"{meeting['id']}.{extension}"

    def _delete_recording_file(self, meeting: dict) -> None:
        try:
            recording_path = self._recording_path(meeting)
            if recording_path.exists():
                os.remove(recording_path)
        except OSError:
            return

    def _extract_action_items(self, summary: str) -> list[str]:
        items: list[str] = []
        for line in summary.splitlines():
            stripped = line.strip()
            if stripped.startswith("- "):
                items.append(stripped[2:])
            elif stripped[:2].isdigit() and ". " in stripped:
                items.append(stripped.split(". ", maxsplit=1)[1])
        return items[:8]

    def _resolve_summary_context(self, meeting: dict) -> dict[str, str]:
        entries = meeting.get("_vocabulary_entries") or []
        transcript_text = self._build_transcript_text(meeting.get("transcript_chunks", []), entries=entries).strip()
        notes_text = (self.vocabulary.apply_entries_to_text(meeting.get("notes_markdown") or "", entries) or "").strip()

        if transcript_text and notes_text:
            mode = "hybrid"
        elif transcript_text:
            mode = "transcript_only"
        elif notes_text:
            mode = "notes_only"
        else:
            mode = "empty"

        return {
            "mode": mode,
            "transcript": transcript_text,
            "notes": notes_text,
        }

    async def _store_anonymized_summary_sample(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting: dict,
        summary: str,
        style: str,
    ) -> None:
        if not owner.get("allow_anonymized_summary_samples"):
            return

        summary_context = self._resolve_summary_context(meeting)
        anonymized = self._anonymize_summary_sample_content(
            owner=owner,
            meeting=meeting,
            transcript_text=summary_context["transcript"],
            notes_text=summary_context["notes"],
            summary_text=summary,
        )

        now = datetime.now(timezone.utc)
        await db["summary_improvement_samples"].insert_one(
            {
                "id": str(uuid.uuid4()),
                "owner_id": owner["id"],
                "meeting_id": meeting["id"],
                "source_mode": summary_context["mode"],
                "summary_style": style,
                "meeting_provider": meeting.get("provider"),
                "meeting_language": meeting.get("transcription_language"),
                "has_transcript": bool(summary_context["transcript"]),
                "has_notes": bool(summary_context["notes"]),
                "transcript_sample": anonymized["transcript"],
                "notes_sample": anonymized["notes"],
                "summary_sample": anonymized["summary"],
                "anonymization_meta": anonymized["meta"],
                "created_at": now,
                "updated_at": now,
            }
        )

    def _anonymize_summary_sample_content(
        self,
        owner: dict,
        meeting: dict,
        transcript_text: str,
        notes_text: str,
        summary_text: str,
    ) -> dict[str, dict | str]:
        patterns = [
            (r"https?://\S+", "[LINK]"),
            (r"\b(?:www\.)\S+\b", "[LINK]"),
            (r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b", "[EMAIL]"),
            (r"\b(?:\+?\d[\d\s().-]{7,}\d)\b", "[PHONE]"),
            (r"\b(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|calendar\.google\.com)\S*\b", "[MEETING_LINK]"),
            (r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b", "[ID]"),
            (r"\b[A-Za-z0-9_-]{24,}\b", "[TOKEN]"),
        ]

        replacements_meta = {
            "links": 0,
            "emails": 0,
            "phones": 0,
            "meeting_links": 0,
            "ids": 0,
            "tokens": 0,
            "names": 0,
            "title_mentions": 0,
        }

        def mask_text(value: str) -> str:
            masked = value
            for pattern, replacement in patterns:
                count = len(re.findall(pattern, masked, flags=re.IGNORECASE))
                if not count:
                    continue
                masked = re.sub(pattern, replacement, masked, flags=re.IGNORECASE)
                if replacement == "[LINK]":
                    replacements_meta["links"] += count
                elif replacement == "[EMAIL]":
                    replacements_meta["emails"] += count
                elif replacement == "[PHONE]":
                    replacements_meta["phones"] += count
                elif replacement == "[MEETING_LINK]":
                    replacements_meta["meeting_links"] += count
                elif replacement == "[ID]":
                    replacements_meta["ids"] += count
                elif replacement == "[TOKEN]":
                    replacements_meta["tokens"] += count

            candidate_names = list(meeting.get("participants") or [])
            if owner.get("full_name"):
                candidate_names.append(owner["full_name"])

            seen_names: set[str] = set()
            for index, candidate in enumerate(candidate_names, start=1):
                normalized = " ".join(str(candidate).split()).strip()
                lowered = normalized.lower()
                if len(normalized) < 2 or lowered in seen_names:
                    continue
                seen_names.add(lowered)
                count = len(re.findall(re.escape(normalized), masked, flags=re.IGNORECASE))
                if count:
                    masked = re.sub(
                        re.escape(normalized),
                        f"[PERSON_{index}]",
                        masked,
                        flags=re.IGNORECASE,
                    )
                    replacements_meta["names"] += count

            meeting_title = (meeting.get("title") or "").strip()
            if meeting_title:
                count = len(re.findall(re.escape(meeting_title), masked, flags=re.IGNORECASE))
                if count:
                    masked = re.sub(re.escape(meeting_title), "[MEETING_TITLE]", masked, flags=re.IGNORECASE)
                    replacements_meta["title_mentions"] += count

            return masked.strip()

        return {
            "transcript": mask_text(transcript_text),
            "notes": mask_text(notes_text),
            "summary": mask_text(summary_text),
            "meta": replacements_meta,
        }

    def _generate_share_token(self) -> str:
        return secrets.token_urlsafe(6).replace("-", "").replace("_", "")[:10]

    def _share_url_for_token(self, token: str) -> str:
        return f"{settings.frontend_url.rstrip('/')}/share/{token}"

    def _extract_email_domain(self, email: str | None) -> str | None:
        if not email or "@" not in email:
            return None
        return email.split("@", maxsplit=1)[1].strip().lower() or None
