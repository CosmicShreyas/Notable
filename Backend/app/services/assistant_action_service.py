import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.schemas.readout import ReadoutGenerateRequest
from app.services.google_service import GoogleCalendarService
from app.services.ollama_service import OllamaService
from app.services.readout_service import ReadoutService
from app.services.task_board_service import TaskBoardService
from app.services.team_service import TeamService
from app.services.vocabulary_service import VocabularyService


class AssistantActionService:
    def __init__(self) -> None:
        self.ollama = OllamaService()
        self.teams = TeamService()
        self.calendar = GoogleCalendarService()
        self.readouts = ReadoutService()
        self.vocabulary = VocabularyService()
        self.tasks = TaskBoardService()

    async def maybe_handle_action(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        message: str,
        current_meeting: dict | None = None,
        current_context: dict[str, Any] | None = None,
    ) -> tuple[str, list[str], list[dict[str, Any]]] | None:
        tool_result = await self._try_tool_call_action(
            db=db,
            owner=owner,
            message=message,
            current_meeting=current_meeting,
            current_context=current_context,
        )
        if tool_result is not None:
            return tool_result

        return await self._try_structured_action(
            db=db,
            owner=owner,
            message=message,
            current_meeting=current_meeting,
            current_context=current_context,
        )

    async def _try_tool_call_action(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        message: str,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
    ) -> tuple[str, list[str], list[dict[str, Any]]] | None:
        messages = [
            {
                "role": "system",
                "content": self._build_action_system_prompt(current_meeting=current_meeting, current_context=current_context),
            },
            {
                "role": "user",
                "content": self._build_action_user_prompt(
                    owner=owner,
                    message=message,
                    current_meeting=current_meeting,
                    current_context=current_context,
                ),
            },
        ]

        try:
            response = await self.ollama.chat_response(
                messages=messages,
                tools=self._tool_schemas(),
                think=False,
            )
        except Exception:
            return None

        assistant_message = self._response_message_to_dict(response)
        tool_calls = assistant_message.get("tool_calls") or []
        if not tool_calls:
            return None

        messages.append(assistant_message)
        action_contexts: list[str] = []
        executed_actions: list[dict[str, Any]] = []

        for tool_call in tool_calls:
            function_call = tool_call.get("function") or {}
            tool_name = function_call.get("name")
            arguments = function_call.get("arguments") or {}
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    arguments = {}

            if not tool_name or not isinstance(arguments, dict):
                continue

            result = await self._execute_action(
                db=db,
                owner=owner,
                tool_name=tool_name,
                arguments=arguments,
                current_meeting=current_meeting,
                current_context=current_context,
            )
            action_contexts.append(result["context"])
            executed_actions.append(self._public_action_result(result))
            messages.append(
                {
                    "role": "tool",
                    "tool_name": tool_name,
                    "content": json.dumps(result),
                }
            )

        if not action_contexts:
            return None

        final_response = await self.ollama.chat_response(
            messages=messages,
            tools=self._tool_schemas(),
            think=False,
        )
        final_text = self._extract_content(final_response).strip()
        if not final_text:
            result_messages = []
            for message_item in messages:
                if message_item.get("role") != "tool":
                    continue
                try:
                    parsed = json.loads(message_item["content"])
                except (KeyError, TypeError, json.JSONDecodeError):
                    continue
                if isinstance(parsed, dict) and parsed.get("message"):
                    result_messages.append(parsed["message"])
            final_text = result_messages[-1] if result_messages else "Done."
        return final_text, action_contexts, executed_actions

    async def _try_structured_action(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        message: str,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
    ) -> tuple[str, list[str], list[dict[str, Any]]] | None:
        prompt = (
            f"{self._build_action_system_prompt(current_meeting=current_meeting, current_context=current_context)}\n\n"
            "Return JSON only with this shape:\n"
            "{"
            '"action":"none|create_team|delete_team|invite_team_member|cancel_pending_invite|create_note|rename_current_note|delete_current_note|share_current_note|create_vocabulary_term|update_vocabulary_term|delete_vocabulary_term|create_calendar_event|delete_calendar_event|generate_readout|create_folder|delete_folder|delete_current_folder|add_current_note_to_folder|remove_current_note_from_folder|create_task|update_task_status|delete_task",'
            '"args":{}'
            "}\n\n"
            "Only choose an action when the user is clearly asking the app to do something.\n\n"
            f"{self._build_action_user_prompt(owner=owner, message=message, current_meeting=current_meeting, current_context=current_context)}"
        )
        try:
            response_text = await self.ollama.chat(
                system_prompt="You convert user instructions into a single app action in strict JSON.",
                user_prompt=prompt,
            )
        except Exception:
            return None

        payload = self._parse_json_object(response_text)
        if not payload:
            return None

        action = payload.get("action")
        arguments = payload.get("args") or {}
        if action in (None, "", "none") or not isinstance(arguments, dict):
            return None

        result = await self._execute_action(
            db=db,
            owner=owner,
            tool_name=str(action),
            arguments=arguments,
            current_meeting=current_meeting,
            current_context=current_context,
        )
        return result["message"], [result["context"]], [self._public_action_result(result)]

    def _build_action_system_prompt(self, current_meeting: dict | None, current_context: dict[str, Any] | None) -> str:
        if current_meeting:
            scope_hint = "A current meeting is open, so references like 'this note', 'this meeting', or 'share this' refer to that meeting."
        elif current_context and current_context.get("page_type") == "folder":
            scope_hint = "A current folder page is open, so references like 'this folder' refer to that folder."
        elif current_context and current_context.get("page_type") == "calendar":
            scope_hint = "The calendar page is open, so the user may be asking to create or delete calendar events."
        elif current_context and current_context.get("page_type") == "vocabulary":
            scope_hint = "The vocabulary page is open, so the user may be asking to add, edit, or delete vocabulary terms."
        elif current_context and current_context.get("page_type") == "readouts":
            scope_hint = "The readouts page is open, so the user may be asking to generate a new readout or summarize communication activity."
        elif current_context and current_context.get("page_type") == "google_meet":
            scope_hint = "The Google Meet page is open, so references to this page refer to the Meet integration surface and meeting context shown there."
        elif current_context and current_context.get("page_type") == "analytics":
            scope_hint = "The analytics page is open, so references to this page refer to meeting analytics context."
        elif current_context and current_context.get("page_type") == "tasks":
            scope_hint = "The tasks page is open, so the user may be asking to create, move, complete, block, reopen, or delete internal tasks."
        else:
            scope_hint = "No current meeting is open, so only use page-specific actions when the page context clearly identifies the current item."
        return (
            "You are Notable AI acting as a workspace assistant. "
            "Use tools only when the user clearly wants the app to take an action, not just answer a question. "
            "Never invent tool arguments. If required data is missing, do not call a tool. "
            "Only use the provided tools. Prefer one precise tool call over vague responses. "
            "When creating calendar events, provide ISO 8601 datetimes. "
            f"{scope_hint}"
        )

    def _build_action_user_prompt(
        self,
        *,
        owner: dict,
        message: str,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
    ) -> str:
        lines = [
            f"User email: {owner.get('email')}",
            f"Current meeting title: {(current_meeting.get('title') or 'Untitled meeting') if current_meeting else 'none'}",
        ]
        if current_context:
            lines.append(f"Current page type: {current_context.get('page_type') or 'unknown'}")
            if current_context.get("meeting_id"):
                lines.append(f"Current meeting id: {current_context['meeting_id']}")
            if current_context.get("meeting_title"):
                lines.append(f"Current meeting title from page: {current_context['meeting_title']}")
            if current_context.get("folder_id"):
                lines.append(f"Current folder id: {current_context['folder_id']}")
            if current_context.get("folder_name"):
                lines.append(f"Current folder name: {current_context['folder_name']}")
            if current_context.get("meeting_code"):
                lines.append(f"Current Google Meet code: {current_context['meeting_code']}")
            if current_context.get("visible_month"):
                lines.append(f"Visible calendar month: {current_context['visible_month']}")
            if current_context.get("task_title"):
                lines.append(f"Current task title: {current_context['task_title']}")
        lines.append(f"Current UTC datetime: {datetime.now(timezone.utc).isoformat()}")
        lines.append(f"User request: {message}")
        return "\n".join(lines)

    def _tool_schemas(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "create_team",
                    "description": "Create a new team workspace.",
                    "parameters": {
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                            "name": {"type": "string", "description": "The team name to create."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_team",
                    "description": "Delete one of the user's owned teams.",
                    "parameters": {
                        "type": "object",
                        "required": ["team_name"],
                        "properties": {
                            "team_name": {"type": "string", "description": "The team name to delete."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "invite_team_member",
                    "description": "Invite a member to one of the user's owned teams.",
                    "parameters": {
                        "type": "object",
                        "required": ["email"],
                        "properties": {
                            "email": {"type": "string", "description": "The teammate email address."},
                            "team_name": {"type": "string", "description": "Optional team name when the user has multiple teams."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "cancel_pending_invite",
                    "description": "Cancel a pending invite for one of the user's owned teams.",
                    "parameters": {
                        "type": "object",
                        "required": ["email"],
                        "properties": {
                            "email": {"type": "string", "description": "The pending invite email address."},
                            "team_name": {"type": "string", "description": "Optional team name when needed to disambiguate the invite."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_note",
                    "description": "Create a new meeting note.",
                    "parameters": {
                        "type": "object",
                        "required": ["title"],
                        "properties": {
                            "title": {"type": "string", "description": "The new note title."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "rename_current_note",
                    "description": "Rename the currently open meeting note.",
                    "parameters": {
                        "type": "object",
                        "required": ["title"],
                        "properties": {
                            "title": {"type": "string", "description": "The new title for the current note."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_current_note",
                    "description": "Delete the currently open meeting note.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "share_current_note",
                    "description": "Change the sharing visibility of the currently open meeting note.",
                    "parameters": {
                        "type": "object",
                        "required": ["visibility"],
                        "properties": {
                            "visibility": {
                                "type": "string",
                                "enum": ["private", "link", "team"],
                                "description": "Whether the current note should be private, anyone with the link, or team-only.",
                            },
                            "team_name": {
                                "type": "string",
                                "description": "Optional team name when team sharing needs a specific owned team.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_vocabulary_term",
                    "description": "Create a new vocabulary term for transcript correction.",
                    "parameters": {
                        "type": "object",
                        "required": ["canonical"],
                        "properties": {
                            "canonical": {"type": "string", "description": "The preferred canonical term."},
                            "aliases": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional aliases or transcript mistakes for the canonical term.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "update_vocabulary_term",
                    "description": "Update an existing vocabulary term.",
                    "parameters": {
                        "type": "object",
                        "required": ["canonical"],
                        "properties": {
                            "canonical": {"type": "string", "description": "The existing vocabulary term to update."},
                            "new_canonical": {"type": "string", "description": "Optional replacement canonical term."},
                            "aliases": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional replacement aliases list.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_vocabulary_term",
                    "description": "Delete a vocabulary term.",
                    "parameters": {
                        "type": "object",
                        "required": ["canonical"],
                        "properties": {
                            "canonical": {"type": "string", "description": "The vocabulary term to delete."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_calendar_event",
                    "description": "Create a Google Calendar event with an optional Google Meet link.",
                    "parameters": {
                        "type": "object",
                        "required": ["title", "start", "end"],
                        "properties": {
                            "title": {"type": "string", "description": "The calendar event title."},
                            "description": {"type": "string", "description": "Optional meeting description."},
                            "start": {"type": "string", "description": "Start datetime in ISO 8601 format."},
                            "end": {"type": "string", "description": "End datetime in ISO 8601 format."},
                            "attendees": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional attendee email addresses.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_calendar_event",
                    "description": "Delete a Google Calendar event by title.",
                    "parameters": {
                        "type": "object",
                        "required": ["event_title"],
                        "properties": {
                            "event_title": {"type": "string", "description": "The title of the calendar event to delete."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "generate_readout",
                    "description": "Generate a Gmail and Slack readout.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "timeframe": {
                                "type": "string",
                                "enum": ["24h", "3d", "7d"],
                                "description": "How far back the readout should look.",
                            },
                            "sources": {
                                "type": "array",
                                "items": {"type": "string", "enum": ["gmail", "slack"]},
                                "description": "Which connected sources to include.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_task",
                    "description": "Create a new internal task on the Notable task board.",
                    "parameters": {
                        "type": "object",
                        "required": ["title"],
                        "properties": {
                            "title": {"type": "string", "description": "The task title to create."},
                            "status": {
                                "type": "string",
                                "enum": ["open", "blocked", "done"],
                                "description": "Optional initial task status.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "update_task_status",
                    "description": "Move an internal task to open, blocked, or done.",
                    "parameters": {
                        "type": "object",
                        "required": ["task_title", "status"],
                        "properties": {
                            "task_title": {"type": "string", "description": "The task title to update."},
                            "status": {
                                "type": "string",
                                "enum": ["open", "blocked", "done"],
                                "description": "The new task status.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_task",
                    "description": "Delete an internal task from the Notable task board.",
                    "parameters": {
                        "type": "object",
                        "required": ["task_title"],
                        "properties": {
                            "task_title": {"type": "string", "description": "The task title to delete."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_folder",
                    "description": "Create a local folder in the user's workspace.",
                    "parameters": {
                        "type": "object",
                        "required": ["folder_name"],
                        "properties": {
                            "folder_name": {"type": "string", "description": "The folder name to create."},
                            "folder_color": {
                                "type": "string",
                                "description": "Optional desired color like red, orange, yellow, green, cyan, blue, violet, pink, or a hex code.",
                            },
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_folder",
                    "description": "Delete a local folder in the user's workspace.",
                    "parameters": {
                        "type": "object",
                        "required": ["folder_name"],
                        "properties": {
                            "folder_name": {"type": "string", "description": "The folder name to delete."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_current_folder",
                    "description": "Delete the currently open folder.",
                    "parameters": {"type": "object", "properties": {}},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "add_current_note_to_folder",
                    "description": "Add the current note to a local folder.",
                    "parameters": {
                        "type": "object",
                        "required": ["folder_name"],
                        "properties": {
                            "folder_name": {"type": "string", "description": "The folder name to add the current note to."},
                        },
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "remove_current_note_from_folder",
                    "description": "Remove the current note from a local folder.",
                    "parameters": {
                        "type": "object",
                        "required": ["folder_name"],
                        "properties": {
                            "folder_name": {"type": "string", "description": "The folder name to remove the current note from."},
                        },
                    },
                },
            },
        ]

    async def _execute_action(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        tool_name: str,
        arguments: dict[str, Any],
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        try:
            if tool_name == "create_team":
                return await self._create_team(db=db, owner=owner, name=str(arguments.get("name") or ""))
            if tool_name == "delete_team":
                return await self._delete_team(db=db, owner=owner, team_name=str(arguments.get("team_name") or ""))
            if tool_name == "invite_team_member":
                return await self._invite_team_member(
                    db=db,
                    owner=owner,
                    email=str(arguments.get("email") or ""),
                    team_name=self._optional_string(arguments.get("team_name")),
                )
            if tool_name == "cancel_pending_invite":
                return await self._cancel_pending_invite(
                    db=db,
                    owner=owner,
                    email=str(arguments.get("email") or ""),
                    team_name=self._optional_string(arguments.get("team_name")),
                )
            if tool_name == "create_note":
                return await self._create_note(db=db, owner=owner, title=str(arguments.get("title") or ""))
            if tool_name == "rename_current_note":
                return await self._rename_current_note(
                    db=db,
                    owner=owner,
                    current_meeting=current_meeting,
                    current_context=current_context,
                    title=str(arguments.get("title") or ""),
                )
            if tool_name == "delete_current_note":
                return await self._delete_current_note(
                    db=db,
                    owner=owner,
                    current_meeting=current_meeting,
                    current_context=current_context,
                )
            if tool_name == "share_current_note":
                return await self._share_current_note(
                    db=db,
                    owner=owner,
                    current_meeting=current_meeting,
                    current_context=current_context,
                    visibility=str(arguments.get("visibility") or ""),
                    team_name=self._optional_string(arguments.get("team_name")),
                )
            if tool_name == "create_vocabulary_term":
                return await self._create_vocabulary_term(
                    db=db,
                    owner=owner,
                    canonical=str(arguments.get("canonical") or ""),
                    aliases=arguments.get("aliases"),
                )
            if tool_name == "update_vocabulary_term":
                return await self._update_vocabulary_term(
                    db=db,
                    owner=owner,
                    canonical=str(arguments.get("canonical") or ""),
                    new_canonical=self._optional_string(arguments.get("new_canonical")),
                    aliases=arguments.get("aliases"),
                )
            if tool_name == "delete_vocabulary_term":
                return await self._delete_vocabulary_term(
                    db=db,
                    owner=owner,
                    canonical=str(arguments.get("canonical") or ""),
                )
            if tool_name == "create_calendar_event":
                return await self._create_calendar_event(
                    db=db,
                    owner=owner,
                    title=str(arguments.get("title") or ""),
                    description=self._optional_string(arguments.get("description")),
                    start_value=arguments.get("start"),
                    end_value=arguments.get("end"),
                    attendees=arguments.get("attendees"),
                )
            if tool_name == "delete_calendar_event":
                return await self._delete_calendar_event(
                    db=db,
                    owner=owner,
                    event_title=str(arguments.get("event_title") or ""),
                    current_context=current_context,
                )
            if tool_name == "generate_readout":
                return await self._generate_readout(
                    db=db,
                    owner=owner,
                    timeframe=self._optional_string(arguments.get("timeframe")),
                    sources=arguments.get("sources"),
                )
            if tool_name == "create_task":
                return await self._create_task(
                    db=db,
                    owner=owner,
                    title=str(arguments.get("title") or ""),
                    status=self._optional_string(arguments.get("status")),
                )
            if tool_name == "update_task_status":
                return await self._update_task_status(
                    db=db,
                    owner=owner,
                    task_title=str(arguments.get("task_title") or ""),
                    status=str(arguments.get("status") or ""),
                )
            if tool_name == "delete_task":
                return await self._delete_task(
                    db=db,
                    owner=owner,
                    task_title=str(arguments.get("task_title") or ""),
                )
            if tool_name == "create_folder":
                return self._create_folder(
                    folder_name=str(arguments.get("folder_name") or ""),
                    folder_color=self._optional_string(arguments.get("folder_color")),
                )
            if tool_name == "delete_folder":
                return self._delete_folder(folder_name=str(arguments.get("folder_name") or ""))
            if tool_name == "delete_current_folder":
                return self._delete_current_folder(current_context=current_context)
            if tool_name == "add_current_note_to_folder":
                return self._add_current_note_to_folder(
                    current_meeting=current_meeting,
                    current_context=current_context,
                    folder_name=str(arguments.get("folder_name") or ""),
                )
            if tool_name == "remove_current_note_from_folder":
                return self._remove_current_note_from_folder(
                    current_meeting=current_meeting,
                    current_context=current_context,
                    folder_name=str(arguments.get("folder_name") or ""),
                )
        except ValueError as exc:
            return {
                "status": "error",
                "context": f"{tool_name} failed",
                "message": str(exc),
                "action_type": tool_name,
                "payload": {},
            }
        except Exception:
            return {
                "status": "error",
                "context": f"{tool_name} failed",
                "message": "I ran into a problem while trying to complete that action.",
                "action_type": tool_name,
                "payload": {},
            }

        return {
            "status": "error",
            "context": "Unknown action",
            "message": "I couldn't run that action.",
            "action_type": tool_name,
            "payload": {},
        }

    async def _create_team(self, *, db: AsyncIOMotorDatabase, owner: dict, name: str) -> dict[str, Any]:
        clean_name = self._clean_name(name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Create team failed",
                "message": "I need a valid team name before I can create it.",
                "action_type": "create_team",
                "payload": {},
            }
        team = await self.teams.create_team(db=db, owner=owner, name=clean_name)
        return {
            "status": "success",
            "context": f'Created team "{team["name"]}"',
            "message": f'Created team "{team["name"]}".',
            "action_type": "create_team",
            "payload": {"team_name": team["name"], "team_id": team["id"]},
        }

    async def _delete_team(self, *, db: AsyncIOMotorDatabase, owner: dict, team_name: str) -> dict[str, Any]:
        clean_name = self._clean_name(team_name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Delete team failed",
                "message": "I need the team name before I can delete it.",
                "action_type": "delete_team",
                "payload": {},
            }

        owned_teams = await self._get_owned_teams(db=db, owner=owner)
        if not owned_teams:
            return {
                "status": "error",
                "context": "Delete team failed",
                "message": "You do not have any owned teams to delete.",
                "action_type": "delete_team",
                "payload": {},
            }

        team = self._match_team_by_name(owned_teams, clean_name)
        if not team:
            return {
                "status": "error",
                "context": "Delete team failed",
                "message": f'I could not find a team named "{clean_name}".',
                "action_type": "delete_team",
                "payload": {},
            }

        await self.teams.delete_team(db=db, owner=owner, team_id=team["id"])
        return {
            "status": "success",
            "context": f'Deleted team "{team["name"]}"',
            "message": f'Deleted team "{team["name"]}".',
            "action_type": "delete_team",
            "payload": {"team_name": team["name"], "team_id": team["id"]},
        }

    async def _invite_team_member(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        email: str,
        team_name: str | None,
    ) -> dict[str, Any]:
        clean_email = email.strip().lower()
        if "@" not in clean_email:
            return {
                "status": "error",
                "context": "Invite teammate failed",
                "message": "I need a valid email address to send that invite.",
                "action_type": "invite_team_member",
                "payload": {},
            }

        owned_teams = await self._get_owned_teams(db=db, owner=owner)
        if not owned_teams:
            return {
                "status": "error",
                "context": "Invite teammate failed",
                "message": "Create a team first, then I can send the invite.",
                "action_type": "invite_team_member",
                "payload": {},
            }

        team = self._match_team_by_name(owned_teams, team_name) if team_name else None
        if team_name and not team:
            return {
                "status": "error",
                "context": "Invite teammate failed",
                "message": f'I could not find a team named "{team_name}".',
                "action_type": "invite_team_member",
                "payload": {},
            }
        if not team:
            if len(owned_teams) == 1:
                team = owned_teams[0]
            else:
                team_names = ", ".join(team_item["name"] for team_item in owned_teams[:5])
                return {
                    "status": "error",
                    "context": "Invite teammate failed",
                    "message": f"You have multiple teams. Tell me which one to use: {team_names}.",
                    "action_type": "invite_team_member",
                    "payload": {},
                }

        invite = await self.teams.invite_member(
            db=db,
            owner=owner,
            team_id=team["id"],
            email=clean_email,
        )
        return {
            "status": "success",
            "context": f'Invited {invite["email"]} to {team["name"]}',
            "message": f'Sent an invite to {invite["email"]} for "{team["name"]}".',
            "action_type": "invite_team_member",
            "payload": {"email": invite["email"], "team_name": team["name"], "team_id": team["id"]},
        }

    async def _cancel_pending_invite(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        email: str,
        team_name: str | None,
    ) -> dict[str, Any]:
        clean_email = email.strip().lower()
        if "@" not in clean_email:
            return {
                "status": "error",
                "context": "Cancel invite failed",
                "message": "I need a valid email address to cancel that invite.",
                "action_type": "cancel_pending_invite",
                "payload": {},
            }

        owned_teams = await self._get_owned_teams(db=db, owner=owner)
        if not owned_teams:
            return {
                "status": "error",
                "context": "Cancel invite failed",
                "message": "You do not have any owned teams with pending invites.",
                "action_type": "cancel_pending_invite",
                "payload": {},
            }

        teams_to_check = owned_teams
        if team_name:
            team = self._match_team_by_name(owned_teams, team_name)
            if not team:
                return {
                    "status": "error",
                    "context": "Cancel invite failed",
                    "message": f'I could not find a team named "{team_name}".',
                    "action_type": "cancel_pending_invite",
                    "payload": {},
                }
            teams_to_check = [team]

        matches: list[tuple[dict, dict]] = []
        for team in teams_to_check:
            invites = team.get("pending_invites") or []
            invite = next(
                (item for item in invites if self._normalize(item.get("email")) == self._normalize(clean_email)),
                None,
            )
            if invite:
                matches.append((team, invite))

        if not matches:
            return {
                "status": "error",
                "context": "Cancel invite failed",
                "message": f'I could not find a pending invite for {clean_email}.',
                "action_type": "cancel_pending_invite",
                "payload": {},
            }

        if len(matches) > 1:
            team_names = ", ".join(team["name"] for team, _ in matches[:5])
            return {
                "status": "error",
                "context": "Cancel invite failed",
                "message": f"That email has pending invites in multiple teams. Tell me which team to use: {team_names}.",
                "action_type": "cancel_pending_invite",
                "payload": {},
            }

        team, invite = matches[0]
        await self.teams.cancel_invite(
            db=db,
            owner=owner,
            team_id=team["id"],
            invite_id=invite["id"],
        )
        return {
            "status": "success",
            "context": f"Cancelled pending invite for {clean_email}",
            "message": f'Cancelled the pending invite for {clean_email} in "{team["name"]}".',
            "action_type": "cancel_pending_invite",
            "payload": {"email": clean_email, "team_name": team["name"], "team_id": team["id"]},
        }

    async def _create_note(self, *, db: AsyncIOMotorDatabase, owner: dict, title: str) -> dict[str, Any]:
        clean_title = self._clean_name(title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Create note failed",
                "message": "I need a note title before I can create it.",
                "action_type": "create_note",
                "payload": {},
            }

        now = datetime.now(timezone.utc)
        meeting = {
            "id": str(uuid.uuid4()),
            "owner_id": owner["id"],
            "title": clean_title,
            "provider": None,
            "source_url": None,
            "scheduled_start": None,
            "scheduled_end": None,
            "status": "scheduled",
            "summary": None,
            "notes_markdown": None,
            "transcription_language": None,
            "participants": [],
            "ai_chat_enabled": True,
            "memory_enabled": True,
            "created_at": now,
            "updated_at": now,
        }
        await db["meetings"].insert_one(meeting)
        return {
            "status": "success",
            "context": f'Created note "{clean_title}"',
            "message": f'Created a new note called "{clean_title}".',
            "action_type": "create_note",
            "payload": {"meeting_id": meeting["id"], "title": clean_title},
        }

    async def _rename_current_note(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
        title: str,
    ) -> dict[str, Any]:
        meeting_id = current_meeting.get("id") if current_meeting else current_context.get("meeting_id") if current_context else None
        if not meeting_id:
            return {
                "status": "error",
                "context": "Rename note failed",
                "message": "Open a note first, then I can rename it for you.",
                "action_type": "rename_current_note",
                "payload": {},
            }

        clean_title = self._clean_name(title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Rename note failed",
                "message": "I need a valid new title before I can rename this note.",
                "action_type": "rename_current_note",
                "payload": {},
            }
        now = datetime.now(timezone.utc)
        await db["meetings"].update_one(
            {"id": meeting_id, "owner_id": owner["id"]},
            {"$set": {"title": clean_title, "updated_at": now}},
        )
        return {
            "status": "success",
            "context": f'Renamed this note to "{clean_title}"',
            "message": f'Renamed this note to "{clean_title}".',
            "action_type": "rename_current_note",
            "payload": {"meeting_id": meeting_id, "title": clean_title},
        }

    async def _delete_current_note(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        meeting_id = current_meeting.get("id") if current_meeting else current_context.get("meeting_id") if current_context else None
        meeting_title = current_meeting.get("title") if current_meeting else current_context.get("meeting_title") if current_context else None
        if not meeting_id:
            return {
                "status": "error",
                "context": "Delete note failed",
                "message": "Open a note first, then I can delete it for you.",
                "action_type": "delete_current_note",
                "payload": {},
            }

        result = await db["meetings"].delete_one({"id": meeting_id, "owner_id": owner["id"]})
        if result.deleted_count == 0:
            return {
                "status": "error",
                "context": "Delete note failed",
                "message": "I could not find that note to delete it.",
                "action_type": "delete_current_note",
                "payload": {},
            }

        await db["transcript_chunks"].delete_many({"meeting_id": meeting_id})
        await db["chat_messages"].delete_many({"meeting_id": meeting_id})
        await db["meeting_shares"].delete_many({"meeting_id": meeting_id, "owner_id": owner["id"]})
        await db["shared_meeting_views"].delete_many({"meeting_id": meeting_id, "owner_id": owner["id"]})
        title = meeting_title or "this note"
        return {
            "status": "success",
            "context": f'Deleted note "{title}"',
            "message": f'Deleted "{title}".',
            "action_type": "delete_current_note",
            "payload": {"meeting_id": meeting_id},
        }

    async def _share_current_note(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
        visibility: str,
        team_name: str | None,
    ) -> dict[str, Any]:
        meeting_id = current_meeting.get("id") if current_meeting else current_context.get("meeting_id") if current_context else None
        if not meeting_id:
            return {
                "status": "error",
                "context": "Change sharing failed",
                "message": "Open a note first, then I can change its sharing settings.",
                "action_type": "share_current_note",
                "payload": {},
            }

        clean_visibility = visibility.strip().lower()
        if clean_visibility not in {"private", "link", "team"}:
            return {
                "status": "error",
                "context": "Change sharing failed",
                "message": "Sharing can only be set to private, link, or team.",
                "action_type": "share_current_note",
                "payload": {},
            }

        now = datetime.now(timezone.utc)
        existing_share = await db["meeting_shares"].find_one({"meeting_id": meeting_id, "owner_id": owner["id"]})

        team_id = None
        if clean_visibility == "team":
            owned_teams = await self._get_owned_teams(db=db, owner=owner)
            if not owned_teams:
                return {
                    "status": "error",
                    "context": "Change sharing failed",
                    "message": "Create a team first before using team-only sharing.",
                    "action_type": "share_current_note",
                    "payload": {},
                }
            matched_team = self._match_team_by_name(owned_teams, team_name) if team_name else None
            if team_name and not matched_team:
                return {
                    "status": "error",
                    "context": "Change sharing failed",
                    "message": f'I could not find a team named "{team_name}".',
                    "action_type": "share_current_note",
                    "payload": {},
                }
            if not matched_team:
                if len(owned_teams) == 1:
                    matched_team = owned_teams[0]
                elif existing_share and existing_share.get("team_id"):
                    matched_team = next((team for team in owned_teams if team["id"] == existing_share["team_id"]), None)
                else:
                    team_names = ", ".join(team["name"] for team in owned_teams[:5])
                    return {
                        "status": "error",
                        "context": "Change sharing failed",
                        "message": f"You have multiple teams. Tell me which team to share with: {team_names}.",
                        "action_type": "share_current_note",
                        "payload": {},
                    }
            team_id = matched_team["id"] if matched_team else None

        if existing_share:
            await db["meeting_shares"].update_one(
                {"id": existing_share["id"]},
                {"$set": {"visibility": clean_visibility, "team_id": team_id, "updated_at": now}},
            )
        else:
            await db["meeting_shares"].insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "meeting_id": meeting_id,
                    "owner_id": owner["id"],
                    "token": self._generate_share_token(),
                    "visibility": clean_visibility,
                    "team_id": team_id,
                    "created_at": now,
                    "updated_at": now,
                }
            )

        label = {"private": "private", "link": "shareable by link", "team": "team-only"}[clean_visibility]
        return {
            "status": "success",
            "context": f"Changed note sharing to {label}",
            "message": f"Changed this note's sharing to {label}.",
            "action_type": "share_current_note",
            "payload": {"meeting_id": meeting_id, "visibility": clean_visibility, "team_id": team_id},
        }

    async def _create_vocabulary_term(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        canonical: str,
        aliases: Any,
    ) -> dict[str, Any]:
        clean_canonical = self._clean_name(canonical)
        if len(clean_canonical) < 2:
            return {
                "status": "error",
                "context": "Create vocabulary term failed",
                "message": "I need a valid vocabulary term before I can add it.",
                "action_type": "create_vocabulary_term",
                "payload": {},
            }

        existing_entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        existing_entry = self._match_vocabulary_entry(existing_entries, clean_canonical)
        if existing_entry:
            return {
                "status": "error",
                "context": "Create vocabulary term failed",
                "message": f'"{existing_entry["canonical"]}" is already in your vocabulary list.',
                "action_type": "create_vocabulary_term",
                "payload": {"entry_id": existing_entry["id"], "canonical": existing_entry["canonical"]},
            }

        entry = await self.vocabulary.create_entry(
            db=db,
            owner_id=owner["id"],
            canonical=clean_canonical,
            aliases=self._normalize_aliases(aliases),
        )
        return {
            "status": "success",
            "context": f'Added vocabulary term "{entry["canonical"]}"',
            "message": f'Added "{entry["canonical"]}" to your vocabulary.',
            "action_type": "create_vocabulary_term",
            "payload": {"entry_id": entry["id"], "canonical": entry["canonical"], "aliases": entry.get("aliases") or []},
        }

    async def _update_vocabulary_term(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        canonical: str,
        new_canonical: str | None,
        aliases: Any,
    ) -> dict[str, Any]:
        clean_canonical = self._clean_name(canonical)
        if len(clean_canonical) < 2:
            return {
                "status": "error",
                "context": "Update vocabulary term failed",
                "message": "Tell me which vocabulary term you want to update.",
                "action_type": "update_vocabulary_term",
                "payload": {},
            }

        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        target = self._match_vocabulary_entry(entries, clean_canonical)
        if not target:
            return {
                "status": "error",
                "context": "Update vocabulary term failed",
                "message": f'I could not find a vocabulary term named "{clean_canonical}".',
                "action_type": "update_vocabulary_term",
                "payload": {},
            }

        replacement_canonical = self._clean_name(new_canonical or target["canonical"])
        if len(replacement_canonical) < 2:
            return {
                "status": "error",
                "context": "Update vocabulary term failed",
                "message": "I need a valid replacement canonical term before I can save it.",
                "action_type": "update_vocabulary_term",
                "payload": {},
            }

        updated = await self.vocabulary.update_entry(
            db=db,
            owner_id=owner["id"],
            entry_id=target["id"],
            canonical=replacement_canonical,
            aliases=self._normalize_aliases(aliases) if aliases is not None else (target.get("aliases") or []),
        )
        if not updated:
            return {
                "status": "error",
                "context": "Update vocabulary term failed",
                "message": "I couldn't update that vocabulary term.",
                "action_type": "update_vocabulary_term",
                "payload": {},
            }

        return {
            "status": "success",
            "context": f'Updated vocabulary term "{updated["canonical"]}"',
            "message": f'Updated "{updated["canonical"]}" in your vocabulary.',
            "action_type": "update_vocabulary_term",
            "payload": {"entry_id": updated["id"], "canonical": updated["canonical"], "aliases": updated.get("aliases") or []},
        }

    async def _delete_vocabulary_term(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        canonical: str,
    ) -> dict[str, Any]:
        clean_canonical = self._clean_name(canonical)
        if len(clean_canonical) < 2:
            return {
                "status": "error",
                "context": "Delete vocabulary term failed",
                "message": "Tell me which vocabulary term you want me to delete.",
                "action_type": "delete_vocabulary_term",
                "payload": {},
            }

        entries = await self.vocabulary.list_entries(db=db, owner_id=owner["id"])
        target = self._match_vocabulary_entry(entries, clean_canonical)
        if not target:
            return {
                "status": "error",
                "context": "Delete vocabulary term failed",
                "message": f'I could not find a vocabulary term named "{clean_canonical}".',
                "action_type": "delete_vocabulary_term",
                "payload": {},
            }

        deleted = await self.vocabulary.delete_entry(db=db, owner_id=owner["id"], entry_id=target["id"])
        if not deleted:
            return {
                "status": "error",
                "context": "Delete vocabulary term failed",
                "message": "I couldn't delete that vocabulary term.",
                "action_type": "delete_vocabulary_term",
                "payload": {},
            }

        return {
            "status": "success",
            "context": f'Deleted vocabulary term "{target["canonical"]}"',
            "message": f'Removed "{target["canonical"]}" from your vocabulary.',
            "action_type": "delete_vocabulary_term",
            "payload": {"entry_id": target["id"], "canonical": target["canonical"]},
        }

    async def _create_calendar_event(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        title: str,
        description: str | None,
        start_value: Any,
        end_value: Any,
        attendees: Any,
    ) -> dict[str, Any]:
        clean_title = self._clean_name(title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Create calendar event failed",
                "message": "I need an event title before I can create it.",
                "action_type": "create_calendar_event",
                "payload": {},
            }

        start = self._parse_datetime_input(start_value)
        end = self._parse_datetime_input(end_value)
        if not start or not end:
            return {
                "status": "error",
                "context": "Create calendar event failed",
                "message": "I need valid start and end times before I can create that calendar event.",
                "action_type": "create_calendar_event",
                "payload": {},
            }
        if end <= start:
            return {
                "status": "error",
                "context": "Create calendar event failed",
                "message": "The end time needs to be after the start time.",
                "action_type": "create_calendar_event",
                "payload": {},
            }
        if start < datetime.now(timezone.utc):
            return {
                "status": "error",
                "context": "Create calendar event failed",
                "message": "Meetings can only be created for now or a future time.",
                "action_type": "create_calendar_event",
                "payload": {},
            }

        event = await self.calendar.create_event(
            db=db,
            user=owner,
            title=clean_title,
            description=description,
            start=start,
            end=end,
            attendees=self._normalize_email_list(attendees),
        )
        return {
            "status": "success",
            "context": f'Created calendar event "{event.title}"',
            "message": f'Created calendar event "{event.title}".',
            "action_type": "create_calendar_event",
            "payload": {
                "event_id": event.id,
                "title": event.title,
                "start": event.start.isoformat() if event.start else None,
                "end": event.end.isoformat() if event.end else None,
                "join_url": event.join_url,
                "html_link": event.html_link,
            },
        }

    async def _delete_calendar_event(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        event_title: str,
        current_context: dict[str, Any] | None,
    ) -> dict[str, Any]:
        clean_title = self._clean_name(event_title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Delete calendar event failed",
                "message": "Tell me which event title you want me to delete.",
                "action_type": "delete_calendar_event",
                "payload": {},
            }

        now = datetime.now(timezone.utc)
        events = await self.calendar.list_events(
            db=db,
            user=owner,
            time_min=now - timedelta(days=1),
            time_max=now + timedelta(days=180),
            max_results=250,
        )
        matched_event = self._match_calendar_event(events, clean_title)
        if not matched_event:
            visible_month = (current_context or {}).get("visible_month")
            guidance = f' in {visible_month}' if isinstance(visible_month, str) and visible_month else ""
            return {
                "status": "error",
                "context": "Delete calendar event failed",
                "message": f'I could not find an upcoming event named "{clean_title}"{guidance}.',
                "action_type": "delete_calendar_event",
                "payload": {},
            }

        await self.calendar.delete_event(db=db, user=owner, event_id=matched_event.id)
        return {
            "status": "success",
            "context": f'Deleted calendar event "{matched_event.title}"',
            "message": f'Deleted calendar event "{matched_event.title}".',
            "action_type": "delete_calendar_event",
            "payload": {"event_id": matched_event.id, "title": matched_event.title},
        }

    async def _generate_readout(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        timeframe: str | None,
        sources: Any,
    ) -> dict[str, Any]:
        normalized_timeframe = timeframe if timeframe in {"24h", "3d", "7d"} else "24h"
        normalized_sources = self._normalize_sources(sources) or ["gmail", "slack"]
        readout = await self.readouts.generate_readout(
            db=db,
            owner=owner,
            payload=ReadoutGenerateRequest(
                timeframe=normalized_timeframe,
                sources=normalized_sources,
                max_items_per_source=8,
            ),
        )
        return {
            "status": "success",
            "context": f'Generated readout "{readout.title}"',
            "message": f'Generated readout "{readout.title}".',
            "action_type": "generate_readout",
            "payload": {
                "readout_id": readout.id,
                "title": readout.title,
                "timeframe": readout.timeframe,
                "sources": readout.sources,
            },
        }

    async def _create_task(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        title: str,
        status: str | None,
    ) -> dict[str, Any]:
        clean_title = self._clean_name(title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Create task failed",
                "message": "I need a valid task title before I can create it.",
                "action_type": "create_task",
                "payload": {},
            }
        task = await self.tasks.create_task(
            db=db,
            owner_id=owner["id"],
            title=clean_title,
            status=status or "open",
            source="manual",
        )
        return {
            "status": "success",
            "context": f'Created task "{task["title"]}"',
            "message": f'Created task "{task["title"]}" in {task["status"]}.',
            "action_type": "create_task",
            "payload": {"task_id": task["id"], "task_title": task["title"], "status": task["status"]},
        }

    async def _update_task_status(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        task_title: str,
        status: str,
    ) -> dict[str, Any]:
        clean_title = self._clean_name(task_title)
        clean_status = self._normalize(status)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Update task failed",
                "message": "Tell me which task you want me to update.",
                "action_type": "update_task_status",
                "payload": {},
            }
        if clean_status not in {"open", "blocked", "done"}:
            return {
                "status": "error",
                "context": "Update task failed",
                "message": "Task status needs to be open, blocked, or done.",
                "action_type": "update_task_status",
                "payload": {},
            }

        tasks = await self.tasks.list_tasks(db=db, owner_id=owner["id"])
        task = self._match_task_by_title(tasks, clean_title)
        if not task:
            return {
                "status": "error",
                "context": "Update task failed",
                "message": f'I could not find a task named "{clean_title}".',
                "action_type": "update_task_status",
                "payload": {},
            }

        column_tasks = [item for item in tasks if item.get("status") == clean_status and item.get("id") != task["id"]]
        next_position = max((float(item.get("position") or 0) for item in column_tasks), default=0.0) + 1.0
        updated = await self.tasks.update_task(
            db=db,
            owner_id=owner["id"],
            task_id=task["id"],
            status=clean_status,
            position=next_position,
        )
        if not updated:
            return {
                "status": "error",
                "context": "Update task failed",
                "message": "I couldn't update that task.",
                "action_type": "update_task_status",
                "payload": {},
            }

        return {
            "status": "success",
            "context": f'Moved task "{updated["title"]}" to {updated["status"]}',
            "message": f'Moved "{updated["title"]}" to {updated["status"]}.',
            "action_type": "update_task_status",
            "payload": {"task_id": updated["id"], "task_title": updated["title"], "status": updated["status"]},
        }

    async def _delete_task(
        self,
        *,
        db: AsyncIOMotorDatabase,
        owner: dict,
        task_title: str,
    ) -> dict[str, Any]:
        clean_title = self._clean_name(task_title)
        if len(clean_title) < 2:
            return {
                "status": "error",
                "context": "Delete task failed",
                "message": "Tell me which task you want me to delete.",
                "action_type": "delete_task",
                "payload": {},
            }

        tasks = await self.tasks.list_tasks(db=db, owner_id=owner["id"])
        task = self._match_task_by_title(tasks, clean_title)
        if not task:
            return {
                "status": "error",
                "context": "Delete task failed",
                "message": f'I could not find a task named "{clean_title}".',
                "action_type": "delete_task",
                "payload": {},
            }
        deleted = await self.tasks.delete_task(db=db, owner_id=owner["id"], task_id=task["id"])
        if not deleted:
            return {
                "status": "error",
                "context": "Delete task failed",
                "message": "I couldn't delete that task.",
                "action_type": "delete_task",
                "payload": {},
            }

        return {
            "status": "success",
            "context": f'Deleted task "{task["title"]}"',
            "message": f'Deleted task "{task["title"]}".',
            "action_type": "delete_task",
            "payload": {"task_id": task["id"], "task_title": task["title"]},
        }

    def _create_folder(self, *, folder_name: str, folder_color: str | None) -> dict[str, Any]:
        clean_name = self._clean_name(folder_name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Create folder failed",
                "message": "I need a valid folder name before I can create it.",
                "action_type": "create_folder",
                "payload": {},
            }
        return {
            "status": "success",
            "context": f'Created folder "{clean_name}"',
            "message": f'Created folder "{clean_name}".',
            "action_type": "create_folder",
            "payload": {"folder_name": clean_name, "folder_color": folder_color},
        }

    def _delete_folder(self, *, folder_name: str) -> dict[str, Any]:
        clean_name = self._clean_name(folder_name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Delete folder failed",
                "message": "I need the folder name before I can delete it.",
                "action_type": "delete_folder",
                "payload": {},
            }
        return {
            "status": "success",
            "context": f'Deleted folder "{clean_name}"',
            "message": f'Deleted folder "{clean_name}".',
            "action_type": "delete_folder",
            "payload": {"folder_name": clean_name},
        }

    def _delete_current_folder(self, *, current_context: dict[str, Any] | None) -> dict[str, Any]:
        folder_name = self._clean_name(str((current_context or {}).get("folder_name") or ""))
        folder_id = (current_context or {}).get("folder_id")
        if not folder_name and not folder_id:
            return {
                "status": "error",
                "context": "Delete folder failed",
                "message": "Open a folder first, then I can delete it.",
                "action_type": "delete_current_folder",
                "payload": {},
            }
        label = folder_name or "this folder"
        return {
            "status": "success",
            "context": f'Deleted folder "{label}"',
            "message": f'Deleted folder "{label}".',
            "action_type": "delete_current_folder",
            "payload": {"folder_name": folder_name, "folder_id": folder_id},
        }

    def _add_current_note_to_folder(
        self,
        *,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
        folder_name: str,
    ) -> dict[str, Any]:
        meeting_id = current_meeting.get("id") if current_meeting else current_context.get("meeting_id") if current_context else None
        meeting_title = current_meeting.get("title") if current_meeting else current_context.get("meeting_title") if current_context else None
        if not meeting_id:
            return {
                "status": "error",
                "context": "Add to folder failed",
                "message": "Open a note first, then I can add it to a folder.",
                "action_type": "add_current_note_to_folder",
                "payload": {},
            }
        clean_name = self._clean_name(folder_name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Add to folder failed",
                "message": "I need the folder name before I can add this note to it.",
                "action_type": "add_current_note_to_folder",
                "payload": {},
            }
        return {
            "status": "success",
            "context": f'Added note to folder "{clean_name}"',
            "message": f'Added this note to folder "{clean_name}".',
            "action_type": "add_current_note_to_folder",
            "payload": {"folder_name": clean_name, "meeting_id": meeting_id, "title": meeting_title or "Untitled meeting"},
        }

    def _remove_current_note_from_folder(
        self,
        *,
        current_meeting: dict | None,
        current_context: dict[str, Any] | None,
        folder_name: str,
    ) -> dict[str, Any]:
        meeting_id = current_meeting.get("id") if current_meeting else current_context.get("meeting_id") if current_context else None
        if not meeting_id:
            return {
                "status": "error",
                "context": "Remove from folder failed",
                "message": "Open a note first, then I can remove it from a folder.",
                "action_type": "remove_current_note_from_folder",
                "payload": {},
            }
        clean_name = self._clean_name(folder_name)
        if len(clean_name) < 2:
            return {
                "status": "error",
                "context": "Remove from folder failed",
                "message": "I need the folder name before I can remove this note from it.",
                "action_type": "remove_current_note_from_folder",
                "payload": {},
            }
        return {
            "status": "success",
            "context": f'Removed note from folder "{clean_name}"',
            "message": f'Removed this note from folder "{clean_name}".',
            "action_type": "remove_current_note_from_folder",
            "payload": {"folder_name": clean_name, "meeting_id": meeting_id},
        }

    async def _get_owned_teams(self, *, db: AsyncIOMotorDatabase, owner: dict) -> list[dict]:
        teams = await self.teams.get_user_teams(db=db, user=owner)
        return [team for team in teams if team.get("is_owner")]

    def _match_team_by_name(self, teams: list[dict], team_name: str | None) -> dict | None:
        if not team_name:
            return None
        normalized = self._normalize(team_name)
        exact = next((team for team in teams if self._normalize(team.get("name")) == normalized), None)
        if exact:
            return exact
        return next((team for team in teams if normalized in self._normalize(team.get("name"))), None)

    def _match_vocabulary_entry(self, entries: list[dict], canonical: str) -> dict | None:
        normalized = self._normalize(canonical)
        exact = next((entry for entry in entries if self._normalize(entry.get("canonical")) == normalized), None)
        if exact:
            return exact
        return next((entry for entry in entries if normalized in self._normalize(entry.get("canonical"))), None)

    def _match_calendar_event(self, events: list[Any], event_title: str) -> Any | None:
        normalized = self._normalize(event_title)
        exact = next((event for event in events if self._normalize(getattr(event, "title", None)) == normalized), None)
        if exact:
            return exact
        return next((event for event in events if normalized in self._normalize(getattr(event, "title", None))), None)

    def _match_task_by_title(self, tasks: list[dict], task_title: str) -> dict | None:
        normalized = self._normalize(task_title)
        exact = next((task for task in tasks if self._normalize(task.get("title")) == normalized), None)
        if exact:
            return exact
        return next((task for task in tasks if normalized in self._normalize(task.get("title"))), None)

    def _response_message_to_dict(self, response) -> dict[str, Any]:
        message = getattr(response, "message", None)
        if message is not None:
            return {
                "role": "assistant",
                "content": getattr(message, "content", None),
                "tool_calls": [self._tool_call_to_dict(item) for item in (getattr(message, "tool_calls", None) or [])],
            }
        if isinstance(response, dict):
            message = response.get("message", {})
            return {
                "role": message.get("role", "assistant"),
                "content": message.get("content"),
                "tool_calls": message.get("tool_calls") or [],
            }
        return {"role": "assistant", "content": str(response), "tool_calls": []}

    def _tool_call_to_dict(self, tool_call: Any) -> dict[str, Any]:
        function_call = getattr(tool_call, "function", None)
        if function_call is not None:
            return {
                "type": getattr(tool_call, "type", "function"),
                "function": {
                    "name": getattr(function_call, "name", None),
                    "arguments": getattr(function_call, "arguments", None),
                },
            }
        if isinstance(tool_call, dict):
            return tool_call
        return {}

    def _extract_content(self, response: Any) -> str:
        return self.ollama.extract_message_content(response)

    def _parse_json_object(self, value: str) -> dict[str, Any] | None:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{.*\}", value, flags=re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _clean_name(self, value: str) -> str:
        return re.sub(r"\s+", " ", value).strip().strip("\"'")

    def _normalize(self, value: str | None) -> str:
        return self._clean_name(value or "").lower()

    def _optional_string(self, value: Any) -> str | None:
        if value is None:
            return None
        text = self._clean_name(str(value))
        return text or None

    def _normalize_aliases(self, value: Any) -> list[str]:
        items: list[str] = []
        if isinstance(value, list):
            items = [self._clean_name(str(item)) for item in value]
        elif isinstance(value, str):
            items = [self._clean_name(item) for item in value.split(",")]
        seen: set[str] = set()
        normalized: list[str] = []
        for item in items:
            if not item:
                continue
            key = item.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized.append(item)
        return normalized

    def _normalize_email_list(self, value: Any) -> list[str]:
        raw_items: list[str] = []
        if isinstance(value, list):
            raw_items = [str(item).strip().lower() for item in value]
        elif isinstance(value, str):
            raw_items = [item.strip().lower() for item in value.split(",")]
        return [item for item in raw_items if item and "@" in item]

    def _normalize_sources(self, value: Any) -> list[str]:
        raw_items: list[str] = []
        if isinstance(value, list):
            raw_items = [str(item).strip().lower() for item in value]
        elif isinstance(value, str):
            raw_items = [item.strip().lower() for item in value.split(",")]
        normalized = [item for item in raw_items if item in {"gmail", "slack"}]
        seen: set[str] = set()
        unique: list[str] = []
        for item in normalized:
            if item in seen:
                continue
            seen.add(item)
            unique.append(item)
        return unique

    def _parse_datetime_input(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if not isinstance(value, str):
            return None
        candidate = value.strip()
        if not candidate:
            return None
        try:
            parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    def _generate_share_token(self) -> str:
        return uuid.uuid4().hex[:10]

    def _public_action_result(self, result: dict[str, Any]) -> dict[str, Any]:
        return {
            "action_type": result.get("action_type") or "unknown",
            "status": result.get("status") or "error",
            "message": result.get("message") or "",
            "payload": result.get("payload") or {},
        }
