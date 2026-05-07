from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.auth import GoogleCallbackResponse, GoogleLoginResponse
from app.services.auth_service import AuthService

router = APIRouter()


@router.get("/google/login", response_model=GoogleLoginResponse)
async def google_login_url(
    redirect_to: str | None = Query(default=None, description="Frontend URL to redirect to after login"),
) -> GoogleLoginResponse:
    service = AuthService()
    try:
        return GoogleLoginResponse(
            authorization_url=service.build_google_authorization_url(redirect_to=redirect_to),
            provider="google",
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/google/callback", response_model=GoogleCallbackResponse)
async def google_callback(
    code: str = Query(..., description="OAuth authorization code"),
    state: str | None = Query(default=None, description="Opaque OAuth state"),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
) -> GoogleCallbackResponse | RedirectResponse:
    service = AuthService()

    try:
        result = await service.handle_google_callback(db=db, code=code)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    redirect_to = service.resolve_post_login_redirect(state)
    query = urlencode(
        {
            "token": result.access_token,
            "expires_at": result.expires_at.isoformat(),
        }
    )
    redirect_parts = urlsplit(redirect_to)
    redirect_query = dict(parse_qsl(redirect_parts.query, keep_blank_values=True))
    redirect_query["token"] = result.access_token
    redirect_query["expires_at"] = result.expires_at.isoformat()
    redirect_url = urlunsplit(
        (
            redirect_parts.scheme,
            redirect_parts.netloc,
            redirect_parts.path,
            urlencode(redirect_query),
            redirect_parts.fragment,
        )
    )
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> dict[str, str]:
    service = AuthService()
    await service.logout(db=db, user_id=current_user["id"])
    return {"detail": "Logged out"}
