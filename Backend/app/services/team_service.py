import secrets
import uuid
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import settings
from app.schemas.team import TeamResponse
from app.services.email_service import EmailService


class TeamService:
    def __init__(self) -> None:
        self.email = EmailService()

    async def get_owned_team(self, db: AsyncIOMotorDatabase, owner_id: str) -> dict | None:
        return await db["teams"].find_one({"owner_id": owner_id})

    async def get_user_teams(self, db: AsyncIOMotorDatabase, user: dict) -> list[dict]:
        memberships = await db["team_memberships"].find(
            {"user_id": user["id"], "status": "active"}
        ).to_list(length=50)
        if not memberships:
            return []

        teams: list[dict] = []
        for membership in memberships:
            team = await db["teams"].find_one({"id": membership["team_id"]})
            if not team:
                continue
            members = await self._load_team_members(db=db, team_id=team["id"])
            pending_invites = await self._load_team_invites(db=db, team_id=team["id"])
            teams.append(
                {
                    "id": team["id"],
                    "name": team["name"],
                    "owner_id": team["owner_id"],
                    "is_owner": membership["role"] == "owner",
                    "members": members,
                    "pending_invites": pending_invites,
                    "created_at": team["created_at"],
                    "updated_at": team["updated_at"],
                }
            )
        return teams

    async def create_team(self, db: AsyncIOMotorDatabase, owner: dict, name: str) -> dict:
        now = datetime.now(timezone.utc)
        team = {
            "id": str(uuid.uuid4()),
            "name": name.strip(),
            "owner_id": owner["id"],
            "created_at": now,
            "updated_at": now,
        }
        membership = {
            "id": str(uuid.uuid4()),
            "team_id": team["id"],
            "user_id": owner["id"],
            "email": owner["email"],
            "role": "owner",
            "status": "active",
            "joined_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await db["teams"].insert_one(team)
        await db["team_memberships"].insert_one(membership)
        return await self._build_team_response(db=db, team=team, user_id=owner["id"])

    async def delete_team(self, db: AsyncIOMotorDatabase, owner: dict, team_id: str) -> None:
        membership = await db["team_memberships"].find_one(
            {"team_id": team_id, "user_id": owner["id"], "status": "active", "role": "owner"}
        )
        if not membership:
            raise ValueError("You do not have permission to delete this team")

        now = datetime.now(timezone.utc)
        await db["teams"].delete_one({"id": team_id})
        await db["team_memberships"].delete_many({"team_id": team_id})
        await db["team_invites"].delete_many({"team_id": team_id})
        await db["meeting_shares"].update_many(
            {"team_id": team_id, "visibility": "team"},
            {
                "$set": {
                    "visibility": "private",
                    "team_id": None,
                    "updated_at": now,
                }
            },
        )

    async def invite_member(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        team_id: str,
        email: str,
    ) -> dict:
        membership = await db["team_memberships"].find_one(
            {"team_id": team_id, "user_id": owner["id"], "status": "active", "role": "owner"}
        )
        if not membership:
            raise ValueError("You do not have permission to invite members to this team")

        normalized_email = email.strip().lower()
        existing_member = await db["team_memberships"].find_one(
            {"team_id": team_id, "email": normalized_email, "status": "active"}
        )
        if existing_member:
            raise ValueError("That person is already part of this team")

        team = await db["teams"].find_one({"id": team_id})
        if not team:
            raise ValueError("Team not found")

        invite = await db["team_invites"].find_one({"team_id": team_id, "email": normalized_email, "status": "pending"})
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=7)

        if invite:
            await db["team_invites"].update_one(
                {"id": invite["id"]},
                {
                    "$set": {
                        "token": invite["token"],
                        "inviter_user_id": owner["id"],
                        "updated_at": now,
                        "expires_at": expires_at,
                    }
                },
            )
            invite["updated_at"] = now
            invite["expires_at"] = expires_at
        else:
            invite = {
                "id": str(uuid.uuid4()),
                "team_id": team_id,
                "email": normalized_email,
                "token": self._generate_invite_token(),
                "status": "pending",
                "inviter_user_id": owner["id"],
                "created_at": now,
                "updated_at": now,
                "expires_at": expires_at,
            }
            await db["team_invites"].insert_one(invite)

        invite_url = f"{settings.frontend_url.rstrip('/')}/invite/{invite['token']}"
        owner_name = owner.get("full_name") or owner.get("email") or "A teammate"
        html = self._build_invite_email_html_v2(
            team_name=team["name"],
            inviter_name=owner_name,
            invite_url=invite_url,
        )
        text = (
            f"{owner_name} invited you to join {team['name']} on Notable.\n\n"
            f"Open this link to accept the invite:\n{invite_url}\n\n"
            "This invite expires in 7 days."
        )
        self.email.send_html_email(
            to_email=normalized_email,
            subject=f"Join {team['name']} on Notable",
            html=html,
            text=text,
        )
        return invite

    async def cancel_invite(
        self,
        db: AsyncIOMotorDatabase,
        owner: dict,
        team_id: str,
        invite_id: str,
    ) -> None:
        membership = await db["team_memberships"].find_one(
            {"team_id": team_id, "user_id": owner["id"], "status": "active", "role": "owner"}
        )
        if not membership:
            raise ValueError("You do not have permission to cancel invites for this team")

        invite = await db["team_invites"].find_one(
            {"id": invite_id, "team_id": team_id, "status": "pending"}
        )
        if not invite:
            raise ValueError("Invite not found")

        now = datetime.now(timezone.utc)
        await db["team_invites"].update_one(
            {"id": invite_id},
            {
                "$set": {
                    "status": "cancelled",
                    "updated_at": now,
                    "expires_at": now,
                }
            },
        )

    async def get_invite_access(self, db: AsyncIOMotorDatabase, invite_token: str, user: dict | None) -> dict:
        invite = await db["team_invites"].find_one({"token": invite_token})
        if not invite:
            return {"status": "not_found", "invite_token": invite_token}

        team = await db["teams"].find_one({"id": invite["team_id"]})
        inviter = await db["users"].find_one({"id": invite["inviter_user_id"]})
        if not team:
            return {"status": "not_found", "invite_token": invite_token}

        now = datetime.now(timezone.utc)
        expires_at = self._normalize_utc_datetime(invite.get("expires_at"))
        if invite["status"] != "pending" or (expires_at is not None and expires_at <= now):
            return {
                "status": "expired",
                "invite_token": invite_token,
                "team_name": team["name"],
                "invited_email": invite["email"],
                "inviter_name": inviter.get("full_name") if inviter else None,
            }

        if not user:
            return {
                "status": "sign_in_required",
                "invite_token": invite_token,
                "team_name": team["name"],
                "invited_email": invite["email"],
                "inviter_name": inviter.get("full_name") if inviter else None,
            }

        if user["email"].strip().lower() != invite["email"]:
            return {
                "status": "email_mismatch",
                "invite_token": invite_token,
                "team_name": team["name"],
                "invited_email": invite["email"],
                "inviter_name": inviter.get("full_name") if inviter else None,
            }

        existing_membership = await db["team_memberships"].find_one(
            {"team_id": invite["team_id"], "user_id": user["id"], "status": "active"}
        )
        if existing_membership:
            return {
                "status": "accepted",
                "invite_token": invite_token,
                "team_name": team["name"],
                "invited_email": invite["email"],
                "inviter_name": inviter.get("full_name") if inviter else None,
            }

        return {
            "status": "pending",
            "invite_token": invite_token,
            "team_name": team["name"],
            "invited_email": invite["email"],
            "inviter_name": inviter.get("full_name") if inviter else None,
        }

    async def accept_invite(self, db: AsyncIOMotorDatabase, invite_token: str, user: dict) -> dict:
        access = await self.get_invite_access(db=db, invite_token=invite_token, user=user)
        if access["status"] != "pending":
            raise ValueError("This invite cannot be accepted")

        invite = await db["team_invites"].find_one({"token": invite_token})
        now = datetime.now(timezone.utc)
        membership = {
            "id": str(uuid.uuid4()),
            "team_id": invite["team_id"],
            "user_id": user["id"],
            "email": user["email"].strip().lower(),
            "role": "member",
            "status": "active",
            "joined_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await db["team_memberships"].insert_one(membership)
        await db["team_invites"].update_one(
            {"id": invite["id"]},
            {"$set": {"status": "accepted", "accepted_by_user_id": user["id"], "updated_at": now}},
        )
        team = await db["teams"].find_one({"id": invite["team_id"]})
        return await self._build_team_response(db=db, team=team, user_id=user["id"])

    async def list_shared_meetings(self, db: AsyncIOMotorDatabase, user: dict) -> list[dict]:
        memberships = await db["team_memberships"].find(
            {"user_id": user["id"], "status": "active"}
        ).to_list(length=50)
        if not memberships:
            return []

        team_ids = [membership["team_id"] for membership in memberships]
        shares = await db["meeting_shares"].find(
            {"visibility": "team", "team_id": {"$in": team_ids}}
        ).sort("updated_at", -1).to_list(length=200)

        items: list[dict] = []
        for share in shares:
            meeting = await db["meetings"].find_one({"id": share["meeting_id"]})
            owner = await db["users"].find_one({"id": share["owner_id"]})
            team = await db["teams"].find_one({"id": share.get("team_id")}) if share.get("team_id") else None
            if not meeting or not owner:
                continue
            if owner["id"] == user["id"]:
                continue
            items.append(
                {
                    "meeting_id": meeting["id"],
                    "title": meeting["title"],
                    "summary": meeting.get("summary"),
                    "notes_markdown": meeting.get("notes_markdown"),
                    "provider": meeting.get("provider"),
                    "created_at": meeting.get("created_at"),
                    "updated_at": meeting.get("updated_at"),
                    "owner_name": owner.get("full_name") or owner.get("email"),
                    "team_name": team.get("name") if team else None,
                    "share_token": share["token"],
                    "share_url": f"{settings.frontend_url.rstrip('/')}/share/{share['token']}",
                }
            )
        return items

    async def _build_team_response(self, db: AsyncIOMotorDatabase, team: dict, user_id: str) -> dict:
        members = await self._load_team_members(db=db, team_id=team["id"])
        pending_invites = await self._load_team_invites(db=db, team_id=team["id"])
        return {
            "id": team["id"],
            "name": team["name"],
            "owner_id": team["owner_id"],
            "is_owner": team["owner_id"] == user_id,
            "members": members,
            "pending_invites": pending_invites,
            "created_at": team["created_at"],
            "updated_at": team["updated_at"],
        }

    async def _load_team_members(self, db: AsyncIOMotorDatabase, team_id: str) -> list[dict]:
        memberships = await db["team_memberships"].find(
            {"team_id": team_id, "status": "active"}
        ).sort("joined_at", 1).to_list(length=100)
        members: list[dict] = []
        for membership in memberships:
            user = await db["users"].find_one({"id": membership["user_id"]})
            members.append(
                {
                    "id": membership["user_id"],
                    "email": membership["email"],
                    "full_name": user.get("full_name") if user else None,
                    "avatar_url": user.get("avatar_url") if user else None,
                    "role": membership["role"],
                    "joined_at": membership["joined_at"],
                }
            )
        return members

    async def _load_team_invites(self, db: AsyncIOMotorDatabase, team_id: str) -> list[dict]:
        now = datetime.now(timezone.utc)
        invites = await db["team_invites"].find(
            {"team_id": team_id, "status": "pending"}
        ).sort("created_at", -1).to_list(length=100)
        valid_invites: list[dict] = []
        for invite in invites:
            expires_at = self._normalize_utc_datetime(invite.get("expires_at"))
            if expires_at is None or expires_at <= now:
                continue
            invite["expires_at"] = expires_at
            valid_invites.append(invite)
        return valid_invites

    def _generate_invite_token(self) -> str:
        return secrets.token_urlsafe(24)

    def _build_invite_email_html_v2(self, *, team_name: str, inviter_name: str, invite_url: str) -> str:
        return f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#f4f4f5;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:40px 20px;">
      <div style="border:1px solid #262626;border-radius:28px;background:#111111;padding:36px;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="height:40px;width:40px;border-radius:12px;background:#f4f4f5;color:#0a0a0a;font-weight:700;font-size:14px;line-height:40px;text-align:center;">N</div>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <div style="font-family:Georgia,serif;font-size:34px;line-height:1;color:#f4f4f5;">Notable</div>
            </td>
          </tr>
        </table>
        <div style="margin-top:28px;color:#a1a1aa;font-size:12px;letter-spacing:.22em;text-transform:uppercase;">Team invitation</div>
        <h1 style="margin:14px 0 0;font-family:'Instrument Serif',Georgia,serif;font-size:54px;line-height:1.02;font-weight:400;">
          Join {team_name}
        </h1>
        <p style="margin:22px 0 0;color:#d4d4d8;font-size:16px;line-height:1.8;">
          {inviter_name} invited you to join their Notable workspace. Once you accept, you'll be able to open meetings shared with the team and collaborate in the same organization space.
        </p>
        <div style="margin-top:28px;">
          <a href="{invite_url}" style="display:inline-flex;align-items:center;justify-content:center;padding:14px 22px;border-radius:999px;background:#f4f4f5;color:#0a0a0a;text-decoration:none;font-weight:600;">
            Accept team invite
          </a>
        </div>
        <p style="margin:28px 0 0;color:#71717a;font-size:13px;line-height:1.8;">
          This invitation expires in 7 days. If the button doesn't work, copy and open this link:
          <br />
          <a href="{invite_url}" style="color:#fafafa;text-decoration:none;word-break:break-all;">{invite_url}</a>
        </p>
      </div>
    </div>
  </body>
</html>
""".strip()

    def _normalize_utc_datetime(self, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _build_invite_email_html(self, *, team_name: str, inviter_name: str, invite_url: str) -> str:
        return f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;color:#f4f4f5;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:40px 20px;">
      <div style="border:1px solid #262626;border-radius:28px;background:#111111;padding:36px;box-shadow:0 20px 60px rgba(0,0,0,.35);">
        <div style="display:inline-flex;align-items:center;gap:12px;">
          <div style="height:40px;width:40px;border-radius:12px;background:#f4f4f5;color:#0a0a0a;font-weight:700;display:flex;align-items:center;justify-content:center;">N</div>
          <div style="font-family:'Instrument Serif',Georgia,serif;font-size:34px;line-height:1;">Notable</div>
        </div>
        <div style="margin-top:28px;color:#a1a1aa;font-size:12px;letter-spacing:.22em;text-transform:uppercase;">Team invitation</div>
        <h1 style="margin:14px 0 0;font-family:'Instrument Serif',Georgia,serif;font-size:54px;line-height:1.02;font-weight:400;">
          Join {team_name}
        </h1>
        <p style="margin:22px 0 0;color:#d4d4d8;font-size:16px;line-height:1.8;">
          {inviter_name} invited you to join their Notable workspace. Once you accept, you’ll be able to open meetings shared with the team and collaborate in the same organization space.
        </p>
        <div style="margin-top:28px;">
          <a href="{invite_url}" style="display:inline-flex;align-items:center;justify-content:center;padding:14px 22px;border-radius:999px;background:#f4f4f5;color:#0a0a0a;text-decoration:none;font-weight:600;">
            Accept team invite
          </a>
        </div>
        <p style="margin:28px 0 0;color:#71717a;font-size:13px;line-height:1.8;">
          This invitation expires in 7 days. If the button doesn’t work, copy and open this link:
          <br />
          <a href="{invite_url}" style="color:#fafafa;text-decoration:none;word-break:break-all;">{invite_url}</a>
        </p>
      </div>
    </div>
  </body>
</html>
""".strip()
