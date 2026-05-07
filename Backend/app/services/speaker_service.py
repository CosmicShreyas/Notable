import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase


class SpeakerService:
    async def list_identities(self, *, db: AsyncIOMotorDatabase, owner_id: str) -> list[dict]:
        return await db["speaker_identities"].find({"owner_id": owner_id}).sort("updated_at", -1).to_list(length=200)

    async def rename_speaker_in_meeting(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        current_label: str,
        new_label: str,
        remember_identity: bool = True,
    ) -> bool:
        clean_current = self._clean_name(current_label)
        clean_new = self._clean_name(new_label)
        if len(clean_current) < 1 or len(clean_new) < 2:
            raise ValueError("Both the current speaker label and the new speaker name are required.")

        meeting = await db["meetings"].find_one({"id": meeting_id, "owner_id": owner["id"]})
        if not meeting:
            return False

        now = datetime.now(timezone.utc)
        await db["transcript_chunks"].update_many(
            {"meeting_id": meeting_id, "speaker_label": clean_current},
            {"$set": {"speaker_label": clean_new, "updated_at": now}},
        )

        if remember_identity:
            await self._upsert_identity(db=db, owner_id=owner["id"], name=clean_new, now=now)

        transcript_chunks = await db["transcript_chunks"].find({"meeting_id": meeting_id}).sort("sequence_number", 1).to_list(length=10000)
        updated_participants = self._merge_participants(
            existing=meeting.get("participants") or [],
            transcript_chunks=transcript_chunks,
        )
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"participants": updated_participants, "updated_at": now}},
        )
        return True

    async def _upsert_identity(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        name: str,
        now: datetime,
    ) -> None:
        normalized = self._normalize(name)
        existing = await db["speaker_identities"].find_one({"owner_id": owner_id, "normalized_name": normalized})
        if existing:
            await db["speaker_identities"].update_one(
                {"id": existing["id"]},
                {"$set": {"name": name, "updated_at": now}},
            )
            return

        await db["speaker_identities"].insert_one(
            {
                "id": str(uuid.uuid4()),
                "owner_id": owner_id,
                "name": name,
                "normalized_name": normalized,
                "created_at": now,
                "updated_at": now,
            }
        )

    def _merge_participants(self, *, existing: list[str], transcript_chunks: list[dict]) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()

        for participant in existing:
            clean_participant = self._clean_name(participant)
            if not clean_participant or self._is_generic_speaker_label(clean_participant):
                continue
            lowered = clean_participant.casefold()
            if lowered in seen:
                continue
            seen.add(lowered)
            merged.append(clean_participant)

        for chunk in transcript_chunks:
            speaker_label = self._clean_name(chunk.get("speaker_label") or "")
            if not speaker_label or self._is_generic_speaker_label(speaker_label):
                continue
            lowered = speaker_label.casefold()
            if lowered in seen:
                continue
            seen.add(lowered)
            merged.append(speaker_label)

        return merged

    def _is_generic_speaker_label(self, value: str) -> bool:
        normalized = self._normalize(value)
        return normalized in {"speaker", "unknown speaker"} or bool(re.fullmatch(r"speaker\s+\d+", normalized))

    def _clean_name(self, value: str) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip().strip("\"'")

    def _normalize(self, value: str) -> str:
        return self._clean_name(value).casefold()
