from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.api.deps import get_current_user, get_db_session
from app.schemas.readout import ReadoutGenerateRequest, ReadoutListResponse, ReadoutResponse
from app.services.readout_service import ReadoutService

router = APIRouter()


@router.get("", response_model=ReadoutListResponse)
async def list_readouts(
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> ReadoutListResponse:
    service = ReadoutService()
    return await service.list_readouts(db=db, owner=current_user)


@router.post("", response_model=ReadoutResponse)
async def generate_readout(
    payload: ReadoutGenerateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db_session),
    current_user: dict = Depends(get_current_user),
) -> ReadoutResponse:
    service = ReadoutService()
    return await service.generate_readout(db=db, owner=current_user, payload=payload)
