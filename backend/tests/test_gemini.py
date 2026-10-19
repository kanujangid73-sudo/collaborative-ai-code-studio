import asyncio
import json

import httpx
import pytest

from app.ai import Assistant, HistoryItem
from app.config import settings

HISTORY = [
    HistoryItem("user", "alice", "explain list comprehensions"),
    HistoryItem("assistant", "AI", "Sure."),
    HistoryItem("user", "bob", "with an example please"),
]


def sse(*events):
    return "".join(f"data: {json.dumps(e)}\r\n\r\n" for e in events).encode()


def chunk(text, finish=None):
    candidate = {"content": {"role": "model", "parts": [{"text": text}]}}
    if finish:
        candidate["finishReason"] = finish
    return {"candidates": [candidate]}


def fake_gemini(status=200, body=b""):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/v1beta/models/{settings.gemini_model}:streamGenerateContent"
        assert request.url.params["alt"] == "sse"
        assert request.headers["x-goog-api-key"] == "test-key"
        payload = json.loads(request.content)
        assert [c["role"] for c in payload["contents"]] == ["user", "model", "user"]
        assert payload["contents"][2]["parts"][0]["text"] == "[bob]: with an example please"
        assert "CodeTogether" in payload["systemInstruction"]["parts"][0]["text"]
        return httpx.Response(status, content=body)

    return httpx.MockTransport(handler)


def collect(assistant):
    async def run():
        return "".join([c async for c in assistant.stream_reply(HISTORY)])

    return asyncio.run(run())


@pytest.fixture()
def gemini_on(monkeypatch):
    monkeypatch.setattr(settings, "gemini_enabled", True)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")


def test_streams_gemini_reply(gemini_on):
    body = sse(chunk("squares = "), chunk("[x * x for x in nums]", finish="STOP"))
    assistant = Assistant(transport=fake_gemini(body=body))
    assert assistant.mode == "gemini" and assistant.model == settings.gemini_model
    assert collect(assistant) == "squares = [x * x for x in nums]"


def test_thought_parts_are_hidden(gemini_on):
    event = {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": "answer"}]}}]}
    assistant = Assistant(transport=fake_gemini(body=sse(event)))
    assert collect(assistant) == "answer"


def test_rate_limit_falls_back_to_offline(gemini_on):
    assistant = Assistant(transport=fake_gemini(status=429, body=b'{"error": "quota"}'))
    reply = collect(assistant)
    assert reply.startswith("_Gemini's free-tier limit was reached")
    assert "bob" in reply  # offline assistant addresses the last author


def test_blocked_prompt(gemini_on):
    body = sse({"promptFeedback": {"blockReason": "SAFETY"}})
    assistant = Assistant(transport=fake_gemini(body=body))
    assert collect(assistant) == "_Gemini declined to answer this request._"
