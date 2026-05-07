import math
import re
from collections import defaultdict
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.schemas.analytics import (
    MeetingAnalyticsHighlight,
    MeetingAnalyticsOverview,
    MeetingAnalyticsProviderBreakdown,
    MeetingAnalyticsResponse,
    MeetingAnalyticsTopMeeting,
    MeetingAnalyticsTrendPoint,
    MeetingAnalyticsVisibilityBreakdown,
)
from app.services.vocabulary_service import VocabularyService


class AnalyticsService:
    def __init__(self) -> None:
        self.vocabulary = VocabularyService()

    async def get_meeting_analytics(self, db: AsyncIOMotorDatabase, owner: dict) -> MeetingAnalyticsResponse:
        meetings = await db["meetings"].find({"owner_id": owner["id"]}).sort("updated_at", -1).to_list(length=1000)
        shares = await db["meeting_shares"].find({"owner_id": owner["id"]}).to_list(length=1000)
        share_map = {share["meeting_id"]: share for share in shares}
        share_views = await db["shared_meeting_views"].aggregate(
            [
                {"$match": {"owner_id": owner["id"]}},
                {"$group": {"_id": "$meeting_id", "count": {"$sum": 1}}},
            ]
        ).to_list(length=1000)
        share_view_map = {item["_id"]: int(item["count"]) for item in share_views}

        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        if entries:
            meetings = [self.vocabulary.apply_entries_to_meeting(meeting=item, entries=entries) for item in meetings]

        overview = MeetingAnalyticsOverview()
        provider_stats: dict[str, dict] = defaultdict(lambda: {"meetings": 0, "duration": 0.0, "shares": 0})
        visibility_stats: dict[str, dict] = defaultdict(lambda: {"meetings": 0, "views": 0})
        monthly_stats: dict[str, dict] = {}
        ranked_meetings: list[MeetingAnalyticsTopMeeting] = []
        duration_samples: list[float] = []
        participant_samples: list[int] = []
        speaker_frequency: dict[str, int] = defaultdict(int)

        for meeting in meetings:
            transcript_chunks = await db["transcript_chunks"].find({"meeting_id": meeting["id"]}).sort("sequence_number", 1).to_list(length=10000)
            word_count = self._count_words(transcript_chunks)
            question_count = self._count_questions(transcript_chunks)
            duration_minutes = self._get_duration_minutes(meeting, transcript_chunks)
            participant_count = len([participant for participant in (meeting.get("participants") or []) if participant])
            action_items_count = len(meeting.get("action_items") or [])
            share = share_map.get(meeting["id"])
            share_visibility = share.get("visibility") if share else None
            share_count = share_view_map.get(meeting["id"], 0)

            overview.total_meetings += 1
            overview.total_action_items += action_items_count
            overview.total_words += word_count
            overview.total_questions += question_count
            if meeting.get("summary"):
                overview.summarized_meetings += 1
            if meeting.get("recording_file_path"):
                overview.meetings_with_recordings += 1
            if share:
                overview.shared_meetings += 1

            if duration_minutes > 0:
                duration_samples.append(duration_minutes)
            participant_samples.append(participant_count)

            for participant in meeting.get("participants") or []:
                clean_participant = str(participant or "").strip()
                if not clean_participant or self._is_generic_speaker_label(clean_participant):
                    continue
                speaker_frequency[clean_participant] += 1

            provider_key = (meeting.get("provider") or "other").strip() or "other"
            provider_entry = provider_stats[provider_key]
            provider_entry["meetings"] += 1
            provider_entry["duration"] += duration_minutes
            provider_entry["shares"] += 1 if share else 0

            visibility_key = (share_visibility or "not_shared").strip() or "not_shared"
            visibility_entry = visibility_stats[visibility_key]
            visibility_entry["meetings"] += 1
            visibility_entry["views"] += share_count

            month_key = self._month_key(meeting.get("updated_at"))
            month_entry = monthly_stats.setdefault(month_key, {"meetings": 0, "action_items": 0, "words": 0})
            month_entry["meetings"] += 1
            month_entry["action_items"] += action_items_count
            month_entry["words"] += word_count

            ranked_meetings.append(
                MeetingAnalyticsTopMeeting(
                    meeting_id=meeting["id"],
                    title=meeting.get("title") or "Untitled meeting",
                    provider=meeting.get("provider"),
                    updated_at=meeting.get("updated_at") or datetime.now(timezone.utc),
                    action_items=action_items_count,
                    words=word_count,
                    duration_minutes=round(duration_minutes, 1),
                    questions=question_count,
                    participants=participant_count,
                    share_visibility=share_visibility,
                    share_views=share_count,
                )
            )

        overview.average_duration_minutes = round(sum(duration_samples) / len(duration_samples), 1) if duration_samples else 0
        overview.average_participants = round(sum(participant_samples) / len(participant_samples), 1) if participant_samples else 0
        overview.average_action_items_per_meeting = round(overview.total_action_items / overview.total_meetings, 1) if overview.total_meetings else 0

        provider_breakdown = [
            MeetingAnalyticsProviderBreakdown(
                provider=provider,
                label=self._provider_label(provider),
                meetings=stats["meetings"],
                total_duration_minutes=round(stats["duration"], 1),
                average_duration_minutes=round(stats["duration"] / stats["meetings"], 1) if stats["meetings"] else 0,
                share_count=stats["shares"],
            )
            for provider, stats in sorted(provider_stats.items(), key=lambda item: (-item[1]["meetings"], item[0]))
        ]

        visibility_breakdown = [
            MeetingAnalyticsVisibilityBreakdown(
                visibility=visibility,
                label=self._visibility_label(visibility),
                meetings=stats["meetings"],
                total_views=stats["views"],
            )
            for visibility, stats in sorted(visibility_stats.items(), key=lambda item: (-item[1]["meetings"], item[0]))
        ]

        monthly_activity = [
            MeetingAnalyticsTrendPoint(
                key=month_key,
                label=self._month_label(month_key),
                meetings=stats["meetings"],
                action_items=stats["action_items"],
                words=stats["words"],
            )
            for month_key, stats in sorted(monthly_stats.items())[-6:]
        ]

        top_meetings = sorted(
            ranked_meetings,
            key=lambda item: (-item.action_items, -item.share_views, -item.duration_minutes, -item.words, item.title.lower()),
        )[:5]

        return MeetingAnalyticsResponse(
            overview=overview,
            provider_breakdown=provider_breakdown,
            visibility_breakdown=visibility_breakdown,
            monthly_activity=monthly_activity,
            top_meetings=top_meetings,
            highlights=self._build_highlights(overview, provider_breakdown, visibility_breakdown, top_meetings, speaker_frequency),
        )

    def _count_words(self, transcript_chunks: list[dict]) -> int:
        return sum(len(re.findall(r"\b[\w'-]+\b", chunk.get("transcript_text") or "")) for chunk in transcript_chunks)

    def _count_questions(self, transcript_chunks: list[dict]) -> int:
        return sum((chunk.get("transcript_text") or "").count("?") for chunk in transcript_chunks)

    def _get_duration_minutes(self, meeting: dict, transcript_chunks: list[dict]) -> float:
        explicit_duration = meeting.get("recording_duration_seconds")
        if isinstance(explicit_duration, (int, float)) and explicit_duration > 0:
            return round(float(explicit_duration) / 60.0, 1)

        playback = meeting.get("playback") or {}
        duration_seconds = playback.get("duration_seconds")
        if isinstance(duration_seconds, (int, float)) and duration_seconds > 0:
            return round(float(duration_seconds) / 60.0, 1)

        recording_started = meeting.get("recording_started_at")
        recording_ended = meeting.get("recording_ended_at")
        if isinstance(recording_started, datetime) and isinstance(recording_ended, datetime) and recording_ended > recording_started:
            return round((recording_ended - recording_started).total_seconds() / 60.0, 1)

        scheduled_start = meeting.get("scheduled_start")
        scheduled_end = meeting.get("scheduled_end")
        if isinstance(scheduled_start, datetime) and isinstance(scheduled_end, datetime) and scheduled_end > scheduled_start:
            return round((scheduled_end - scheduled_start).total_seconds() / 60.0, 1)

        transcript_starts = [chunk.get("started_at") for chunk in transcript_chunks if isinstance(chunk.get("started_at"), datetime)]
        transcript_ends = [chunk.get("ended_at") for chunk in transcript_chunks if isinstance(chunk.get("ended_at"), datetime)]
        if transcript_starts and transcript_ends:
            start_time = min(transcript_starts)
            end_time = max(transcript_ends)
            if end_time > start_time:
                return round((end_time - start_time).total_seconds() / 60.0, 1)

        return 0

    def _provider_label(self, provider: str) -> str:
        return {
            "google_meet": "Google Meet",
            "zoom": "Zoom",
            "microsoft_teams": "Microsoft Teams",
            "other": "Other",
        }.get(provider, provider.replace("_", " ").title())

    def _visibility_label(self, visibility: str) -> str:
        return {
            "team": "Team only",
            "link": "Anyone with link",
            "private": "Private",
            "not_shared": "Not shared",
        }.get(visibility, visibility.replace("_", " ").title())

    def _month_key(self, value: datetime | None) -> str:
        current = value if isinstance(value, datetime) else datetime.now(timezone.utc)
        return current.strftime("%Y-%m")

    def _month_label(self, month_key: str) -> str:
        year, month = month_key.split("-")
        return datetime(int(year), int(month), 1, tzinfo=timezone.utc).strftime("%b %Y")

    def _build_highlights(
        self,
        overview: MeetingAnalyticsOverview,
        provider_breakdown: list[MeetingAnalyticsProviderBreakdown],
        visibility_breakdown: list[MeetingAnalyticsVisibilityBreakdown],
        top_meetings: list[MeetingAnalyticsTopMeeting],
        speaker_frequency: dict[str, int],
    ) -> list[MeetingAnalyticsHighlight]:
        if overview.total_meetings == 0:
            return [
                MeetingAnalyticsHighlight(
                    title="No meetings yet",
                    body="Capture your first meeting and this dashboard will start turning transcripts, summaries, and sharing activity into trends you can actually use.",
                )
            ]

        highlights = [
            MeetingAnalyticsHighlight(
                title="Summary coverage",
                body=f"{math.floor((overview.summarized_meetings / overview.total_meetings) * 100)}% of your meetings already have AI summaries, which gives Notable much better recall and follow-through context.",
            )
        ]

        if provider_breakdown:
            primary_provider = provider_breakdown[0]
            highlights.append(
                MeetingAnalyticsHighlight(
                    title=f"{primary_provider.label} is your main lane",
                    body=f"You've logged {primary_provider.meetings} meetings there, with an average session length of {primary_provider.average_duration_minutes:.1f} minutes.",
                )
            )

        if top_meetings:
            top_meeting = top_meetings[0]
            highlights.append(
                MeetingAnalyticsHighlight(
                    title="Most action-heavy meeting",
                    body=f"\"{top_meeting.title}\" stands out with {top_meeting.action_items} action items, {top_meeting.questions} questions, and about {top_meeting.duration_minutes:.1f} minutes of captured discussion.",
                )
            )

        total_views = sum(item.total_views for item in visibility_breakdown)
        if total_views > 0:
            highlights.append(
                MeetingAnalyticsHighlight(
                    title="Shared meetings are getting opened",
                    body=f"Your shared meeting links have already been opened {total_views} times, which is a healthy sign that the notes are getting reused after the call ends.",
                )
            )

        recurring_speakers = sorted(speaker_frequency.items(), key=lambda item: (-item[1], item[0].lower()))[:3]
        if recurring_speakers:
            summary = ", ".join(f"{name} ({count})" for name, count in recurring_speakers)
            highlights.append(
                MeetingAnalyticsHighlight(
                    title="Recurring speakers",
                    body=f"The people showing up most often in your captured meetings are {summary}. Speaker renames now flow through your analytics too.",
                )
            )

        return highlights[:4]

    def _is_generic_speaker_label(self, value: str) -> bool:
        normalized = value.strip().casefold()
        return normalized in {"speaker", "unknown speaker"} or bool(re.fullmatch(r"speaker\s+\d+", normalized))
