import pytest
from starlette.websockets import WebSocketDisconnect

from app.ai import HistoryItem, build_messages, detect_intent

from .conftest import register


def receive_until(ws, event_type):
    while True:
        event = ws.receive_json()
        if event["type"] == event_type:
            return event


def test_detect_intent():
    assert detect_intent("I get a TypeError traceback") == "debug"
    assert detect_intent("add a signup endpoint") == "api"
    assert detect_intent("hello there") == "general"


def test_build_messages_merges_and_starts_with_user():
    history = [
        HistoryItem("assistant", "AI", "orphan reply"),
        HistoryItem("user", "alice", "hi"),
        HistoryItem("user", "bob", "hey"),
        HistoryItem("assistant", "AI", "hello both"),
    ]
    turns = build_messages(history)
    assert [t["role"] for t in turns] == ["user", "assistant"]
    assert turns[0]["content"] == "[alice]: hi\n\n[bob]: hey"


def test_socket_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/ws/workspaces/1?token=bad") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_message_flow_with_ai_reply(client, token, auth):
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        assert receive_until(ws, "presence")["users"] == ["alice"]
        ws.send_json({"type": "message", "content": "How do I fix this bug?", "ask_ai": True})

        msg = receive_until(ws, "message")["message"]
        assert msg["author"] == "alice" and msg["intent"] == "debug"

        start = receive_until(ws, "ai_start")
        delta = receive_until(ws, "ai_delta")
        assert delta["stream_id"] == start["stream_id"] and delta["text"]
        done = receive_until(ws, "ai_done")["message"]
        assert done["role"] == "assistant" and done["model"] == "offline-assistant"
        assert done["latency_ms"] is not None

    history = client.get("/api/workspaces/1/messages", headers=auth).json()
    assert [m["role"] for m in history] == ["user", "assistant"]
    stats = client.get("/api/stats").json()
    assert stats["messages"] == 1 and stats["ai_replies"] == 1
    assert stats["intents"] == {"debug": 1}


def test_messages_broadcast_to_other_members(client, token):
    other = register(client, "bob")
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as alice, client.websocket_connect(
        f"/ws/workspaces/1?token={other}"
    ) as bob:
        assert receive_until(alice, "presence")["users"] in (["alice"], ["alice", "bob"])
        bob.send_json({"type": "typing"})
        assert receive_until(alice, "typing")["user"] == "bob"
        bob.send_json({"type": "message", "content": "team update", "ask_ai": False})
        assert receive_until(alice, "message")["message"]["content"] == "team update"


def test_invalid_message_returns_error(client, token):
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        ws.send_json({"type": "message", "content": "   "})
        assert receive_until(ws, "error")["detail"].startswith("Messages must be")
