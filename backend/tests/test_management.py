import pytest
from starlette.websockets import WebSocketDisconnect

from app.ai import Assistant, assistant
from app.ratelimit import SlidingWindowLimiter
from app.routers import chat

from .conftest import register
from .test_chat import receive_until


def hdr(token):
    return {"Authorization": f"Bearer {token}"}


def names(client, token):
    return [w["name"] for w in client.get("/api/workspaces", headers=hdr(token)).json()]


@pytest.fixture()
def private_ws(client, token):
    res = client.post("/api/workspaces", json={"name": "Secret", "is_private": True}, headers=hdr(token))
    assert res.status_code == 201 and res.json()["is_private"] and res.json()["role"] == "owner"
    return res.json()["id"]


def test_private_workspace_is_hidden_from_non_members(client, token, private_ws):
    bob = register(client, "bob")
    assert "Secret" in names(client, token)
    assert names(client, bob) == ["General"]
    for path in ("messages", "files", "members"):
        assert client.get(f"/api/workspaces/{private_ws}/{path}", headers=hdr(bob)).status_code == 404
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/workspaces/{private_ws}?token={bob}") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_invite_and_remove_member(client, token, private_ws):
    bob = register(client, "bob")
    added = client.post(f"/api/workspaces/{private_ws}/members", json={"username": "BOB"}, headers=hdr(token))
    assert added.status_code == 201 and added.json()["username"] == "bob"
    assert client.post(f"/api/workspaces/{private_ws}/members", json={"username": "bob"}, headers=hdr(token)).status_code == 409
    assert client.post(f"/api/workspaces/{private_ws}/members", json={"username": "ghost"}, headers=hdr(token)).status_code == 404

    assert "Secret" in names(client, bob)
    members = client.get(f"/api/workspaces/{private_ws}/members", headers=hdr(bob)).json()
    assert [(m["username"], m["role"]) for m in members] == [("alice", "owner"), ("bob", "member")]
    # Members can't invite others.
    register(client, "carol")
    assert client.post(f"/api/workspaces/{private_ws}/members", json={"username": "carol"}, headers=hdr(bob)).status_code == 403

    bob_id = added.json()["user_id"]
    with client.websocket_connect(f"/ws/workspaces/{private_ws}?token={bob}") as ws:
        receive_until(ws, "presence")
        assert client.delete(f"/api/workspaces/{private_ws}/members/{bob_id}", headers=hdr(token)).status_code == 200
        with pytest.raises(WebSocketDisconnect) as exc:
            while True:
                ws.receive_json()
        assert exc.value.code == 4403  # removed members are disconnected right away
    assert "Secret" not in names(client, bob)


def test_member_can_leave(client, token, private_ws):
    bob = register(client, "bob")
    bob_id = client.post(f"/api/workspaces/{private_ws}/members", json={"username": "bob"}, headers=hdr(token)).json()["user_id"]
    assert client.delete(f"/api/workspaces/{private_ws}/members/{bob_id}", headers=hdr(bob)).status_code == 200
    assert "Secret" not in names(client, bob)


def test_owner_updates_and_deletes_workspace(client, token, auth):
    ws = client.post("/api/workspaces", json={"name": "Team"}, headers=auth).json()
    bob = register(client, "bob")
    assert client.patch(f"/api/workspaces/{ws['id']}", json={"name": "Hacked"}, headers=hdr(bob)).status_code == 403
    updated = client.patch(f"/api/workspaces/{ws['id']}", json={"name": "Core team", "description": "API"}, headers=auth)
    assert updated.json()["name"] == "Core team" and updated.json()["description"] == "API"
    # The shared General workspace has no owner, so nobody can rename or delete it.
    assert client.patch("/api/workspaces/1", json={"name": "Mine"}, headers=auth).status_code == 403
    assert client.delete("/api/workspaces/1", headers=auth).status_code == 403

    assert client.delete(f"/api/workspaces/{ws['id']}", headers=hdr(bob)).status_code == 403
    assert client.delete(f"/api/workspaces/{ws['id']}", headers=auth).json() == {"deleted": ws["id"]}
    assert client.get(f"/api/workspaces/{ws['id']}/files", headers=auth).status_code == 404
    assert names(client, bob) == ["General"]


