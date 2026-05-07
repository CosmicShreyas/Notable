import asyncio
import base64
import binascii
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import UpdateOne

from app.schemas.transcript import (
    TranscriptChunkRequest,
    TranscriptChunkResponse,
    TranscriptDiscardResponse,
    TranscriptFinalizeResponse,
    TranscriptSessionDiscardRequest,
    TranscriptTextChunkRequest,
)
from app.core.config import settings
from app.db.mongodb import get_database
from app.services.speaker_service import SpeakerService
from app.services.transcription_provider_service import transcribe_audio_file

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(self) -> None:
        self.speakers = SpeakerService()

    async def transcribe_and_store_chunk(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: TranscriptChunkRequest,
    ) -> TranscriptChunkResponse:
        meeting = await self._get_meeting(db=db, owner_id=owner["id"], meeting_id=meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        transcript_segments = await self._transcribe_base64_audio(
            payload.audio_base64,
            payload.mime_type,
            meeting.get("transcription_language"),
            owner_id=owner["id"],
        )
        transcript = " ".join(segment["text"] for segment in transcript_segments if segment.get("text")).strip()
        known_identity_names = await self._get_known_speaker_identity_names(owner["id"], owner)
        speaker_label = self._resolve_chunk_speaker_label(
            segments=transcript_segments,
            fallback_label=payload.speaker_label,
            transcript_text=transcript,
            owner=owner,
            known_identity_names=known_identity_names,
        )

        sequence_number = await db["transcript_chunks"].count_documents({"meeting_id": meeting_id}) + 1
        now = datetime.now(timezone.utc)

        await db["transcript_chunks"].insert_one(
            {
                "id": str(uuid.uuid4()),
                "meeting_id": meeting_id,
                "owner_id": owner["id"],
                "speaker_label": speaker_label,
                "sequence_number": sequence_number,
                "transcript_text": transcript,
                "started_at": payload.started_at,
                "ended_at": payload.ended_at,
                "expires_at": self._build_expiration_timestamp(
                    now=now,
                    retention_days=owner.get("transcript_retention_days"),
                ),
                "created_at": now,
                "updated_at": now,
            }
        )
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"status": "in_progress", "updated_at": now}},
        )
        await self._update_participants_from_text(
            db=db,
            meeting=meeting,
            owner=owner,
            meeting_id=meeting_id,
            transcript_text=transcript,
            speaker_labels=[speaker_label] if speaker_label else None,
        )

        return TranscriptChunkResponse(
            meeting_id=meeting_id,
            transcript=transcript,
            speaker_label=speaker_label,
            sequence_number=sequence_number,
        )

    async def transcribe_and_store_recording(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: TranscriptChunkRequest,
    ) -> TranscriptFinalizeResponse:
        meeting = await self._get_meeting(db=db, owner_id=owner["id"], meeting_id=meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        raw_audio = self._decode_audio_payload(payload.audio_base64)

        segments = await self._transcribe_base64_audio(
            payload.audio_base64,
            payload.mime_type,
            meeting.get("transcription_language"),
            owner_id=owner["id"],
        )
        if not segments:
            raise ValueError("No speech detected in recording")

        await db["transcript_chunks"].delete_many({"meeting_id": meeting_id})

        now = datetime.now(timezone.utc)
        documents: list[dict] = []
        combined_parts: list[str] = []

        known_identity_names = await self._get_known_speaker_identity_names(owner["id"], owner)
        speaker_resolution_map: dict[str, str] = {}

        for index, segment in enumerate(segments, start=1):
            text = segment["text"].strip()
            if not text or self._is_low_quality_transcript(text):
                continue

            raw_speaker_label = self._clean_speaker_label(segment.get("speaker_label")) or (payload.speaker_label or "Speaker")
            speaker_label = self._resolve_segment_speaker_label(
                raw_speaker_label=raw_speaker_label,
                transcript_text=text,
                known_identity_names=known_identity_names,
                owner=owner,
                speaker_resolution_map=speaker_resolution_map,
            )

            combined_parts.append(text)
            documents.append(
                {
                    "id": str(uuid.uuid4()),
                    "meeting_id": meeting_id,
                    "owner_id": owner["id"],
                    "speaker_label": speaker_label,
                    "sequence_number": index,
                    "transcript_text": text,
                    "started_at": self._offset_datetime(payload.started_at, segment.get("start")),
                    "ended_at": self._offset_datetime(payload.started_at, segment.get("end")),
                    "expires_at": self._build_expiration_timestamp(
                        now=now,
                        retention_days=owner.get("transcript_retention_days"),
                    ),
                    "created_at": now,
                    "updated_at": now,
                }
            )

        if not documents:
            raise ValueError("No usable speech detected in recording")

        await db["transcript_chunks"].insert_many(documents)
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"status": "in_progress", "updated_at": now}},
        )

        duration_seconds = 0.0
        if payload.started_at and payload.ended_at:
            duration_seconds = max((payload.ended_at - payload.started_at).total_seconds(), 0.0)
        elif documents:
            first_started = documents[0].get("started_at")
            last_ended = documents[-1].get("ended_at")
            if isinstance(first_started, datetime) and isinstance(last_ended, datetime):
                duration_seconds = max((last_ended - first_started).total_seconds(), 0.0)

        try:
            recording_info = await asyncio.to_thread(
                self._persist_recording_file,
                meeting_id,
                raw_audio,
                payload.mime_type,
            )
            await db["meetings"].update_one(
                {"id": meeting_id, "owner_id": owner["id"]},
                {
                    "$set": {
                        "recording_available": True,
                        "recording_file_extension": recording_info["extension"],
                        "recording_mime_type": payload.mime_type,
                        "recording_duration_seconds": duration_seconds or recording_info["duration_seconds"],
                        "recording_started_at": documents[0].get("started_at") if documents else payload.started_at,
                        "recording_ended_at": documents[-1].get("ended_at") if documents else payload.ended_at,
                        "recording_size_bytes": recording_info["size_bytes"],
                        "updated_at": now,
                    }
                },
            )
        except Exception:
            logger.exception("Unable to persist finalized recording for meeting %s", meeting_id)

        full_transcript = "\n".join(combined_parts).strip()
        await self._update_participants_from_text(
            db=db,
            meeting=meeting,
            owner=owner,
            meeting_id=meeting_id,
            transcript_text=full_transcript,
            speaker_labels=[doc.get("speaker_label") for doc in documents if doc.get("speaker_label")],
        )

        return TranscriptFinalizeResponse(
            meeting_id=meeting_id,
            transcript=full_transcript,
            segment_count=len(documents),
        )

    async def store_transcript_text_chunk(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: TranscriptTextChunkRequest,
    ) -> TranscriptChunkResponse:
        meeting = await self._get_meeting(db=db, owner_id=owner["id"], meeting_id=meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        if self._is_low_quality_transcript(payload.transcript_text):
            raise ValueError("Transcript chunk was too noisy to store")

        speaker_label = self._clean_speaker_label(payload.speaker_label) or "Speaker"

        sequence_number = await db["transcript_chunks"].count_documents({"meeting_id": meeting_id}) + 1
        now = datetime.now(timezone.utc)

        await db["transcript_chunks"].insert_one(
            {
                "id": str(uuid.uuid4()),
                "meeting_id": meeting_id,
                "owner_id": owner["id"],
                "speaker_label": speaker_label,
                "sequence_number": sequence_number,
                "transcript_text": payload.transcript_text,
                "started_at": payload.started_at,
                "ended_at": payload.ended_at,
                "expires_at": self._build_expiration_timestamp(
                    now=now,
                    retention_days=owner.get("transcript_retention_days"),
                ),
                "created_at": now,
                "updated_at": now,
            }
        )
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"status": "in_progress", "updated_at": now}},
        )
        await self._update_participants_from_text(
            db=db,
            meeting=meeting,
            owner=owner,
            meeting_id=meeting_id,
            transcript_text=payload.transcript_text,
            speaker_labels=[speaker_label],
        )

        return TranscriptChunkResponse(
            meeting_id=meeting_id,
            transcript=payload.transcript_text,
            speaker_label=speaker_label,
            sequence_number=sequence_number,
        )

    async def transcribe_stream_message(self, meeting_id: str, payload: dict) -> dict:
        audio_base64 = payload.get("audio_base64")
        mime_type = payload.get("mime_type", "audio/webm")
        language_hint = payload.get("transcription_language")
        if not audio_base64:
            raise ValueError("audio_base64 is required")

        db = get_database()
        meeting = await db["meetings"].find_one({"id": meeting_id}, {"owner_id": 1})
        owner_id = meeting.get("owner_id") if meeting else None
        segments = await self._transcribe_base64_audio(audio_base64, mime_type, language_hint, owner_id=owner_id)
        transcript = " ".join(segment["text"] for segment in segments if segment["text"].strip()).strip()
        known_identity_names = await self._get_known_speaker_identity_names(owner_id, None) if owner_id else []
        speaker_label = self._resolve_chunk_speaker_label(
            segments=segments,
            fallback_label=payload.get("speaker_label"),
            transcript_text=transcript,
            owner=None,
            known_identity_names=known_identity_names,
        )
        return {
            "meeting_id": meeting_id,
            "status": "ok",
            "transcript": transcript,
            "speaker_label": speaker_label,
        }

    async def discard_transcript_session(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting_id: str,
        payload: TranscriptSessionDiscardRequest,
    ) -> TranscriptDiscardResponse:
        meeting = await self._get_meeting(db=db, owner_id=owner["id"], meeting_id=meeting_id)
        if not meeting:
            raise ValueError("Meeting not found")

        cutoff = payload.session_started_at
        delete_result = await db["transcript_chunks"].delete_many(
            {
                "meeting_id": meeting_id,
                "$or": [
                    {"created_at": {"$gte": cutoff}},
                    {"started_at": {"$gte": cutoff}},
                    {"ended_at": {"$gte": cutoff}},
                ],
            }
        )

        remaining_chunks = await db["transcript_chunks"].count_documents({"meeting_id": meeting_id})
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {
                "$set": {
                    "status": "in_progress" if remaining_chunks else "scheduled",
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

        return TranscriptDiscardResponse(
            meeting_id=meeting_id,
            deleted_count=delete_result.deleted_count,
        )

    async def apply_retention_policy_to_owner(
        self,
        db: AsyncIOMotorDatabase,
        owner_id: str,
        retention_days: int | None,
    ) -> None:
        meeting_ids = await db["meetings"].find(
            {"owner_id": owner_id},
            {"id": 1},
        ).to_list(length=10000)
        ids = [meeting["id"] for meeting in meeting_ids if meeting.get("id")]
        if not ids:
            return

        chunks = await db["transcript_chunks"].find(
            {"meeting_id": {"$in": ids}},
            {"id": 1, "created_at": 1},
        ).to_list(length=100000)
        if not chunks:
            return

        operations: list[UpdateOne] = []
        for chunk in chunks:
            chunk_id = chunk.get("id")
            if not chunk_id:
                continue

            if retention_days is None:
                operations.append(
                    UpdateOne(
                        {"id": chunk_id},
                        {
                            "$unset": {"expires_at": ""},
                            "$set": {"owner_id": owner_id},
                        },
                    )
                )
                continue

            created_at = chunk.get("created_at")
            expires_at = self._build_expiration_timestamp(
                now=created_at if isinstance(created_at, datetime) else datetime.now(timezone.utc),
                retention_days=retention_days,
            )
            operations.append(
                UpdateOne(
                    {"id": chunk_id},
                    {
                        "$set": {
                            "owner_id": owner_id,
                            "expires_at": expires_at,
                        }
                    },
                )
            )

        if operations:
            await db["transcript_chunks"].bulk_write(operations, ordered=False)

    async def _transcribe_base64_audio(
        self,
        audio_base64: str,
        mime_type: str,
        language_hint: str | None = None,
        owner_id: str | None = None,
    ) -> list[dict]:
        raw_audio = self._decode_audio_payload(audio_base64)

        extension = self._guess_extension(mime_type)
        temp_path = await asyncio.to_thread(self._write_temp_audio_file, raw_audio, extension)
        prepared_path = await asyncio.to_thread(self._prepare_audio_for_transcription, temp_path)

        try:
            keyterms = await self._get_deepgram_keyterms(owner_id)
            return await transcribe_audio_file(prepared_path, language_hint=language_hint, keyterms=keyterms)
        except RuntimeError as exc:
            raise ValueError(str(exc)) from exc
        finally:
            try:
                os.remove(temp_path)
            except FileNotFoundError:
                pass
            if prepared_path != temp_path:
                try:
                    os.remove(prepared_path)
                except FileNotFoundError:
                    pass

    async def _get_deepgram_keyterms(self, owner_id: str | None) -> list[str]:
        if not owner_id:
            return []

        db = get_database()
        entries = await db["vocabulary_entries"].find(
            {"owner_id": owner_id},
            {"canonical": 1, "updated_at": 1},
        ).sort("updated_at", -1).to_list(length=120)

        keyterms: list[str] = []
        seen: set[str] = set()
        for entry in entries:
            canonical = " ".join(str(entry.get("canonical") or "").split()).strip()
            if not canonical:
                continue
            folded = canonical.casefold()
            if folded in seen:
                continue
            seen.add(folded)
            keyterms.append(canonical)
        return keyterms

    def _write_temp_audio_file(self, raw_audio: bytes, extension: str) -> str:
        temp_dir = Path(__file__).resolve().parents[2] / "models" / "tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=f".{extension}",
            delete=False,
            dir=temp_dir,
        ) as handle:
            handle.write(raw_audio)
            return handle.name

    def _decode_audio_payload(self, audio_base64: str) -> bytes:
        try:
            return base64.b64decode(audio_base64, validate=True)
        except binascii.Error as exc:
            raise ValueError("Invalid base64 audio payload") from exc

    def _guess_extension(self, mime_type: str) -> str:
        if "/" not in mime_type:
            return "wav"

        subtype = mime_type.split("/", maxsplit=1)[1].lower()
        subtype = subtype.split(";", maxsplit=1)[0]
        if subtype == "mpeg":
            return "mp3"
        return subtype

    def _persist_recording_file(self, meeting_id: str, raw_audio: bytes, mime_type: str) -> dict[str, str | int | float]:
        extension = self._guess_extension(mime_type)
        recordings_dir = settings.recordings_storage_path
        recordings_dir.mkdir(parents=True, exist_ok=True)
        recording_path = recordings_dir / f"{meeting_id}.{extension}"
        recording_path.write_bytes(raw_audio)
        return {
            "extension": extension,
            "size_bytes": len(raw_audio),
            "duration_seconds": 0.0,
        }

    def _prepare_audio_for_transcription(self, source_path: str) -> str:
        source = Path(source_path)
        if source.suffix.lower() == ".wav":
            try:
                import wave

                with wave.open(str(source), "rb") as wav_file:
                    if wav_file.getframerate() == 16000 and wav_file.getnchannels() == 1:
                        return source_path
            except wave.Error:
                pass

        temp_dir = source.parent
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".wav",
            delete=False,
            dir=temp_dir,
        ) as handle:
            prepared_path = handle.name

        self._convert_audio_to_16khz_wav(source_path, prepared_path)
        return prepared_path

    def _convert_audio_to_16khz_wav(self, source_path: str, destination_path: str) -> None:
        import subprocess

        command = [
            "ffmpeg",
            "-y",
            "-nostdin",
            "-i",
            source_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            destination_path,
        ]

        try:
            subprocess.run(command, check=True, capture_output=True)
        except subprocess.CalledProcessError as exc:
            raise ValueError(
                f"Failed to prepare audio for transcription: {exc.stderr.decode(errors='ignore')}"
            ) from exc

    async def _update_participants_from_text(
        self,
        db: AsyncIOMotorDatabase,
        meeting: dict,
        owner: dict,
        meeting_id: str,
        transcript_text: str,
        speaker_labels: list[str] | None = None,
    ) -> None:
        candidates = self._extract_participant_candidates(transcript_text=transcript_text, owner=owner)
        for label in speaker_labels or []:
            clean_label = self._clean_speaker_label(label)
            if clean_label and not self._is_generic_speaker_label(clean_label):
                candidates.append(clean_label)
        if not candidates:
            return

        existing = list(meeting.get("participants") or [])
        merged: list[str] = existing[:]
        existing_lower = {name.strip().lower() for name in merged if name.strip()}

        for candidate in candidates:
            lowered = candidate.lower()
            if lowered in existing_lower:
                continue
            merged.append(candidate)
            existing_lower.add(lowered)

        if merged == existing:
            return

        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"participants": merged, "updated_at": datetime.now(timezone.utc)}},
        )

    def _extract_participant_candidates(self, transcript_text: str, owner: dict) -> list[str]:
        text = transcript_text.strip()
        if not text:
            return []

        candidates: list[str] = []
        patterns = [
            r"\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})",
            r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:here|speaking)\b",
        ]

        for pattern in patterns:
            for match in re.findall(pattern, text, flags=re.IGNORECASE):
                candidate = " ".join(part.capitalize() for part in match.split())
                if self._is_plausible_participant_name(candidate):
                    candidates.append(candidate)

        owner_name = (owner.get("full_name") or "").strip()
        if owner_name:
            owner_tokens = [token for token in re.split(r"\s+", owner_name.lower()) if token]
            text_lower = text.lower()
            if any(len(token) >= 3 and token in text_lower for token in owner_tokens):
                candidates.append(owner_name)

        deduped: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            lowered = candidate.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            deduped.append(candidate)

        return deduped

    async def _get_known_speaker_identity_names(self, owner_id: str, owner: dict | None = None) -> list[str]:
        db = get_database()
        identities = await self.speakers.list_identities(db=db, owner_id=owner_id)
        names = [str(item.get("name") or "").strip() for item in identities if str(item.get("name") or "").strip()]
        if owner and owner.get("full_name"):
            names.append(str(owner["full_name"]).strip())
        deduped: list[str] = []
        seen: set[str] = set()
        for name in names:
            lowered = name.casefold()
            if lowered in seen:
                continue
            seen.add(lowered)
            deduped.append(name)
        return deduped

    def _resolve_chunk_speaker_label(
        self,
        *,
        segments: list[dict],
        fallback_label: str | None,
        transcript_text: str,
        owner: dict | None,
        known_identity_names: list[str] | None = None,
    ) -> str | None:
        next_known_identity_names = list(known_identity_names or [])
        if owner and owner.get("full_name"):
            next_known_identity_names.append(str(owner.get("full_name")).strip())
        raw_label = next((self._clean_speaker_label(segment.get("speaker_label")) for segment in segments if self._clean_speaker_label(segment.get("speaker_label"))), None)
        return self._resolve_segment_speaker_label(
            raw_speaker_label=raw_label or fallback_label or "Speaker",
            transcript_text=transcript_text,
            known_identity_names=next_known_identity_names,
            owner=owner,
            speaker_resolution_map={},
        )

    def _resolve_segment_speaker_label(
        self,
        *,
        raw_speaker_label: str,
        transcript_text: str,
        known_identity_names: list[str],
        owner: dict | None,
        speaker_resolution_map: dict[str, str],
    ) -> str:
        clean_raw_label = self._clean_speaker_label(raw_speaker_label) or "Speaker"
        if clean_raw_label in speaker_resolution_map:
            return speaker_resolution_map[clean_raw_label]

        resolved_name = self._extract_named_identity_from_text(
            transcript_text=transcript_text,
            known_identity_names=known_identity_names,
            owner=owner,
        )
        if resolved_name:
            if self._is_generic_speaker_label(clean_raw_label):
                speaker_resolution_map[clean_raw_label] = resolved_name
            return resolved_name

        if clean_raw_label in speaker_resolution_map:
            return speaker_resolution_map[clean_raw_label]
        return clean_raw_label

    def _extract_named_identity_from_text(
        self,
        *,
        transcript_text: str,
        known_identity_names: list[str],
        owner: dict | None,
    ) -> str | None:
        text = transcript_text.strip()
        if not text:
            return None

        patterns = [
            r"\b(?:my name is|this is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})",
            r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:here|speaking)\b",
        ]
        for pattern in patterns:
            matches = re.findall(pattern, text, flags=re.IGNORECASE)
            for match in matches:
                candidate = " ".join(part.capitalize() for part in match.split())
                if self._is_plausible_participant_name(candidate):
                    return candidate

        for name in known_identity_names:
            clean_name = " ".join(str(name).split()).strip()
            if not clean_name:
                continue
            lowered_name = clean_name.casefold()
            if re.search(rf"\b(?:my name is|this is|i am|i'm)\s+{re.escape(clean_name)}\b", text, flags=re.IGNORECASE):
                return clean_name
            if clean_name == (owner or {}).get("full_name"):
                owner_tokens = [token for token in lowered_name.split() if len(token) >= 3]
                if owner_tokens and any(token in text.casefold() for token in owner_tokens):
                    return clean_name

        return None

    def _clean_speaker_label(self, value: str | None) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip()

    def _is_generic_speaker_label(self, value: str) -> bool:
        normalized = value.casefold()
        return normalized in {"speaker", "unknown speaker"} or bool(re.fullmatch(r"speaker\s+\d+", normalized))

    def _is_plausible_participant_name(self, candidate: str) -> bool:
        cleaned = candidate.strip()
        if not cleaned:
            return False

        blacklist = {
            "Hello",
            "Hi",
            "Hey",
            "Thanks",
            "Thank You",
            "Speaker",
            "Recording",
            "Meeting",
            "English",
            "Hindi",
            "Kannada",
            "Trying",
            "Mostly",
            "Platform",
            "Demonstration",
            "Review",
            "Summary",
            "Overview",
            "Today",
            "Note",
            "Notes",
        }
        if cleaned in blacklist:
            return False

        if len(cleaned) < 3 or len(cleaned) > 40:
            return False

        parts = cleaned.split()
        if len(parts) > 3:
            return False
        if any(len(part) < 2 for part in parts):
            return False
        if any(not part[0].isupper() for part in parts):
            return False

        return True

    def _is_low_quality_transcript(self, transcript: str) -> bool:
        normalized = transcript.strip()
        if not normalized:
            return True

        lowered = normalized.lower()
        if len(normalized) <= 2:
            return True

        repeated_nonword = re.search(r"([^\w\s])\1{7,}", normalized)
        if repeated_nonword:
            return True

        repeated_char = re.search(r"(.)\1{14,}", normalized.replace(" ", ""))
        if repeated_char:
            return True

        unique_chars = set(normalized.replace(" ", ""))
        if len(normalized) >= 20 and len(unique_chars) <= 3:
            return True

        bar_like_chars = sum(1 for char in normalized if char in {"|", "।", "॥", "¦", "‖"})
        if bar_like_chars >= max(8, len(normalized) // 3):
            return True

        tokens = [token for token in re.split(r"\s+", lowered) if token]
        if len(tokens) >= 4:
            unique_tokens = set(tokens)
            if len(unique_tokens) == 1:
                return True
            if len(unique_tokens) == 2 and max(tokens.count(token) for token in unique_tokens) >= len(tokens) - 1:
                return True

        return False

    async def _get_meeting(self, db: AsyncIOMotorDatabase, owner_id: str, meeting_id: str) -> dict | None:
        return await db["meetings"].find_one({"id": meeting_id, "owner_id": owner_id})

    def _offset_datetime(self, base: datetime | None, offset_seconds: float | None) -> datetime | None:
        if base is None or offset_seconds is None:
            return base
        return base + timedelta(seconds=float(offset_seconds))

    def _build_expiration_timestamp(
        self,
        now: datetime,
        retention_days: int | None,
    ) -> datetime | None:
        if not retention_days:
            return None
        return now + timedelta(days=retention_days)
