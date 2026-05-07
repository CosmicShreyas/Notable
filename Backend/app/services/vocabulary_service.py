import copy
import re
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase


class VocabularyService:
    WORD_PATTERN = re.compile(r"[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*")

    async def list_entries(self, db: AsyncIOMotorDatabase, owner_id: str) -> list[dict]:
        return await db["vocabulary_entries"].find({"owner_id": owner_id}).sort("updated_at", -1).to_list(length=500)

    async def create_entry(
        self,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        canonical: str,
        aliases: list[str],
    ) -> dict:
        canonical_clean, aliases_clean = self._normalize_entry(canonical=canonical, aliases=aliases)
        now = datetime.now(timezone.utc)
        entry = {
            "id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "canonical": canonical_clean,
            "canonical_key": canonical_clean.casefold(),
            "aliases": aliases_clean,
            "created_at": now,
            "updated_at": now,
        }
        await db["vocabulary_entries"].insert_one(entry)
        return entry

    async def update_entry(
        self,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        entry_id: str,
        canonical: str,
        aliases: list[str],
    ) -> dict | None:
        canonical_clean, aliases_clean = self._normalize_entry(canonical=canonical, aliases=aliases)
        now = datetime.now(timezone.utc)
        update_result = await db["vocabulary_entries"].update_one(
            {"id": entry_id, "owner_id": owner_id},
            {
                "$set": {
                    "canonical": canonical_clean,
                    "canonical_key": canonical_clean.casefold(),
                    "aliases": aliases_clean,
                    "updated_at": now,
                }
            },
        )
        if update_result.matched_count == 0:
            return None
        return await db["vocabulary_entries"].find_one({"id": entry_id, "owner_id": owner_id})

    async def delete_entry(self, db: AsyncIOMotorDatabase, owner_id: str, entry_id: str) -> bool:
        result = await db["vocabulary_entries"].delete_one({"id": entry_id, "owner_id": owner_id})
        return result.deleted_count > 0

    async def apply_to_meeting(self, db: AsyncIOMotorDatabase, owner_id: str, meeting: dict | None) -> dict | None:
        if not meeting:
            return meeting
        entries = await self.list_entries(db=db, owner_id=owner_id)
        return self.apply_entries_to_meeting(meeting=meeting, entries=entries)

    def apply_entries_to_meeting(self, meeting: dict, entries: list[dict]) -> dict:
        if not entries:
            return meeting

        corrected = copy.deepcopy(meeting)
        corrected["title"] = self.apply_entries_to_text(corrected.get("title"), entries)
        corrected["summary"] = self.apply_entries_to_text(corrected.get("summary"), entries)
        corrected["notes_markdown"] = self.apply_entries_to_text(corrected.get("notes_markdown"), entries)
        corrected["participants"] = [
            self.apply_entries_to_text(participant, entries) or participant
            for participant in (corrected.get("participants") or [])
        ]

        transcript_chunks = corrected.get("transcript_chunks") or []
        for chunk in transcript_chunks:
            chunk["speaker_label"] = self.apply_entries_to_text(chunk.get("speaker_label"), entries)
            chunk["transcript_text"] = self.apply_entries_to_text(chunk.get("transcript_text"), entries)

        chat_messages = corrected.get("chat_messages") or []
        for message in chat_messages:
            message["content"] = self.apply_entries_to_text(message.get("content"), entries)

        return corrected

    def apply_entries_to_text(self, value: str | None, entries: list[dict]) -> str | None:
        if not value or not entries:
            return value

        corrected = value
        for replacement in self._build_replacements(entries):
            corrected = replacement["pattern"].sub(replacement["canonical"], corrected)
        corrected = self._apply_fuzzy_corrections(corrected, entries)
        return corrected

    def _normalize_entry(self, canonical: str, aliases: list[str]) -> tuple[str, list[str]]:
        canonical_clean = " ".join(canonical.split()).strip()
        if not canonical_clean:
            raise ValueError("Canonical term is required")

        aliases_clean: list[str] = []
        seen = {canonical_clean.casefold()}
        for alias in aliases:
            normalized = " ".join(str(alias).split()).strip()
            if not normalized:
                continue
            lowered = normalized.casefold()
            if lowered in seen:
                continue
            seen.add(lowered)
            aliases_clean.append(normalized)

        return canonical_clean, aliases_clean

    def _build_replacements(self, entries: list[dict]) -> list[dict]:
        replacements: list[dict] = []
        seen_variants: set[str] = set()

        for entry in entries:
            canonical = entry.get("canonical")
            if not isinstance(canonical, str) or not canonical.strip():
                continue

            variants = [canonical, *(entry.get("aliases") or [])]
            for variant in variants:
                if not isinstance(variant, str):
                    continue
                normalized = " ".join(variant.split()).strip()
                if not normalized:
                    continue
                key = normalized.casefold()
                if key in seen_variants:
                    continue
                seen_variants.add(key)
                replacements.append(
                    {
                        "canonical": canonical,
                        "variant": normalized,
                        "pattern": self._compile_variant_pattern(normalized),
                    }
                )

        replacements.sort(key=lambda item: len(item["variant"]), reverse=True)
        return replacements

    def _compile_variant_pattern(self, variant: str) -> re.Pattern[str]:
        parts = [re.escape(piece) for piece in variant.split() if piece]
        if not parts:
            return re.compile(r"$^")
        joined = r"[\s\-_.]+".join(parts)
        return re.compile(rf"(?<!\w){joined}(?!\w)", flags=re.IGNORECASE)

    def _apply_fuzzy_corrections(self, value: str, entries: list[dict]) -> str:
        tokens = [
            {
                "text": match.group(0),
                "normalized": self._normalize_token(match.group(0)),
                "start": match.start(),
                "end": match.end(),
            }
            for match in self.WORD_PATTERN.finditer(value)
        ]
        if not tokens:
            return value

        candidates: list[dict] = []
        for entry in entries:
            profile = self._build_canonical_profile(entry)
            if profile:
                candidates.append(profile)

        if not candidates:
            return value

        matches = self._select_fuzzy_matches(value=value, tokens=tokens, candidates=candidates)
        if not matches:
            return value

        corrected = value
        for match in sorted(matches, key=lambda item: item["start"], reverse=True):
            corrected = corrected[: match["start"]] + match["canonical"] + corrected[match["end"] :]
        return corrected

    def _select_fuzzy_matches(self, value: str, tokens: list[dict], candidates: list[dict]) -> list[dict]:
        raw_matches: list[dict] = []

        for profile in candidates:
            token_count = profile["token_count"]
            if token_count <= 0:
                continue

            for start_index in range(0, len(tokens) - token_count + 1):
                window = tokens[start_index : start_index + token_count]
                phrase = value[window[0]["start"] : window[-1]["end"]]
                if profile["canonical_key"] in phrase.casefold():
                    continue

                score = self._score_window(window, profile)
                if score < profile["threshold"]:
                    continue

                raw_matches.append(
                    {
                        "start": window[0]["start"],
                        "end": window[-1]["end"],
                        "canonical": profile["canonical"],
                        "score": score,
                        "length": window[-1]["end"] - window[0]["start"],
                    }
                )

        selected: list[dict] = []
        occupied: list[tuple[int, int]] = []
        for match in sorted(raw_matches, key=lambda item: (item["score"], item["length"]), reverse=True):
            if any(not (match["end"] <= start or match["start"] >= end) for start, end in occupied):
                continue
            occupied.append((match["start"], match["end"]))
            selected.append(match)

        return selected

    def _build_canonical_profile(self, entry: dict) -> dict | None:
        canonical = entry.get("canonical")
        if not isinstance(canonical, str):
            return None

        normalized_tokens = [self._normalize_token(piece) for piece in canonical.split()]
        normalized_tokens = [piece for piece in normalized_tokens if piece]
        if not normalized_tokens:
            return None

        normalized_phrase = " ".join(normalized_tokens)
        compact_phrase = "".join(normalized_tokens)
        if len(compact_phrase) < 6:
            return None

        return {
            "canonical": canonical,
            "canonical_key": canonical.casefold(),
            "normalized_tokens": normalized_tokens,
            "normalized_phrase": normalized_phrase,
            "compact_phrase": compact_phrase,
            "token_count": len(normalized_tokens),
            "threshold": 0.92 if len(normalized_tokens) == 1 else 0.84,
            "first_initial": normalized_tokens[0][0],
            "exact_aliases": {canonical.casefold(), *((alias or "").casefold() for alias in (entry.get("aliases") or []))},
        }

    def _score_window(self, window: list[dict], profile: dict) -> float:
        window_tokens = [item["normalized"] for item in window]
        if len(window_tokens) != profile["token_count"] or any(not token for token in window_tokens):
            return 0.0

        if window_tokens[0][0] != profile["first_initial"]:
            return 0.0

        lowered_phrase = " ".join(item["text"] for item in window).casefold()
        if lowered_phrase in profile["exact_aliases"]:
            return 1.0

        token_scores = [
            self._jaro_winkler_similarity(left, right)
            for left, right in zip(window_tokens, profile["normalized_tokens"], strict=False)
        ]
        exact_token_count = sum(
            1 for left, right in zip(window_tokens, profile["normalized_tokens"], strict=False) if left == right
        )

        phrase_score = self._jaro_winkler_similarity(" ".join(window_tokens), profile["normalized_phrase"])
        compact_score = self._jaro_winkler_similarity("".join(window_tokens), profile["compact_phrase"])
        weighted_token_score = sum(token_scores) / len(token_scores)

        if len(window_tokens) == 1:
            if exact_token_count:
                return 1.0
            return compact_score

        if exact_token_count == 0 and phrase_score < 0.9:
            return 0.0

        return max(compact_score, phrase_score * 0.55 + weighted_token_score * 0.45)

    def _normalize_token(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]", "", value.casefold())

    def _jaro_winkler_similarity(self, left: str, right: str) -> float:
        if left == right:
            return 1.0
        if not left or not right:
            return 0.0

        left_len = len(left)
        right_len = len(right)
        match_distance = max(left_len, right_len) // 2 - 1
        if match_distance < 0:
            match_distance = 0

        left_matches = [False] * left_len
        right_matches = [False] * right_len
        matches = 0

        for left_index in range(left_len):
            start = max(0, left_index - match_distance)
            end = min(left_index + match_distance + 1, right_len)
            for right_index in range(start, end):
                if right_matches[right_index] or left[left_index] != right[right_index]:
                    continue
                left_matches[left_index] = True
                right_matches[right_index] = True
                matches += 1
                break

        if matches == 0:
            return 0.0

        transpositions = 0
        right_cursor = 0
        for left_index in range(left_len):
            if not left_matches[left_index]:
                continue
            while not right_matches[right_cursor]:
                right_cursor += 1
            if left[left_index] != right[right_cursor]:
                transpositions += 1
            right_cursor += 1

        jaro = (
            (matches / left_len)
            + (matches / right_len)
            + ((matches - transpositions / 2) / matches)
        ) / 3

        prefix = 0
        for left_char, right_char in zip(left, right, strict=False):
            if left_char != right_char:
                break
            prefix += 1
            if prefix == 4:
                break

        return jaro + prefix * 0.1 * (1 - jaro)
