from datetime import datetime, timezone

from fastapi import APIRouter
from app.services.transcription_provider_service import get_transcription_provider_status

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "transcription": get_transcription_provider_status(),
    }
