from .conftest import register


def test_default_workspace_exists(client, auth):
    res = client.get("/api/workspaces", headers=auth)
    assert res.status_code == 200
    assert [w["name"] for w in res.json()] == ["General"]


def test_create_workspace(client, auth):
    res = client.post("/api/workspaces", json={"name": "  Backend team ", "description": "API work"}, headers=auth)
    assert res.status_code == 201
    assert res.json()["name"] == "Backend team"
    names = [w["name"] for w in client.get("/api/workspaces", headers=auth).json()]
    assert names == ["General", "Backend team"]


def test_messages_of_missing_workspace_404(client, auth):
    assert client.get("/api/workspaces/999/messages", headers=auth).status_code == 404


def test_only_owner_can_clear_history(client, auth):
    ws = client.post("/api/workspaces", json={"name": "Private"}, headers=auth).json()
    other = {"Authorization": f"Bearer {register(client, 'mallory')}"}
    assert client.delete(f"/api/workspaces/{ws['id']}/messages", headers=other).status_code == 403
    assert client.delete(f"/api/workspaces/{ws['id']}/messages", headers=auth).json() == {"cleared": 0}


def test_health_and_stats(client):
    assert client.get("/api/health").json() == {"status": "ok", "ai_mode": "offline"}
    stats = client.get("/api/stats").json()
    assert stats["ai_mode"] == "offline"
    assert stats["workspaces"] == 1
    assert stats["messages"] == 0
