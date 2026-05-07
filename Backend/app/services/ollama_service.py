from collections.abc import AsyncIterator

from ollama import AsyncClient

from app.core.config import settings


class OllamaService:
    def __init__(self) -> None:
        self.client = AsyncClient(host=settings.ollama_base_url)

    async def chat_response(
        self,
        *,
        messages: list[dict],
        tools: list[dict] | None = None,
        format: str | dict | None = None,
        think: bool | str | None = None,
        stream: bool = False,
    ):
        return await self.client.chat(
            model=settings.ollama_chat_model,
            messages=messages,
            tools=tools,
            format=format,
            think=think,
            stream=stream,
        )

    async def chat(self, system_prompt: str, user_prompt: str) -> str:
        try:
            response = await self.chat_response(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
        except Exception:
            return (
                "Ollama is currently unavailable. This is a graceful fallback response so the API "
                "still works during local setup."
            )

        content = self.extract_message_content(response)
        if content:
            return content

        return ""

    async def chat_stream(
        self,
        system_prompt: str,
        user_prompt: str,
    ) -> AsyncIterator[str]:
        try:
            stream = await self.chat_response(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
        except Exception:
            yield (
                "Ollama is currently unavailable. This is a graceful fallback response so the API "
                "still works during local setup."
            )
            return

        try:
            async for chunk in stream:
                if getattr(chunk, "message", None) and getattr(chunk.message, "content", None):
                    if chunk.message.content:
                        yield chunk.message.content
                    continue

                if isinstance(chunk, dict):
                    content = chunk.get("message", {}).get("content")
                    if content:
                        yield content
        except Exception:
            yield "\n[Stream interrupted while receiving response from Ollama.]"

    def extract_message_content(self, response) -> str:
        if getattr(response, "message", None) and getattr(response.message, "content", None):
            return response.message.content or ""

        if isinstance(response, dict):
            message = response.get("message", {})
            return message.get("content") or ""

        return ""
