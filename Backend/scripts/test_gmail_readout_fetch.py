import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.services.external_search_service import ExternalSearchService  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser(
        description="Test the Gmail fetch path used by Notable Readouts.",
    )
    parser.add_argument(
        "--email",
        required=True,
        help="Email address of the Notable user whose connected Google account should be tested.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="Look back this many days for Gmail activity. Default: 7",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=8,
        help="Maximum number of Gmail messages to fetch. Default: 8",
    )
    args = parser.parse_args()

    since = datetime.now(timezone.utc) - timedelta(days=max(1, args.days))
    service = ExternalSearchService()
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]

    try:
        user = await db["users"].find_one({"email": args.email.strip()})
        if not user:
            print(f"User not found for email: {args.email}")
            return 1

        print("Testing Gmail Readouts fetch")
        print(f"User: {user.get('email')}")
        print(f"User ID: {user.get('id')}")
        print(f"Since: {since.isoformat()}")
        print(f"Google connected: {bool(user.get('google_access_token') or user.get('google_refresh_token'))}")
        print(f"Stored scopes: {user.get('google_granted_scopes') or []}")
        print("-" * 60)

        messages, notice = await service.get_recent_gmail_messages(
            db=db,
            owner=user,
            since=since,
            limit=max(1, args.limit),
        )

        print(f"Notice: {notice or '(none)'}")
        print(f"Fetched Gmail messages: {len(messages)}")
        print("-" * 60)

        if not messages:
            print("No Gmail messages were returned by the Readouts fetch path.")
            return 0

        for index, item in enumerate(messages, start=1):
            print(f"[{index}]")
            print(f"  Subject : {item.get('subject') or '(no subject)'}")
            print(f"  From    : {item.get('from') or 'Unknown sender'}")
            print(f"  To      : {item.get('to') or '(not available)'}")
            print(f"  Date    : {item.get('date') or '(unknown date)'}")
            print(f"  Labels  : {', '.join(item.get('label_ids') or []) or '(none)'}")
            print(f"  Snippet : {item.get('snippet') or '(no snippet)'}")
            print()

        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
