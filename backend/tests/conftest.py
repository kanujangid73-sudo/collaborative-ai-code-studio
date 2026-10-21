import os

# Configure before the app is imported: throwaway database, offline AI.
# Set TEST_DATABASE_URL to run the suite against Postgres; its tables are dropped between tests.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL or "sqlite://"
os.environ["AI_ENABLED"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-at-least-32-bytes"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from app import database
from app.collab import store
from app.routers.auth import demo_limiter

if TEST_DATABASE_URL:
    test_engine = database.engine
else:
    # One shared in-memory database for the whole app during tests.
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    database.engine = test_engine

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    SQLModel.metadata.drop_all(test_engine)
    with test_engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS alembic_version"))  # so startup migrates from scratch
    store.docs.clear()  # the in-memory document cache must not outlive the test database
    store.dirty.clear()
    demo_limiter.hits.clear()
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
