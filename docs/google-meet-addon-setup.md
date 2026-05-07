# Google Meet Add-on Integration

This repository now includes a Meet-facing Notable route at:

- `/google-meet`

and a backend status endpoint at:

- `/api/v1/google-meet/status`

## What this gives us now

- A real web surface that can be used as the Google Meet add-on launch URL
- A product page inside Notable that explains integration readiness
- Environment-driven reporting for whether the Cloud project/add-on URL are configured

## Important limitation

The Google Meet add-on UI alone does **not** grant live participant audio capture.

For actual live media capture, transcription, and assistant workflows, Google requires the
**Google Meet Media API** and Cloud project setup.

## Environment variables

Set these in the backend environment when you wire the real Google configuration:

- `GOOGLE_MEET_MEDIA_API_ENABLED=true`
- `GOOGLE_MEET_CLOUD_PROJECT_NUMBER=<your-project-number>`
- `GOOGLE_MEET_ADDON_BASE_URL=https://your-notable-domain.com`

## Expected add-on launch URL

If `GOOGLE_MEET_ADDON_BASE_URL` is set:

- `<GOOGLE_MEET_ADDON_BASE_URL>/google-meet`

Otherwise the app falls back to:

- `<FRONTEND_URL>/google-meet`

## Next implementation step

To move from the add-on UI scaffold to real in-meeting live capture:

1. Create or reuse a Google Cloud project
2. Configure OAuth and Meet add-on deployment
3. Enroll and enable the Google Meet Media API for the project
4. Add server-side handling for the Media API session lifecycle and audio ingestion
5. Route Media API audio/transcript events into Notable meeting notes and live transcription
