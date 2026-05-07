import base64
from datetime import datetime, timezone

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase


class TaskSyncService:
    async def get_connection_status(self, *, owner: dict) -> dict:
        notes: list[str] = []
        if owner.get("jira_site_url") and owner.get("jira_project_key"):
            notes.append(f'Jira sync targets project {owner["jira_project_key"]}.')
        if owner.get("asana_project_gid"):
            notes.append(f'Asana sync targets project {owner["asana_project_gid"]}.')
        if owner.get("linear_team_id"):
            notes.append(f'Linear sync targets team {owner["linear_team_id"]}.')
        if not notes:
            notes.append("Connect Jira, Asana, or Linear to push action items out of Notable.")

        return {
            "jira_connected": bool(owner.get("jira_site_url") and owner.get("jira_email") and owner.get("jira_api_token") and owner.get("jira_project_key")),
            "asana_connected": bool(owner.get("asana_personal_access_token") and owner.get("asana_project_gid")),
            "linear_connected": bool(owner.get("linear_api_key") and owner.get("linear_team_id")),
            "jira_project_key": owner.get("jira_project_key"),
            "asana_project_gid": owner.get("asana_project_gid"),
            "linear_team_id": owner.get("linear_team_id"),
            "notes": notes,
        }

    async def connect_jira(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        site_url: str,
        email: str,
        api_token: str,
        project_key: str,
        issue_type_name: str,
    ) -> dict:
        normalized_site = site_url.rstrip("/")
        headers = self._jira_headers(email=email, api_token=api_token)
        async with httpx.AsyncClient(timeout=30) as client:
            myself = await client.get(f"{normalized_site}/rest/api/3/myself", headers=headers)
            myself.raise_for_status()
            project = await client.get(f"{normalized_site}/rest/api/3/project/{project_key}", headers=headers)
            project.raise_for_status()

        now = datetime.now(timezone.utc)
        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$set": {
                    "jira_site_url": normalized_site,
                    "jira_email": email.strip(),
                    "jira_api_token": api_token.strip(),
                    "jira_project_key": project_key.strip().upper(),
                    "jira_issue_type_name": issue_type_name.strip() or "Task",
                    "updated_at": now,
                }
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def disconnect_jira(self, *, db: AsyncIOMotorDatabase, owner: dict) -> dict:
        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$unset": {
                    "jira_site_url": "",
                    "jira_email": "",
                    "jira_api_token": "",
                    "jira_project_key": "",
                    "jira_issue_type_name": "",
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def connect_asana(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        personal_access_token: str,
        project_gid: str,
        workspace_gid: str | None,
    ) -> dict:
        headers = {"Authorization": f"Bearer {personal_access_token.strip()}"}
        async with httpx.AsyncClient(timeout=30) as client:
            project = await client.get(
                f"https://app.asana.com/api/1.0/projects/{project_gid.strip()}",
                headers=headers,
            )
            project.raise_for_status()

        now = datetime.now(timezone.utc)
        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$set": {
                    "asana_personal_access_token": personal_access_token.strip(),
                    "asana_project_gid": project_gid.strip(),
                    "asana_workspace_gid": workspace_gid.strip() if workspace_gid else None,
                    "updated_at": now,
                }
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def disconnect_asana(self, *, db: AsyncIOMotorDatabase, owner: dict) -> dict:
        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$unset": {
                    "asana_personal_access_token": "",
                    "asana_project_gid": "",
                    "asana_workspace_gid": "",
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def connect_linear(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        api_key: str,
        team_id: str,
    ) -> dict:
        headers = {"Authorization": api_key.strip()}
        query = {
            "query": "query Team($id: String!) { team(id: $id) { id key name } viewer { id name } }",
            "variables": {"id": team_id.strip()},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post("https://api.linear.app/graphql", headers=headers, json=query)
            response.raise_for_status()
            payload = response.json()
        if payload.get("errors") or not payload.get("data", {}).get("team"):
            raise ValueError("Linear rejected that API key or team id.")

        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$set": {
                    "linear_api_key": api_key.strip(),
                    "linear_team_id": team_id.strip(),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def disconnect_linear(self, *, db: AsyncIOMotorDatabase, owner: dict) -> dict:
        await db["users"].update_one(
            {"id": owner["id"]},
            {
                "$unset": {
                    "linear_api_key": "",
                    "linear_team_id": "",
                },
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
        updated_user = await db["users"].find_one({"id": owner["id"]})
        return await self.get_connection_status(owner=updated_user or owner)

    async def sync_meeting_action_items(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        meeting: dict,
        provider: str,
    ) -> dict:
        action_items = [item.strip() for item in (meeting.get("action_items") or []) if str(item).strip()]
        if not action_items:
            raise ValueError("This meeting does not have any action items to sync yet.")

        if provider == "jira":
            items = await self._sync_to_jira(owner=owner, meeting=meeting, action_items=action_items)
        elif provider == "asana":
            items = await self._sync_to_asana(owner=owner, meeting=meeting, action_items=action_items)
        elif provider == "linear":
            items = await self._sync_to_linear(owner=owner, meeting=meeting, action_items=action_items)
        else:
            raise ValueError("Unsupported sync provider.")

        now = datetime.now(timezone.utc)
        await db["meeting_action_item_syncs"].insert_one(
            {
                "id": f"{meeting['id']}:{provider}:{int(now.timestamp())}",
                "meeting_id": meeting["id"],
                "owner_id": owner["id"],
                "provider": provider,
                "items": items,
                "created_at": now,
                "updated_at": now,
            }
        )

        return {
            "provider": provider,
            "synced_count": len(items),
            "items": items,
            "message": f"Synced {len(items)} action item{'s' if len(items) != 1 else ''} to {provider.title()}.",
        }

    async def _sync_to_jira(self, *, owner: dict, meeting: dict, action_items: list[str]) -> list[dict]:
        required = ["jira_site_url", "jira_email", "jira_api_token", "jira_project_key"]
        if any(not owner.get(field) for field in required):
            raise ValueError("Connect Jira in Settings before syncing action items there.")

        headers = self._jira_headers(email=owner["jira_email"], api_token=owner["jira_api_token"])
        issue_type_name = owner.get("jira_issue_type_name") or "Task"
        created: list[dict] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for item in action_items:
                payload = {
                    "fields": {
                        "project": {"key": owner["jira_project_key"]},
                        "issuetype": {"name": issue_type_name},
                        "summary": item[:255],
                        "description": self._jira_adf_description(meeting=meeting, action_item=item),
                    }
                }
                response = await client.post(
                    f"{owner['jira_site_url'].rstrip('/')}/rest/api/3/issue",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                issue_key = data.get("key") or data.get("id")
                created.append(
                    {
                        "provider": "jira",
                        "external_id": issue_key,
                        "title": item,
                        "url": f"{owner['jira_site_url'].rstrip('/')}/browse/{issue_key}" if issue_key else None,
                    }
                )
        return created

    async def _sync_to_asana(self, *, owner: dict, meeting: dict, action_items: list[str]) -> list[dict]:
        token = owner.get("asana_personal_access_token")
        project_gid = owner.get("asana_project_gid")
        if not token or not project_gid:
            raise ValueError("Connect Asana in Settings before syncing action items there.")

        headers = {"Authorization": f"Bearer {token}"}
        created: list[dict] = []
        async with httpx.AsyncClient(timeout=30) as client:
            for item in action_items:
                payload = {
                    "data": {
                        "name": item,
                        "notes": self._plain_description(meeting=meeting, action_item=item),
                        "projects": [project_gid],
                    }
                }
                if owner.get("asana_workspace_gid"):
                    payload["data"]["workspace"] = owner["asana_workspace_gid"]
                response = await client.post(
                    "https://app.asana.com/api/1.0/tasks",
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json().get("data", {})
                created.append(
                    {
                        "provider": "asana",
                        "external_id": data.get("gid"),
                        "title": item,
                        "url": data.get("permalink_url"),
                    }
                )
        return created

    async def _sync_to_linear(self, *, owner: dict, meeting: dict, action_items: list[str]) -> list[dict]:
        api_key = owner.get("linear_api_key")
        team_id = owner.get("linear_team_id")
        if not api_key or not team_id:
            raise ValueError("Connect Linear in Settings before syncing action items there.")

        headers = {"Authorization": api_key}
        created: list[dict] = []
        mutation = """
        mutation IssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
            }
          }
        }
        """
        async with httpx.AsyncClient(timeout=30) as client:
            for item in action_items:
                response = await client.post(
                    "https://api.linear.app/graphql",
                    headers=headers,
                    json={
                        "query": mutation,
                        "variables": {
                            "input": {
                                "teamId": team_id,
                                "title": item,
                                "description": self._plain_description(meeting=meeting, action_item=item),
                            }
                        },
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if payload.get("errors"):
                    raise ValueError(payload["errors"][0].get("message") or "Linear issue creation failed.")
                issue = payload.get("data", {}).get("issueCreate", {}).get("issue")
                if not issue:
                    raise ValueError("Linear issue creation did not return an issue.")
                created.append(
                    {
                        "provider": "linear",
                        "external_id": issue.get("identifier") or issue.get("id"),
                        "title": item,
                        "url": issue.get("url"),
                    }
                )
        return created

    def _jira_headers(self, *, email: str, api_token: str) -> dict[str, str]:
        encoded = base64.b64encode(f"{email.strip()}:{api_token.strip()}".encode("utf-8")).decode("utf-8")
        return {
            "Authorization": f"Basic {encoded}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _jira_adf_description(self, *, meeting: dict, action_item: str) -> dict:
        return {
            "type": "doc",
            "version": 1,
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": f"Meeting: {meeting.get('title') or 'Untitled meeting'}"}],
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": f"Action item: {action_item}"}],
                },
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": (meeting.get("summary") or "")[:1200] or "Synced from Notable"}],
                },
            ],
        }

    def _plain_description(self, *, meeting: dict, action_item: str) -> str:
        summary = (meeting.get("summary") or "").strip()
        lines = [
            f"Meeting: {meeting.get('title') or 'Untitled meeting'}",
            f"Action item: {action_item}",
        ]
        if summary:
            lines.append("")
            lines.append("Summary excerpt:")
            lines.append(summary[:1500])
        lines.append("")
        lines.append("Synced from Notable.")
        return "\n".join(lines)
