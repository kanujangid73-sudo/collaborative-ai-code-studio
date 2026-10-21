from datetime import timedelta

from sqlmodel import Session, select

from app import database
from app.models import CodeFile, Message, User, Workspace, utcnow
from app.routers.auth import demo_limiter

from .conftest import register


def start_demo(client):
    res = client.post("/api/auth/demo")
    assert res.status_code == 201, res.text
    data = res.json()
    return data, {"Authorization": f"Bearer {data['access_token']}"}


def test_demo_creates_guest_with_private_sandbox(client):
    data, guest = start_demo(client)
    assert data["user"]["is_guest"] is True
    assert data["user"]["username"].startswith("guest_")
    assert client.get("/api/auth/me", headers=guest).json()["is_guest"] is True

    ws_id = data["workspace_id"]
    workspaces = {w["id"]: w for w in client.get("/api/workspaces", headers=guest).json()}
    assert workspaces[ws_id]["is_private"] and workspaces[ws_id]["role"] == "owner"
    names = [f["name"] for f in client.get(f"/api/workspaces/{ws_id}/files", headers=guest).json()]
    assert names == ["README.md", "main.py", "app.js"]


def test_each_guest_gets_their_own_workspace(client, auth):
    first, _ = start_demo(client)
    second, second_auth = start_demo(client)
    assert first["user"]["username"] != second["user"]["username"]
    assert first["workspace_id"] != second["workspace_id"]
    # Neither another guest nor a regular user can see someone else's sandbox.
    for headers in (second_auth, auth):
        visible = {w["id"] for w in client.get("/api/workspaces", headers=headers).json()}
        assert first["workspace_id"] not in visible


def test_demo_logins_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(demo_limiter, "limit", 2)
    start_demo(client)
    start_demo(client)
    res = client.post("/api/auth/demo")
    assert res.status_code == 429


def test_expired_guests_are_removed(client):
    old, _ = start_demo(client)
    fresh, fresh_auth = start_demo(client)
    with Session(database.engine) as session:
        guest = session.get(User, old["user"]["id"])
        guest.created_at = utcnow() - timedelta(hours=25)
        session.add(guest)
        # A message the old guest left in the shared General workspace.
        session.add(Message(workspace_id=1, user_id=guest.id, role="user", content="hi"))
        session.commit()

    start_demo(client)  # each demo login cleans up expired guests

    with Session(database.engine) as session:
        assert session.get(User, old["user"]["id"]) is None
        assert session.get(Workspace, old["workspace_id"]) is None
        assert not session.exec(select(CodeFile).where(CodeFile.workspace_id == old["workspace_id"])).all()
        assert not session.exec(select(Message).where(Message.user_id == old["user"]["id"])).all()
        assert session.get(User, fresh["user"]["id"]) is not None
    assert client.get("/api/auth/me", headers=fresh_auth).status_code == 200


def test_shared_general_workspace_cannot_be_wiped(client, auth):
    other = {"Authorization": f"Bearer {register(client, 'bob')}"}
    assert client.delete("/api/workspaces/1/messages", headers=other).status_code == 403
    seeded = client.get("/api/workspaces/1/files", headers=other).json()[0]
    assert client.delete(f"/api/workspaces/1/files/{seeded['id']}", headers=other).status_code == 403
