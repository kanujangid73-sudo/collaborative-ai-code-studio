from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True, max_length=32)
    password_hash: str
    created_at: datetime = Field(default_factory=utcnow)


class Workspace(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(max_length=60)
    description: str = Field(default="", max_length=200)
    owner_id: int | None = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    user_id: int | None = Field(default=None, foreign_key="user.id")  # None for AI replies
    role: str = Field(max_length=16)  # "user" or "assistant"
    content: str
    intent: str = Field(default="general", max_length=16)
    model: str | None = Field(default=None, max_length=64)
    latency_ms: int | None = None
    created_at: datetime = Field(default_factory=utcnow, index=True)
