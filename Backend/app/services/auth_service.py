import base64
import json
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.core.security import create_access_token
from app.schemas.auth import GoogleCallbackResponse
from app.schemas.user import UserResponse
from app.services.google_service import GoogleOAuthService


class AuthService:
    def build_google_authorization_url(self, redirect_to: str | None = None) -> str:
        if not settings.google_client_id:
            raise ValueError("GOOGLE_CLIENT_ID is not configured")
        if not settings.google_redirect_uri:
            raise ValueError("GOOGLE_REDIRECT_URI is not configured")

        state = None
        if redirect_to:
            state_payload = {"redirect_to": redirect_to}
            state = base64.urlsafe_b64encode(json.dumps(state_payload).encode("utf-8")).decode("utf-8")

        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": " ".join(settings.google_scopes),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
        }
        if state:
            params["state"] = state

        query = urlencode(params)
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    async def handle_google_callback(
        self,
        db: AsyncIOMotorDatabase,
        code: str,
    ) -> GoogleCallbackResponse:
        oauth = GoogleOAuthService()
        token_data = await oauth.exchange_code_for_tokens(code=code)
        profile = await oauth.fetch_user_profile(access_token=token_data["access_token"])

        google_sub = profile.get("sub")
        email = profile.get("email")
        if not google_sub or not email:
            raise ValueError("Google profile response missing required fields")

        now = datetime.now(timezone.utc)
        expires_in_seconds = int(token_data.get("expires_in", 3600))
        google_token_expires_at = now + timedelta(seconds=expires_in_seconds)
        granted_scopes = [
            scope.strip()
            for scope in str(token_data.get("scope") or "").split(" ")
            if scope.strip()
        ]
        user = await db["users"].find_one({"google_sub": google_sub})

        if not user:
            user = {
                "id": str(uuid.uuid4()),
                "email": email,
                "full_name": profile.get("name"),
                "avatar_url": profile.get("picture"),
                "google_sub": google_sub,
                "google_access_token": token_data.get("access_token"),
                "google_refresh_token": token_data.get("refresh_token"),
                "google_token_expires_at": google_token_expires_at,
                "google_granted_scopes": granted_scopes,
                "timezone": "UTC",
                "default_link_sharing": "link",
                "transcript_retention_days": None,
                "allow_anonymized_summary_samples": False,
                "email_summary_snapshots": True,
                "created_at": now,
                "updated_at": now,
            }
            await db["users"].insert_one(user)
        else:
            user["google_access_token"] = token_data.get("access_token")
            user["google_refresh_token"] = token_data.get("refresh_token") or user.get("google_refresh_token")
            user["google_token_expires_at"] = google_token_expires_at
            user["google_granted_scopes"] = granted_scopes or user.get("google_granted_scopes") or []
            user["full_name"] = profile.get("name") or user.get("full_name")
            user["avatar_url"] = profile.get("picture") or user.get("avatar_url")
            user["updated_at"] = now
            await db["users"].update_one(
                {"id": user["id"]},
                {
                    "$set": {
                        "google_access_token": user["google_access_token"],
                        "google_refresh_token": user["google_refresh_token"],
                        "google_token_expires_at": user["google_token_expires_at"],
                        "google_granted_scopes": user["google_granted_scopes"],
                        "full_name": user["full_name"],
                        "avatar_url": user["avatar_url"],
                        "updated_at": user["updated_at"],
                    }
                },
            )

        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.access_token_expire_minutes
        )
        app_token = create_access_token(subject=user["id"])

        return GoogleCallbackResponse(
            access_token=app_token,
            expires_at=expires_at,
            user=UserResponse.model_validate(user),
        )

    def resolve_post_login_redirect(self, state: str | None) -> str:
        if not state:
            return settings.google_post_login_redirect_url

        try:
            decoded = base64.urlsafe_b64decode(state.encode("utf-8")).decode("utf-8")
            payload = json.loads(decoded)
        except Exception:
            return settings.google_post_login_redirect_url

        redirect_to = payload.get("redirect_to")
        if not isinstance(redirect_to, str) or not redirect_to.strip():
            return settings.google_post_login_redirect_url

        return redirect_to

    async def logout(self, db: AsyncIOMotorDatabase, user_id: str) -> None:
        await db["users"].update_one(
            {"id": user_id},
            {"$set": {"updated_at": datetime.now(timezone.utc)}},
        )
