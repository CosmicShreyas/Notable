from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings

client: AsyncIOMotorClient | None = None
database: AsyncIOMotorDatabase | None = None


async def connect_to_mongo() -> None:
    global client, database
    client = AsyncIOMotorClient(settings.mongodb_url)
    database = client[settings.mongodb_db_name]

    await database["users"].create_index("id", unique=True)
    await database["users"].create_index("email", unique=True)
    await database["users"].create_index("google_sub", unique=True, sparse=True)
    await database["meetings"].create_index("id", unique=True)
    await database["meetings"].create_index([("owner_id", 1), ("updated_at", -1)])
    await database["transcript_chunks"].create_index([("meeting_id", 1), ("sequence_number", 1)])
    await database["transcript_chunks"].create_index("expires_at", expireAfterSeconds=0)
    await database["chat_messages"].create_index([("meeting_id", 1), ("created_at", 1)])
    await database["chat_messages"].create_index([("owner_id", 1), ("scope", 1), ("created_at", 1)])
    await database["summary_improvement_samples"].create_index([("owner_id", 1), ("created_at", -1)])
    await database["meeting_shares"].create_index("token", unique=True)
    await database["meeting_shares"].create_index([("meeting_id", 1), ("owner_id", 1)], unique=True)
    await database["shared_meeting_views"].create_index([("viewer_user_id", 1), ("share_token", 1)], unique=True)
    await database["shared_meeting_views"].create_index([("viewer_user_id", 1), ("updated_at", -1)])
    await database["meeting_action_item_syncs"].create_index([("meeting_id", 1), ("provider", 1), ("created_at", -1)])
    await database["readouts"].create_index("id", unique=True)
    await database["readouts"].create_index([("owner_id", 1), ("created_at", -1)])
    await database["comments"].create_index("id", unique=True)
    await database["comments"].create_index([("owner_id", 1), ("entity_type", 1), ("entity_id", 1), ("created_at", 1)])
    await database["comments"].create_index([("meeting_id", 1), ("created_at", 1)])
    await database["teams"].create_index("id", unique=True)
    team_indexes = await database["teams"].index_information()
    owner_index_name = None
    for index_name, index_info in team_indexes.items():
        if index_info.get("key") == [("owner_id", 1)]:
            owner_index_name = index_name
            if index_info.get("unique"):
                await database["teams"].drop_index(index_name)
            break
    await database["teams"].create_index("owner_id")
    await database["team_memberships"].create_index([("team_id", 1), ("user_id", 1)], unique=True)
    await database["team_memberships"].create_index([("team_id", 1), ("email", 1)], unique=True)
    await database["team_memberships"].create_index([("user_id", 1), ("status", 1)])
    await database["team_invites"].create_index("token", unique=True)
    await database["team_invites"].create_index([("team_id", 1), ("email", 1), ("status", 1)])
    await database["vocabulary_entries"].create_index("id", unique=True)
    await database["vocabulary_entries"].create_index([("owner_id", 1), ("canonical_key", 1)], unique=True)
    await database["vocabulary_entries"].create_index([("owner_id", 1), ("updated_at", -1)])
    await database["speaker_identities"].create_index("id", unique=True)
    await database["speaker_identities"].create_index([("owner_id", 1), ("normalized_name", 1)], unique=True)
    await database["speaker_identities"].create_index([("owner_id", 1), ("updated_at", -1)])
    await database["tasks"].create_index("id", unique=True)
    await database["tasks"].create_index([("owner_id", 1), ("status", 1), ("position", 1)])
    task_indexes = await database["tasks"].index_information()
    for index_name, index_info in task_indexes.items():
        if index_info.get("key") == [("owner_id", 1), ("meeting_id", 1), ("normalized_title", 1)] and index_info.get("unique"):
            await database["tasks"].drop_index(index_name)
            break
    await database["tasks"].create_index([("owner_id", 1), ("meeting_id", 1), ("normalized_title", 1)])


async def disconnect_from_mongo() -> None:
    global client, database
    if client is not None:
        client.close()
    client = None
    database = None


def get_database() -> AsyncIOMotorDatabase:
    if database is None:
        raise RuntimeError("MongoDB is not connected")
    return database
