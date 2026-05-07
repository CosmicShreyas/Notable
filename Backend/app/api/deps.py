from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.db.mongodb import get_database


async def get_db_session() -> AsyncIOMotorDatabase:
    return get_database()


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
        )

    token = authorization.split(" ", maxsplit=1)[1]

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
        ) from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token subject missing",
        )

    user = await db["users"].find_one({"id": user_id})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


async def get_optional_current_user(
    authorization: str | None = Header(default=None),
    db: AsyncIOMotorDatabase = Depends(get_db_session),
) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.split(" ", maxsplit=1)[1]

    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    return await db["users"].find_one({"id": user_id})
