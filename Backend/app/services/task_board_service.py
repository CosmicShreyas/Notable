import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase


class TaskBoardService:
    VALID_STATUSES = {"open", "blocked", "done"}

    async def list_tasks(self, *, db: AsyncIOMotorDatabase, owner_id: str) -> list[dict]:
        return await db["tasks"].find({"owner_id": owner_id}).sort([("status", 1), ("position", 1), ("updated_at", -1)]).to_list(length=5000)

    async def create_task(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        title: str,
        status: str = "open",
        meeting_id: str | None = None,
        meeting_title: str | None = None,
        source: str = "manual",
    ) -> dict:
        clean_status = self._validate_status(status)
        now = datetime.now(timezone.utc)
        task = {
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "meeting_id": meeting_id,
            "meeting_title": meeting_title,
            "title": title.strip(),
            "normalized_title": self._normalize_title(title),
            "status": clean_status,
            "source": source,
            "position": await self._next_position(db=db, owner_id=owner_id, status=clean_status),
            "created_at": now,
            "updated_at": now,
        }
        await db["tasks"].insert_one(task)
        return task

    async def update_task(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        task_id: str,
        title: str | None = None,
        status: str | None = None,
        position: float | None = None,
    ) -> dict | None:
        updates: dict = {"updated_at": datetime.now(timezone.utc)}
        if title is not None:
            updates["title"] = title.strip()
            updates["normalized_title"] = self._normalize_title(title)
        if status is not None:
            updates["status"] = self._validate_status(status)
        if position is not None:
            updates["position"] = float(position)

        result = await db["tasks"].update_one(
            {"id": task_id, "owner_id": owner_id},
            {"$set": updates},
        )
        if result.matched_count == 0:
            return None
        return await db["tasks"].find_one({"id": task_id, "owner_id": owner_id})

    async def delete_task(self, *, db: AsyncIOMotorDatabase, owner_id: str, task_id: str) -> bool:
        result = await db["tasks"].delete_one({"id": task_id, "owner_id": owner_id})
        return result.deleted_count > 0

    async def sync_meeting_action_items(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        meeting_id: str,
        meeting_title: str,
        action_items: list[str],
    ) -> None:
        if not action_items:
            return

        now = datetime.now(timezone.utc)
        for item in action_items:
            title = item.strip()
            if not title:
                continue
            normalized_title = self._normalize_title(title)
            existing = await db["tasks"].find_one(
                {
                    "owner_id": owner_id,
                    "meeting_id": meeting_id,
                    "normalized_title": normalized_title,
                }
            )
            if existing:
                await db["tasks"].update_one(
                    {"id": existing["id"]},
                    {
                        "$set": {
                            "title": title,
                            "meeting_title": meeting_title,
                            "updated_at": now,
                        }
                    },
                )
                continue

            await db["tasks"].insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "owner_id": owner_id,
                    "meeting_id": meeting_id,
                    "meeting_title": meeting_title,
                    "title": title,
                    "normalized_title": normalized_title,
                    "status": "open",
                    "source": "meeting_action_item",
                    "position": await self._next_position(db=db, owner_id=owner_id, status="open"),
                    "created_at": now,
                    "updated_at": now,
                }
            )

    async def delete_meeting_tasks(self, *, db: AsyncIOMotorDatabase, owner_id: str, meeting_id: str) -> None:
        await db["tasks"].delete_many({"owner_id": owner_id, "meeting_id": meeting_id})

    async def _next_position(self, *, db: AsyncIOMotorDatabase, owner_id: str, status: str) -> float:
        latest = await db["tasks"].find({"owner_id": owner_id, "status": status}).sort("position", -1).limit(1).to_list(length=1)
        if not latest:
            return 1.0
        return float(latest[0].get("position") or 0) + 1.0

    def _validate_status(self, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in self.VALID_STATUSES:
            raise ValueError("Unsupported task status")
        return normalized

    def _normalize_title(self, value: str) -> str:
        normalized = re.sub(r"\s+", " ", value.strip().lower())
        return normalized
