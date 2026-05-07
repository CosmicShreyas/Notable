import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.schemas.comment import CommentMentionResponse, CommentResponse


class CommentService:
    SUPPORTED_ENTITY_TYPES = {"note", "action_item", "task"}

    async def list_comments(
        self,
        *,
        db: AsyncIOMotorDatabase,
        current_user: dict,
        entity_type: str,
        entity_id: str,
        meeting_id: str | None = None,
    ) -> list[CommentResponse]:
        owner_id = await self._resolve_owner_id(
            db=db,
            current_user=current_user,
            entity_type=entity_type,
            entity_id=entity_id,
            meeting_id=meeting_id,
        )
        documents = await db["comments"].find(
            {
                "owner_id": owner_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
            }
        ).sort("created_at", 1).to_list(length=500)
        return [self._to_response(document, current_user=current_user) for document in documents]

    async def create_comment(
        self,
        *,
        db: AsyncIOMotorDatabase,
        current_user: dict,
        entity_type: str,
        entity_id: str,
        body: str,
        entity_label: str | None = None,
        meeting_id: str | None = None,
    ) -> CommentResponse:
        normalized_entity_type = entity_type.strip().lower()
        if normalized_entity_type not in self.SUPPORTED_ENTITY_TYPES:
            raise ValueError("Unsupported comment target")

        owner_id = await self._resolve_owner_id(
            db=db,
            current_user=current_user,
            entity_type=normalized_entity_type,
            entity_id=entity_id,
            meeting_id=meeting_id,
        )

        clean_body = body.strip()
        if not clean_body:
            raise ValueError("Comment body cannot be empty")

        mentions = await self._extract_mentions(db=db, current_user=current_user, body=clean_body)
        now = datetime.now(timezone.utc)
        document = {
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "author_user_id": current_user["id"],
            "author_name": current_user.get("full_name") or current_user.get("email") or "Unknown user",
            "author_email": current_user.get("email") or "",
            "author_avatar_url": current_user.get("avatar_url"),
            "entity_type": normalized_entity_type,
            "entity_id": entity_id,
            "entity_label": entity_label,
            "meeting_id": meeting_id,
            "body": clean_body,
            "mentions": mentions,
            "created_at": now,
            "updated_at": now,
        }
        await db["comments"].insert_one(document)
        return self._to_response(document, current_user=current_user)

    async def delete_comment(
        self,
        *,
        db: AsyncIOMotorDatabase,
        current_user: dict,
        comment_id: str,
    ) -> bool:
        comment = await db["comments"].find_one({"id": comment_id})
        if not comment:
            return False
        if comment.get("author_user_id") != current_user["id"]:
            raise ValueError("You can only delete comments you created")
        result = await db["comments"].delete_one({"id": comment_id})
        return result.deleted_count > 0

    async def _resolve_owner_id(
        self,
        *,
        db: AsyncIOMotorDatabase,
        current_user: dict,
        entity_type: str,
        entity_id: str,
        meeting_id: str | None,
    ) -> str:
        if entity_type == "task":
            task = await db["tasks"].find_one({"id": entity_id, "owner_id": current_user["id"]})
            if not task:
                raise ValueError("Task not found")
            return task["owner_id"]

        resolved_meeting_id = meeting_id or entity_id
        meeting = await db["meetings"].find_one({"id": resolved_meeting_id})
        if not meeting:
            raise ValueError("Meeting not found")
        if meeting["owner_id"] == current_user["id"]:
            return meeting["owner_id"]

        share = await db["meeting_shares"].find_one({"meeting_id": resolved_meeting_id, "visibility": "team"})
        if not share or not share.get("team_id"):
            raise ValueError("You do not have access to comment on this meeting")

        membership = await db["team_memberships"].find_one(
            {
                "team_id": share["team_id"],
                "user_id": current_user["id"],
                "status": "active",
            }
        )
        if not membership:
            raise ValueError("You do not have access to comment on this meeting")
        return meeting["owner_id"]

    async def _extract_mentions(
        self,
        *,
        db: AsyncIOMotorDatabase,
        current_user: dict,
        body: str,
    ) -> list[dict]:
        raw_handles = re.findall(r"(?<!\w)@([A-Za-z0-9._%+-]+(?:@[A-Za-z0-9.-]+\.[A-Za-z]{2,})?)", body)
        if not raw_handles:
            return []

        memberships = await db["team_memberships"].find(
            {
                "user_id": current_user["id"],
                "status": "active",
            }
        ).to_list(length=100)
        if not memberships:
            return []

        team_ids = [item["team_id"] for item in memberships]
        teammate_memberships = await db["team_memberships"].find(
            {
                "team_id": {"$in": team_ids},
                "status": "active",
            }
        ).to_list(length=500)

        candidates: dict[str, dict] = {}
        for membership in teammate_memberships:
            user = await db["users"].find_one({"id": membership["user_id"]})
            email = (membership.get("email") or "").strip().lower()
            if not email:
                continue
            full_name = (user.get("full_name") if user else None) or None
            entry = {
                "user_id": membership["user_id"],
                "email": email,
                "full_name": full_name,
            }
            candidates[email] = entry
            local_part = email.split("@", 1)[0]
            candidates[local_part] = entry
            if full_name:
                for token in re.findall(r"[A-Za-z0-9._-]+", full_name.lower()):
                    candidates[token] = entry

        mentions: list[dict] = []
        seen_user_ids: set[str] = set()
        for handle in raw_handles:
            key = handle.strip().lower()
            candidate = candidates.get(key)
            if not candidate:
                continue
            if candidate["user_id"] in seen_user_ids:
                continue
            seen_user_ids.add(candidate["user_id"])
            mentions.append(candidate)
        return mentions

    def _to_response(self, document: dict, *, current_user: dict) -> CommentResponse:
        mentions = [
            CommentMentionResponse.model_validate(mention)
            for mention in document.get("mentions") or []
        ]
        return CommentResponse(
            id=document["id"],
            owner_id=document["owner_id"],
            author_user_id=document["author_user_id"],
            author_name=document.get("author_name") or document.get("author_email") or "Unknown user",
            author_email=document.get("author_email") or "",
            author_avatar_url=document.get("author_avatar_url"),
            entity_type=document["entity_type"],
            entity_id=document["entity_id"],
            entity_label=document.get("entity_label"),
            meeting_id=document.get("meeting_id"),
            body=document.get("body") or "",
            mentions=mentions,
            can_delete=document.get("author_user_id") == current_user["id"],
            created_at=document["created_at"],
            updated_at=document["updated_at"],
        )
