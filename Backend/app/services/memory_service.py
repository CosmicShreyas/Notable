import copy

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.vocabulary_service import VocabularyService


class MemoryService:
    def __init__(self) -> None:
        self.vocabulary = VocabularyService()

    async def recall_relevant_meetings(
        self,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        query: str,
        limit: int = 3,
        entries: list[dict] | None = None,
    ) -> list[dict]:
        meetings = await db["meetings"].find({"owner_id": owner_id}).sort("updated_at", -1).to_list(length=100)

        query_terms = {term.lower() for term in query.split() if term.strip()}
        scored: list[tuple[int, dict]] = []
        for meeting in meetings:
            candidate = (
                self.vocabulary.apply_entries_to_meeting(meeting=copy.deepcopy(meeting), entries=entries)
                if entries
                else meeting
            )
            haystack = " ".join(
                filter(
                    None,
                    [
                        candidate.get("title"),
                        candidate.get("summary"),
                        candidate.get("notes_markdown"),
                    ],
                )
            ).lower()
            score = sum(1 for term in query_terms if term in haystack)
            if score:
                scored.append((score, candidate))

        scored.sort(key=lambda item: (item[0], item[1].get("updated_at")), reverse=True)
        return [meeting for _, meeting in scored[:limit]]
