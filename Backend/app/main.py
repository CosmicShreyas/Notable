from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.mongodb import connect_to_mongo, disconnect_from_mongo
from app.services.transcription_provider_service import preload_transcription_provider


@asynccontextmanager
async def lifespan(_: FastAPI):
    await connect_to_mongo()
    await preload_transcription_provider()
    yield
    await disconnect_from_mongo()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    debug=settings.app_debug,
    lifespan=lifespan,
    description=(
        "Professional API for meeting transcription, live notes, summaries, "
        "calendar sync, and AI meeting memory."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/", tags=["root"])
async def root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "status": "ok",
        "docs": "/docs",
    }


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_debug,
    )
