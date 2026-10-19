import asyncio
import json

import httpx
import pytest

from app.ai import Assistant, HistoryItem
from app.config import settings

HISTORY = [HistoryItem("user", "alice", "write a hello world in python")]


def fake_ollama(models, chat_lines=None, chat_status=200):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m} for m in models]})
        if request.url.path == "/api/chat":
            body = json.loads(request.content)
            assert body["model"] == settings.ollama_model
            assert body["messages"][0]["role"] == "system"
            assert body["messages"][-1]["content"] == "[alice]: write a hello world in python"
            lines = "\n".join(json.dumps(line) for line in chat_lines or [])
            return httpx.Response(chat_status, content=lines.encode())
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def collect(assistant):
    async def run():
        return "".join([chunk async for chunk in assistant.stream_reply(HISTORY)])

    return asyncio.run(run())


@pytest.fixture()
def ollama_on(monkeypatch):
    monkeypatch.setattr(settings, "ollama_enabled", True)


def test_streams_from_ollama_when_model_is_available(ollama_on):
    lines = [
        {"message": {"content": "print("}, "done": False},
        {"message": {"content": "'hello')"}, "done": False},
        {"message": {"content": ""}, "done": True},
    ]
    assistant = Assistant(transport=fake_ollama([settings.ollama_model], lines))
    assert collect(assistant) == "print('hello')"
    assert assistant.mode == "ollama"
    assert assistant.model == settings.ollama_model


def test_missing_model_uses_offline_assistant(ollama_on):
    assistant = Assistant(transport=fake_ollama(["some-other-model"]))
    reply = collect(assistant)
    assert assistant.ollama_status == "model_missing"
    assert assistant.mode == "offline"
    assert "alice" in reply


def test_ollama_error_falls_back_to_offline(ollama_on):
    assistant = Assistant(transport=fake_ollama([settings.ollama_model], chat_status=500))
    reply = collect(assistant)
    assert reply.startswith("_The local AI (Ollama) isn't responding")
    assert assistant.mode == "offline"


def test_unreachable_ollama_means_offline(ollama_on):
    def refuse(request):
        raise httpx.ConnectError("connection refused")

    assistant = Assistant(transport=httpx.MockTransport(refuse))
    asyncio.run(assistant.refresh(force=True))
    assert assistant.ollama_status == "unreachable"
    assert assistant.mode == "offline"
