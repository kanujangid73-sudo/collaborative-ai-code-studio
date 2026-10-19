from app.security import hash_password, verify_password

from .conftest import register


def test_password_hashing_roundtrip():
    stored = hash_password("hunter22")
    assert stored != "hunter22"
    assert verify_password("hunter22", stored)
    assert not verify_password("wrong", stored)


def test_register_and_me(client):
    token = register(client, "bob")
    res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["username"] == "bob"


def test_duplicate_username_is_rejected_case_insensitively(client):
    register(client, "carol")
    res = client.post("/api/auth/register", json={"username": "CAROL", "password": "secret123"})
    assert res.status_code == 409


def test_login(client):
    register(client, "dave", "secret123")
    ok = client.post("/api/auth/login", json={"username": "dave", "password": "secret123"})
    bad = client.post("/api/auth/login", json={"username": "dave", "password": "nope-nope"})
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert bad.status_code == 401


def test_invalid_input_is_rejected(client):
    res = client.post("/api/auth/register", json={"username": "a b", "password": "123"})
    assert res.status_code == 422


def test_protected_routes_require_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/workspaces").status_code == 401
    bad = client.get("/api/workspaces", headers={"Authorization": "Bearer not-a-token"})
    assert bad.status_code == 401
