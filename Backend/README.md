# Notable Backend

FastAPI backend for Notable, a meeting transcription, AI note-taking, and meeting memory platform.

## What this backend includes

- FastAPI app with versioned REST routes
- WebSocket endpoint for live transcription chunk streaming
- Configurable cloud speech-to-text via Deepgram or Azure Speech
- Ollama integration for summaries and meeting chat
- Google OAuth entry points
- Google Calendar sync endpoints
- Meeting memory retrieval for cross-meeting AI chat
- Local MongoDB persistence with Motor

## Important product note

This backend is designed to work without meeting bots. The intended capture model is:

- the frontend or desktop client captures microphone/system audio locally
- audio chunks are streamed to the backend
- the backend transcribes, stores, summarizes, and serves chat/memory APIs

That approach works across Zoom, Google Meet, Teams, and similar platforms because the backend is not tied to any one meeting provider.

## Run locally

1. Create a virtual environment
2. Install dependencies
3. Copy `.env.example` to `.env`
4. Start the server

```powershell
cd Backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Transcription runtime notes

- Live transcription now uses a cloud provider adapter inside this backend.
- Supported providers:
  - `deepgram`
  - `azure`
- Useful `.env` knobs:
  - `TRANSCRIPTION_PROVIDER=deepgram`
  - `TRANSCRIPTION_LANGUAGE=`
  - `TRANSCRIPTION_TIMEOUT_SECONDS=180`
  - `DEEPGRAM_API_KEY=...`
  - `DEEPGRAM_MODEL=nova-3`
  - `AZURE_SPEECH_KEY=...`
  - `AZURE_SPEECH_REGION=...`
  - `AZURE_SPEECH_ENDPOINT=...`
  - `AZURE_SPEECH_AUTO_DETECT_LANGUAGES=en-US,hi-IN,kn-IN`
- Leave `TRANSCRIPTION_LANGUAGE` empty to use auto detection.
- Deepgram uses multilingual transcription when language is left blank.
- Azure uses auto-detect over the configured language list when language is left blank.
- Ollama uses the configured `OLLAMA_CHAT_MODEL` from `.env`.
- `ffmpeg` should still be installed on the machine because audio decoding/transcoding remains part of the transcription flow.

## Core routes

- `GET /health`
- `GET /api/v1/auth/google/login`
- `GET /api/v1/auth/google/callback`
- `GET /api/v1/users/me`
- `GET /api/v1/calendar/events`
- `POST /api/v1/meetings`
- `GET /api/v1/meetings`
- `GET /api/v1/meetings/{meeting_id}`
- `POST /api/v1/meetings/{meeting_id}/summary`
- `POST /api/v1/meetings/{meeting_id}/chat`
- `POST /api/v1/meetings/{meeting_id}/transcripts/chunk`
- `WS /api/v1/live-transcription/ws/{meeting_id}`

## Next production steps

- harden MongoDB indexes and document validation
- persist OAuth state securely
- encrypt provider tokens at rest
- replace lexical memory search with embeddings/vector search
- add background workers for summary jobs and retry handling
- add file/object storage for raw audio
