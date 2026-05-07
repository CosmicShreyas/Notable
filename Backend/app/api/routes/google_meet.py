from fastapi import APIRouter

from app.core.config import settings

router = APIRouter()


@router.get("/status")
async def google_meet_status() -> dict:
    addon_base_url = (settings.google_meet_addon_base_url or settings.frontend_url).rstrip("/")
    return {
        "addon_ready": bool(settings.google_meet_addon_base_url),
        "media_api_enabled": settings.google_meet_media_api_enabled,
        "cloud_project_number": settings.google_meet_cloud_project_number,
        "addon_launch_url": f"{addon_base_url}/google-meet",
        "notes": [
            "Google Meet add-ons provide the in-meeting UI surface.",
            "Live participant audio capture requires Google Meet Media API enrollment and Cloud project setup.",
            "This status endpoint only reports whether the project-level config has been provided.",
        ],
    }
