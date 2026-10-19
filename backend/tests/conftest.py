import os

# Configure before the app is imported: throwaway database, offline AI.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["AI_ENABLED"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-bytes"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app import database
from app.routers import chat

# One shared in-memory database for the whole app during tests.
test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
database.engine = test_engine
chat.engine = test_engine

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    SQLModel.metadata.drop_all(test_engine)
    with TestClient(app) as c:
        yield c


def register(client, username="alice", password="secret123"):
    res = client.post("/api/auth/register", json={"username": username, "password": password})
    assert res.status_code == 201, res.text
    return res.json()["access_token"]


@pytest.fixture()
def token(client):
    return register(client)


@pytest.fixture()
def auth(token):
    return {"Authorization": f"Bearer {token}"}
