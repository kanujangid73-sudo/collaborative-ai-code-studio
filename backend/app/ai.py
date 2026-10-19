"""AI assistant. Streams replies from the best available provider:

1. Claude (Anthropic API) when an API key is configured
2. Ollama, a free local model server, when it is running with the configured model
3. A built-in offline assistant otherwise
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic
import httpx

from .config import settings

logger = logging.getLogger("codetogether.ai")

OFFLINE_MODEL = "offline-assistant"

SYSTEM_PROMPT = """You are the AI pair programmer inside CodeTogether, a collaborative \
coding workspace. Several developers share each workspace, and every user message is \
prefixed with the author's name in square brackets, e.g. "[alice]: ...".

Help the team design, write, debug and review code. Keep answers focused and practical: \
lead with the answer, then the code. Use Markdown, with fenced code blocks that name \
the language. When the request is ambiguous, state the assumption you made instead of \
asking several questions. Address people by name when it helps clarify who you are answering."""

# Keyword -> intent. First match wins.
INTENTS: list[tuple[tuple[str, ...], str]] = [
    (("bug", "error", "fix", "crash", "exception", "traceback"), "debug"),
    (("test", "pytest", "coverage", "unit test", "jest", "vitest"), "testing"),
    (("endpoint", "api", "route", "rest", "request"), "api"),
    (("deploy", "docker", "server", "host", "ci", "kubernetes"), "devops"),
    (("ui", "design", "css", "component", "react", "layout"), "frontend"),
    (("sql", "database", "query", "table", "schema", "migration"), "database"),
]

OFFLINE_TIPS = {
    "api": (
        "Here's a solid shape for a new endpoint:\n\n"
        "```python\nfrom pydantic import BaseModel\n\nclass SignupIn(BaseModel):\n"
        "    username: str\n    password: str\n\n@app.post(\"/api/signup\", status_code=201)\n"
        "def signup(data: SignupIn):\n    ...  # validate, hash the password, save the user\n```\n\n"
        "1. Validate the payload with a Pydantic model.\n2. Keep business logic out of the route.\n"
        "3. Add a test for the happy path and for invalid input."
    ),
    "debug": (
        "A reliable debugging loop:\n\n1. **Reproduce** it with the smallest failing input.\n"
        "2. **Read the full traceback** - the last frame in *your* code is usually the culprit.\n"
        "3. **Write a failing test**, then fix until it passes.\n\n"
        "```python\ndef test_reproduces_bug():\n    assert do_thing(\"edge case\") == expected\n```"
    ),
    "testing": (
        "Start with the happy path, then edge cases:\n\n"
        "```python\ndef test_create_message(client):\n"
        "    res = client.post(\"/api/messages\", json={\"content\": \"hi\"})\n"
        "    assert res.status_code == 201\n```\n\n"
        "Then cover empty input, too-long input and unauthorized requests."
    ),
    "devops": (
        "To ship this app:\n\n1. Containerize the backend and frontend (see `docker-compose.yml`).\n"
        "2. Pass secrets like `SECRET_KEY` and `ANTHROPIC_API_KEY` as environment variables.\n"
        "3. Point the load balancer health check at `GET /api/health`."
    ),
    "frontend": (
        "For UI work, build small components and keep styling in design tokens:\n\n"
        "```jsx\nexport function StatCard({ label, value }) {\n  return (\n"
        "    <article className=\"card\">\n      <span>{label}</span>\n      <strong>{value}</strong>\n"
        "    </article>\n  );\n}\n```"
    ),
    "database": (
        "With SQLModel, a table is a typed class:\n\n"
        "```python\nclass Task(SQLModel, table=True):\n    id: int | None = Field(default=None, primary_key=True)\n"
        "    title: str\n    done: bool = False\n```\n\nIndex the columns you filter on, and keep migrations in version control."
    ),
}


def detect_intent(text: str) -> str:
    lowered = text.lower()
    for keywords, intent in INTENTS:
        if any(word in lowered for word in keywords):
            return intent
    return "general"


@dataclass
class HistoryItem:
    role: str  # "user" or "assistant"
    author: str
    content: str


def build_messages(history: list[HistoryItem]) -> list[dict]:
    """Convert workspace history into alternating user/assistant turns."""
    turns: list[dict] = []
    for item in history:
        text = f"[{item.author}]: {item.content}" if item.role == "user" else item.content
        if turns and turns[-1]["role"] == item.role:
            turns[-1]["content"] += "\n\n" + text
        else:
            turns.append({"role": item.role, "content": text})
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


class OllamaError(Exception):
    pass


class Assistant:
    OLLAMA_RECHECK_SECONDS = 15

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.client = anthropic.AsyncAnthropic() if settings.claude_enabled else None
        self.ollama_status = "disabled" if not settings.ollama_enabled else "unknown"
        self._ollama_checked_at = 0.0
        self._transport = transport  # lets tests swap in a fake Ollama server

    @property
    def mode(self) -> str:
        if self.client:
            return "claude"
        return "ollama" if self.ollama_status == "ready" else "offline"

    @property
    def model(self) -> str:
        return {"claude": settings.ai_model, "ollama": settings.ollama_model}.get(self.mode, OFFLINE_MODEL)

    def _http(self, timeout: httpx.Timeout) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=settings.ollama_url, timeout=timeout, transport=self._transport)

    async def refresh(self, force: bool = False) -> None:
        """Re-check whether Ollama is reachable and has the model, at most every few seconds."""
        if self.client or self.ollama_status == "disabled":
            return
        if not force and time.monotonic() - self._ollama_checked_at < self.OLLAMA_RECHECK_SECONDS:
            return
        self._ollama_checked_at = time.monotonic()
        previous = self.ollama_status
        try:
            async with self._http(httpx.Timeout(3.0)) as http:
                res = await http.get("/api/tags")
                res.raise_for_status()
            names = {m.get("name", "") for m in res.json().get("models", [])}
            wanted = settings.ollama_model
            found = wanted in names or f"{wanted}:latest" in names
            self.ollama_status = "ready" if found else "model_missing"
        except (httpx.HTTPError, ValueError):
            self.ollama_status = "unreachable"
        if self.ollama_status != previous:
            if self.ollama_status == "model_missing":
                logger.warning("Ollama is running but '%s' is not downloaded. Run: ollama pull %s",
                               settings.ollama_model, settings.ollama_model)
            else:
                logger.info("Ollama status: %s (%s)", self.ollama_status, settings.ollama_model)

    async def stream_reply(self, history: list[HistoryItem]) -> AsyncIterator[str]:
        await self.refresh()
        if self.mode == "ollama":
            async for chunk in self._ollama_with_fallback(history):
                yield chunk
            return
        if self.client is None:
            async for chunk in self._offline(history):
                yield chunk
            return
        try:
            async for chunk in self._claude(history):
                yield chunk
        except anthropic.AuthenticationError:
            logger.error("Anthropic authentication failed - check ANTHROPIC_API_KEY")
            yield "\n\n_The AI service rejected the API key. Ask the admin to check `ANTHROPIC_API_KEY`._"
        except anthropic.RateLimitError:
            yield "\n\n_The AI is getting too many requests right now. Try again in a moment._"
        except anthropic.APIStatusError as exc:
            logger.error("Anthropic API error %s: %s", exc.status_code, exc.message)
            yield "\n\n_The AI service returned an error. Please try again._"
        except anthropic.APIConnectionError:
            yield "\n\n_Could not reach the AI service. Check the server's internet connection._"

    async def _claude(self, history: list[HistoryItem]) -> AsyncIterator[str]:
        messages = build_messages(history)
        async with self.client.beta.messages.stream(
            model=settings.ai_model,
            max_tokens=64000,
            system=SYSTEM_PROMPT,
            messages=messages,
            output_config={"effort": settings.ai_effort},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
        if final.stop_reason == "refusal":
            yield "\n\n_I can't help with that request._"
        elif final.stop_reason == "max_tokens":
            yield "\n\n_(Reply was cut off because it reached the length limit.)_"

    async def _ollama_with_fallback(self, history: list[HistoryItem]) -> AsyncIterator[str]:
        produced = False
        try:
            async for chunk in self._ollama(history):
                produced = True
                yield chunk
        except (httpx.HTTPError, OllamaError) as exc:
            logger.error("Ollama request failed: %s", exc)
            self.ollama_status = "unreachable"
            self._ollama_checked_at = time.monotonic()
            if produced:
                yield "\n\n_(The local AI stopped responding before finishing.)_"
            else:
                yield "_The local AI (Ollama) isn't responding, so here is the offline assistant instead._\n\n"
                async for chunk in self._offline(history):
                    yield chunk

    async def _ollama(self, history: list[HistoryItem]) -> AsyncIterator[str]:
        messages = build_messages(history[-settings.ollama_history_messages:])
        payload = {
            "model": settings.ollama_model,
            "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
            "stream": True,
        }
        # Generous read timeout: a small model on a laptop CPU can take a while to start.
        async with self._http(httpx.Timeout(300.0, connect=3.0)) as http:
            async with http.stream("POST", "/api/chat", json=payload) as res:
                if res.status_code != 200:
                    body = (await res.aread()).decode(errors="replace")
                    raise OllamaError(f"HTTP {res.status_code}: {body[:200]}")
                async for line in res.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if "error" in data:
                        raise OllamaError(data["error"])
                    text = data.get("message", {}).get("content", "")
                    if text:
                        yield text
                    if data.get("done"):
                        break

    async def _offline(self, history: list[HistoryItem]) -> AsyncIterator[str]:
        last = next((h for h in reversed(history) if h.role == "user"), None)
        if last is None:
            return
        intent = detect_intent(last.content)
        tip = OFFLINE_TIPS.get(
            intent,
            f"Thanks, **{last.author}**. I'm running in offline mode, so I can only give "
            "general guidance. Ask about APIs, debugging, testing, databases, frontend or "
            "deployment for a more specific tip.\n\n"
            "_Run [Ollama](https://ollama.com) locally (free) or set `ANTHROPIC_API_KEY` "
            "on the server to enable full AI replies._",
        )
        reply = f"**{last.author}**, {tip[0].lower()}{tip[1:]}" if intent != "general" else tip
        # Stream word by word so the UI behaves the same as with a real model.
        for word in reply.split(" "):
            yield word + " "
            await asyncio.sleep(0.015)


assistant = Assistant()
