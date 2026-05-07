from fastapi import APIRouter

from app.api.routes import analytics, auth, calendar, chat, comments, exports, google_meet, health, meetings, readouts, share, tasks, teams, transcripts, users, vocabulary
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])

v1_router = APIRouter(prefix=settings.api_v1_str)
v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
v1_router.include_router(users.router, prefix="/users", tags=["users"])
v1_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
v1_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
v1_router.include_router(exports.router, prefix="/exports", tags=["exports"])
v1_router.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
v1_router.include_router(readouts.router, prefix="/readouts", tags=["readouts"])
v1_router.include_router(comments.router, prefix="/comments", tags=["comments"])
v1_router.include_router(google_meet.router, prefix="/google-meet", tags=["google-meet"])
v1_router.include_router(chat.router, tags=["chat"])
v1_router.include_router(share.router, prefix="/share", tags=["share"])
v1_router.include_router(teams.router, prefix="/teams", tags=["teams"])
v1_router.include_router(vocabulary.router, prefix="/vocabulary", tags=["vocabulary"])
v1_router.include_router(meetings.router, prefix="/meetings", tags=["meetings"])
v1_router.include_router(transcripts.router, prefix="/meetings", tags=["transcripts"])

api_router.include_router(v1_router)
