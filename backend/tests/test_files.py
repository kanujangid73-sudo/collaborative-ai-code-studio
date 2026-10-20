import base64

from pycrdt import Doc, Text

from app.collab import TEXT_KEY, store

from .conftest import register
from .test_chat import receive_until


def text_of(state_b64: str) -> str:
    doc = Doc()
    doc[TEXT_KEY] = text = Text()
    doc.apply_update(base64.b64decode(state_b64))
    return str(text)


def edit(state_b64: str, insert_at: int, value: str) -> str:
    """Simulate a browser: load the server state, type, and return the base64 update."""
    doc = Doc()
    doc[TEXT_KEY] = text = Text()
    doc.apply_update(base64.b64decode(state_b64))
    before = doc.get_state()
    text.insert(insert_at, value)
    return base64.b64encode(doc.get_update(before)).decode()


def test_workspaces_start_with_main_py(client, auth):
    assert [f["name"] for f in client.get("/api/workspaces/1/files", headers=auth).json()] == ["main.py"]
    ws = client.post("/api/workspaces", json={"name": "Team"}, headers=auth).json()
    assert [f["name"] for f in client.get(f"/api/workspaces/{ws['id']}/files", headers=auth).json()] == ["main.py"]


def test_create_rename_delete_file(client, auth):
    created = client.post("/api/workspaces/1/files", json={"name": "utils.js"}, headers=auth)
    assert created.status_code == 201
    file_id = created.json()["id"]
    assert client.post("/api/workspaces/1/files", json={"name": "utils.js"}, headers=auth).status_code == 409
    assert client.post("/api/workspaces/1/files", json={"name": "../evil"}, headers=auth).status_code == 422
    renamed = client.patch(f"/api/workspaces/1/files/{file_id}", json={"name": "helpers.js"}, headers=auth)
    assert renamed.json()["name"] == "helpers.js"
    assert client.delete(f"/api/workspaces/1/files/{file_id}", headers=auth).json() == {"deleted": file_id}
    assert [f["name"] for f in client.get("/api/workspaces/1/files", headers=auth).json()] == ["main.py"]


def test_only_creator_or_owner_can_delete(client, auth):
    file_id = client.post("/api/workspaces/1/files", json={"name": "mine.py"}, headers=auth).json()["id"]
    other = {"Authorization": f"Bearer {register(client, 'mallory')}"}
    assert client.delete(f"/api/workspaces/1/files/{file_id}", headers=other).status_code == 403


def test_live_editing_syncs_and_persists(client, token):
    other = register(client, "bob")
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as alice, client.websocket_connect(
        f"/ws/workspaces/1?token={other}"
    ) as bob:
        alice.send_json({"type": "doc_join", "file_id": 1})
        state = receive_until(alice, "doc_state")["update"]
        assert text_of(state).startswith("# Welcome to the shared editor!")

        alice.send_json({"type": "doc_update", "file_id": 1, "update": edit(state, 0, "# edited by alice\n")})
        relayed = receive_until(bob, "doc_update")
        assert relayed["user"] == "alice" and relayed["file_id"] == 1

        alice.send_json({"type": "awareness", "file_id": 1, "update": base64.b64encode(b"cursor").decode()})
        assert receive_until(bob, "awareness")["user"] == "alice"

        bob.send_json({"type": "doc_join", "file_id": 1})
        assert text_of(receive_until(bob, "doc_state")["update"]).startswith("# edited by alice\n# Welcome")

    store.flush()
    store.docs.clear()  # force a reload from the database
    assert store.text(1).startswith("# edited by alice\n")


def test_bad_document_messages_are_rejected(client, token):
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        ws.send_json({"type": "doc_join", "file_id": 999})
        assert receive_until(ws, "error")["detail"] == "File not found"
        ws.send_json({"type": "doc_update", "file_id": 1, "update": "not base64!!"})
        assert receive_until(ws, "error")["detail"] == "Invalid document update"


def test_message_with_code_attachment(client, token):
    with client.websocket_connect(f"/ws/workspaces/1?token={token}") as ws:
        ws.send_json({
            "type": "message",
            "content": "Explain this",
            "ask_ai": False,
            "code": {"file": "main.py", "content": "print('hi')"},
        })
        msg = receive_until(ws, "message")["message"]
        assert msg["content"] == "Explain this\n\n`main.py`\n```python\nprint('hi')\n```"
        assert msg["intent"] == "general"  # topic comes from the question, not the code
