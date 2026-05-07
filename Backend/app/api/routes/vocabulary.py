from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import DuplicateKeyError

from app.api.deps import get_current_user, get_db_session
from app.schemas.vocabulary import (
    VocabularyEntryCreateRequest,
    VocabularyEntryResponse,
    VocabularyEntryUpdateRequest,
    VocabularyListResponse,
)
from app.services.vocabulary_service import VocabularyService

router = APIRouter()


@router.get("", response_model=VocabularyListResponse)
async def list_vocabulary_entries(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> VocabularyListResponse:
    service = VocabularyService()
    items = await service.list_entries(db=db, owner_id=current_user["id"])
    return VocabularyListResponse(items=[VocabularyEntryResponse.model_validate(item) for item in items])


@router.post("", response_model=VocabularyEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_vocabulary_entry(
    payload: VocabularyEntryCreateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> VocabularyEntryResponse:
    service = VocabularyService()
    try:
        entry = await service.create_entry(
            db=db,
            owner_id=current_user["id"],
            canonical=payload.canonical,
            aliases=payload.aliases,
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That canonical term already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return VocabularyEntryResponse.model_validate(entry)


@router.patch("/{entry_id}", response_model=VocabularyEntryResponse)
async def update_vocabulary_entry(
    entry_id: str,
    payload: VocabularyEntryUpdateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> VocabularyEntryResponse:
    service = VocabularyService()
    try:
        entry = await service.update_entry(
            db=db,
            owner_id=current_user["id"],
            entry_id=entry_id,
            canonical=payload.canonical,
            aliases=payload.aliases,
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That canonical term already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary entry not found")
    return VocabularyEntryResponse.model_validate(entry)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vocabulary_entry(
    entry_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> None:
    service = VocabularyService()
    deleted = await service.delete_entry(db=db, owner_id=current_user["id"], entry_id=entry_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vocabulary entry not found")
