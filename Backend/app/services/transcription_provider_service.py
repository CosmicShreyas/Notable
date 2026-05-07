import asyncio
import json
import logging
from pathlib import Path
from threading import Lock
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class TranscriptionProviderRuntime:
    def __init__(self) -> None:
        self._lock = Lock()
        self._last_error: str | None = None

    @property
    def provider(self) -> str:
        return settings.transcription_provider.strip().lower()

    def ensure_provider_configured_blocking(self) -> None:
        with self._lock:
            provider = self.provider
            try:
                if provider == "deepgram":
                    if not settings.deepgram_api_key:
                        raise RuntimeError("DEEPGRAM_API_KEY is not configured")
                elif provider == "azure":
                    if not settings.azure_speech_key:
                        raise RuntimeError("AZURE_SPEECH_KEY is not configured")
                    if not settings.azure_speech_endpoint and not settings.azure_speech_region:
                        raise RuntimeError(
                            "Set either AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION"
                        )
                else:
                    raise RuntimeError(
                        "Unsupported TRANSCRIPTION_PROVIDER. Use 'deepgram' or 'azure'."
                    )
                self._last_error = None
            except Exception as exc:
                self._last_error = str(exc)
                raise

    async def ensure_loaded(self) -> None:
        await asyncio.to_thread(self.ensure_provider_configured_blocking)

    def transcribe_file_blocking(
        self,
        audio_path: str,
        language_hint: str | None = None,
        keyterms: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        self.ensure_provider_configured_blocking()

        if self.provider == "deepgram":
            return self._transcribe_with_deepgram(audio_path, language_hint, keyterms=keyterms)
        if self.provider == "azure":
            return self._transcribe_with_azure(audio_path, language_hint)

        raise RuntimeError(
            "Unsupported TRANSCRIPTION_PROVIDER. Use 'deepgram' or 'azure'."
        )

    def _transcribe_with_deepgram(
        self,
        audio_path: str,
        language_hint: str | None = None,
        keyterms: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "model": settings.deepgram_model,
            "smart_format": "true",
            "punctuate": "true",
            "utterances": "true",
            "diarize": "true",
        }

        language = (language_hint or settings.transcription_language or "").strip().lower()
        if language:
            params["language"] = self._map_deepgram_language(language)
        else:
            params["language"] = "multi"

        request_params: list[tuple[str, str]] = list(params.items())
        for keyterm in self._prepare_deepgram_keyterms(keyterms):
            request_params.append(("keyterm", keyterm))

        try:
            with open(audio_path, "rb") as audio_file, httpx.Client(
                timeout=settings.transcription_timeout_seconds
            ) as client:
                response = client.post(
                    "https://api.deepgram.com/v1/listen",
                    params=request_params,
                    headers={"Authorization": f"Token {settings.deepgram_api_key}"},
                    content=audio_file.read(),
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as exc:
            self._last_error = str(exc)
            raise RuntimeError(f"Deepgram transcription failed: {exc}") from exc

        self._last_error = None
        return self._normalize_deepgram_response(payload)

    def _prepare_deepgram_keyterms(self, keyterms: list[str] | None) -> list[str]:
        if not keyterms:
            return []

        normalized: list[str] = []
        seen: set[str] = set()
        token_budget = 0

        for raw_keyterm in keyterms:
            keyterm = " ".join(str(raw_keyterm).split()).strip()
            if not keyterm:
                continue
            folded = keyterm.casefold()
            if folded in seen:
                continue

            estimated_tokens = max(1, len(keyterm.split()))
            if len(normalized) >= 100 or token_budget + estimated_tokens > 450:
                break

            seen.add(folded)
            token_budget += estimated_tokens
            normalized.append(keyterm)

        return normalized

    def _normalize_deepgram_response(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        results = payload.get("results", {})
        utterances = results.get("utterances")
        if isinstance(utterances, list) and utterances:
            segments: list[dict[str, Any]] = []
            for utterance in utterances:
                text = str(utterance.get("transcript", "")).strip()
                if not text:
                    continue
                speaker_value = utterance.get("speaker")
                segments.append(
                    {
                        "text": text,
                        "start": utterance.get("start"),
                        "end": utterance.get("end"),
                        "words": utterance.get("words") or [],
                        "speaker_label": self._normalize_deepgram_speaker_label(speaker_value),
                    }
                )
            if segments:
                return segments

        try:
            alternative = results["channels"][0]["alternatives"][0]
        except (KeyError, IndexError, TypeError):
            return []

        text = str(alternative.get("transcript", "")).strip()
        if not text:
            return []

        words = alternative.get("words") or []
        start = words[0].get("start") if words else None
        end = words[-1].get("end") if words else None
        speakers = [word.get("speaker") for word in words if word.get("speaker") is not None]
        speaker_label = None
        if speakers:
            primary_speaker = max(set(speakers), key=speakers.count)
            speaker_label = self._normalize_deepgram_speaker_label(primary_speaker)
        return [{"text": text, "start": start, "end": end, "words": words, "speaker_label": speaker_label}]

    def _normalize_deepgram_speaker_label(self, value: Any) -> str | None:
        if value is None:
            return None
        try:
            speaker_index = int(value)
        except (TypeError, ValueError):
            text = str(value).strip()
            return text or None
        return f"Speaker {speaker_index + 1}"

    def _transcribe_with_azure(self, audio_path: str, language_hint: str | None = None) -> list[dict[str, Any]]:
        try:
            import azure.cognitiveservices.speech as speechsdk
        except Exception as exc:
            self._last_error = str(exc)
            raise RuntimeError(
                "Azure Speech SDK is not installed. Install dependencies from requirements.txt."
            ) from exc

        try:
            speech_config = self._build_azure_speech_config(speechsdk)
            speech_config.output_format = speechsdk.OutputFormat.Detailed

            language = (language_hint or settings.transcription_language or "").strip().lower()
            audio_config = speechsdk.audio.AudioConfig(filename=audio_path)

            if language:
                speech_config.speech_recognition_language = self._map_azure_language(language)
                recognizer = speechsdk.SpeechRecognizer(
                    speech_config=speech_config,
                    audio_config=audio_config,
                )
                detected_language = language
            else:
                auto_detect = speechsdk.languageconfig.AutoDetectSourceLanguageConfig(
                    languages=settings.azure_auto_detect_languages
                )
                speech_config.set_property(
                    speechsdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
                    "Continuous",
                )
                recognizer = speechsdk.SpeechRecognizer(
                    speech_config=speech_config,
                    auto_detect_source_language_config=auto_detect,
                    audio_config=audio_config,
                )
                detected_language = None

            result = recognizer.recognize_once_async().get()
            reason = result.reason

            if reason == speechsdk.ResultReason.NoMatch:
                return []
            if reason != speechsdk.ResultReason.RecognizedSpeech:
                cancellation = speechsdk.CancellationDetails(result)
                raise RuntimeError(
                    f"Azure recognition failed: {cancellation.reason} {cancellation.error_details or ''}".strip()
                )

            try:
                payload = json.loads(result.json)
            except Exception:
                payload = {}

            if not detected_language:
                try:
                    autodetect = speechsdk.AutoDetectSourceLanguageResult(result)
                    detected_language = autodetect.language
                except Exception:
                    detected_language = None

            words = (
                payload.get("NBest", [{}])[0].get("Words", [])
                if isinstance(payload, dict)
                else []
            )
            normalized_words = [
                {
                    "word": word.get("Word"),
                    "start": _ticks_to_seconds(word.get("Offset")),
                    "end": _ticks_to_seconds(word.get("Offset", 0) + word.get("Duration", 0)),
                    "confidence": word.get("Confidence"),
                }
                for word in words
            ]

            text = result.text.strip()
            if not text:
                return []

            start = normalized_words[0]["start"] if normalized_words else None
            end = normalized_words[-1]["end"] if normalized_words else None
            logger.info("Azure Speech detected language: %s", detected_language or "unknown")
            self._last_error = None
            return [{"text": text, "start": start, "end": end, "words": normalized_words}]
        except Exception as exc:
            self._last_error = str(exc)
            raise RuntimeError(f"Azure Speech transcription failed: {exc}") from exc

    def _build_azure_speech_config(self, speechsdk: Any) -> Any:
        if settings.azure_speech_endpoint:
            return speechsdk.SpeechConfig(
                subscription=settings.azure_speech_key,
                endpoint=settings.azure_speech_endpoint,
            )
        return speechsdk.SpeechConfig(
            subscription=settings.azure_speech_key,
            region=settings.azure_speech_region,
        )

    def _map_deepgram_language(self, language: str) -> str:
        mapping = {
            "en": "en",
            "english": "en",
            "hi": "hi",
            "hindi": "hi",
            "kn": "kn",
            "kannada": "kn",
        }
        return mapping.get(language, language)

    def _map_azure_language(self, language: str) -> str:
        mapping = {
            "en": "en-US",
            "english": "en-US",
            "hi": "hi-IN",
            "hindi": "hi-IN",
            "kn": "kn-IN",
            "kannada": "kn-IN",
        }
        return mapping.get(language, language)

    def status(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "last_error": self._last_error,
            "deepgram_model": settings.deepgram_model if self.provider == "deepgram" else None,
            "azure_endpoint": settings.azure_speech_endpoint if self.provider == "azure" else None,
            "language": settings.transcription_language or "auto",
        }


def _ticks_to_seconds(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value) / 10_000_000
    except (TypeError, ValueError):
        return None


runtime = TranscriptionProviderRuntime()


async def preload_transcription_provider() -> None:
    await runtime.ensure_loaded()


async def transcribe_audio_file(
    audio_path: str,
    language_hint: str | None = None,
    keyterms: list[str] | None = None,
) -> list[dict[str, Any]]:
    return await asyncio.to_thread(runtime.transcribe_file_blocking, audio_path, language_hint, keyterms)


def get_transcription_provider_status() -> dict[str, Any]:
    return runtime.status()