def test_making_workspace_private_kicks_non_members(client, token, auth):
    ws_id = client.post("/api/workspaces", json={"name": "Open"}, headers=auth).json()["id"]
    bob = register(client, "bob")
    with client.websocket_connect(f"/ws/workspaces/{ws_id}?token={bob}") as ws:
        receive_until(ws, "presence")
        client.patch(f"/api/workspaces/{ws_id}", json={"is_private": True}, headers=auth)
        with pytest.raises(WebSocketDisconnect) as exc:
            while True:
                ws.receive_json()
        assert exc.value.code == 4403


def send_and_wait(ws, content, ask_ai=False):
    ws.send_json({"type": "message", "content": content, "ask_ai": ask_ai})
    return receive_until(ws, "message")["message"]


def test_delete_messages(client, token, auth):
    bob = register(client, "bob")
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as alice_ws, client.websocket_connect(
        f"/ws/workspaces/1?token={bob}"
    ) as bob_ws:
        mine = send_and_wait(alice_ws, "from alice")
        receive_until(bob_ws, "message")
        theirs = send_and_wait(bob_ws, "from bob")

        assert client.delete(f"/api/workspaces/1/messages/{theirs['id']}", headers=auth).status_code == 403
        assert client.delete(f"/api/workspaces/1/messages/{mine['id']}", headers=hdr(bob)).status_code == 403
        assert client.delete(f"/api/workspaces/1/messages/{mine['id']}", headers=auth).status_code == 200
        assert receive_until(bob_ws, "message_deleted")["id"] == mine["id"]
    remaining = [m["content"] for m in client.get("/api/workspaces/1/messages", headers=auth).json()]
    assert remaining == ["from bob"]


def test_owner_can_moderate_their_workspace(client, token, auth):
    ws_id = client.post("/api/workspaces", json={"name": "Mod"}, headers=auth).json()["id"]
    bob = register(client, "bob")
    with client.websocket_connect(f"/ws/workspaces/{ws_id}?token={bob}") as ws:
        msg = send_and_wait(ws, "spam")
    assert client.delete(f"/api/workspaces/{ws_id}/messages/{msg['id']}", headers=auth).status_code == 200


def test_regenerate_replaces_last_ai_reply(client, token, auth):
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        send_and_wait(ws, "fix my bug", ask_ai=True)
        first = receive_until(ws, "ai_done")["message"]
        ws.send_json({"type": "regenerate"})
        assert receive_until(ws, "message_deleted")["id"] == first["id"]
        second = receive_until(ws, "ai_done")["message"]
        assert second["id"] != first["id"] and second["intent"] == "debug"

        send_and_wait(ws, "plain note")
        ws.send_json({"type": "regenerate"})
        assert receive_until(ws, "error")["detail"] == "The latest message is not an AI reply."
    roles = [m["role"] for m in client.get("/api/workspaces/1/messages", headers=auth).json()]
    assert roles == ["user", "assistant", "user"]


def test_sliding_window_limiter():
    limiter = SlidingWindowLimiter(2, window_seconds=60)
    assert limiter.hit("u") and limiter.hit("u") and not limiter.hit("u")
    assert limiter.status("u")["remaining"] == 0 and limiter.status("other")["remaining"] == 2
    assert SlidingWindowLimiter(0).hit("u")  # 0 means unlimited


def test_ai_limit_blocks_extra_requests(client, token, monkeypatch):
    monkeypatch.setattr(chat, "ai_limiter", SlidingWindowLimiter(1))
    # Pretend a real (limited) provider is active, but answer with the offline assistant.
    monkeypatch.setattr(Assistant, "mode", property(lambda self: "gemini"))
    monkeypatch.setattr(assistant, "_gemini_with_fallback", assistant._offline)
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        assert receive_until(ws, "ai_quota")["remaining"] == 1
        send_and_wait(ws, "first question", ask_ai=True)
        assert receive_until(ws, "ai_quota")["remaining"] == 0
        receive_until(ws, "ai_done")

        send_and_wait(ws, "second question", ask_ai=True)  # the message itself still posts
        error = receive_until(ws, "error")
        assert error["code"] == "ai_limit" and "1 replies per hour" in error["detail"]
