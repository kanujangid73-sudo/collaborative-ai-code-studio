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
    is_private: bool = False  # private workspaces are visible to the owner and invited members only
    created_at: datetime = Field(default_factory=utcnow)


class WorkspaceMember(SQLModel, table=True):
    """Users invited to a workspace. The owner is tracked on Workspace.owner_id."""

    workspace_id: int = Field(foreign_key="workspace.id", primary_key=True)
    user_id: int = Field(foreign_key="user.id", primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    # Never reuse ids of deleted messages, so clients can't confuse a regenerated reply with the old one.
    __table_args__ = {"sqlite_autoincrement": True}

    id: int | None = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    user_id: int | None = Field(default=None, foreign_key="user.id")  # None for AI replies
    role: str = Field(max_length=16)  # "user" or "assistant"
    content: str
    intent: str = Field(default="general", max_length=16)
    model: str | None = Field(default=None, max_length=64)
    latency_ms: int | None = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


class CodeFile(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    workspace_id: int = Field(foreign_key="workspace.id", index=True)
    name: str = Field(max_length=64)
    # Yjs document state (CRDT), so concurrent edits merge without conflicts.
    ydoc: bytes = b""
    created_by: int | None = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
