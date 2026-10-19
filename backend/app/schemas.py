from datetime import datetime

from pydantic import BaseModel, Field

from .models import Message, User, Workspace


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    created_at: datetime

    @classmethod
    def of(cls, user: User) -> "UserOut":
        return cls(id=user.id, username=user.username, created_at=user.created_at)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=200)


class WorkspaceOut(BaseModel):
    id: int
    name: str
    description: str
    owner_id: int | None
    message_count: int = 0
    created_at: datetime

    @classmethod
    def of(cls, ws: Workspace, message_count: int = 0) -> "WorkspaceOut":
        return cls(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            owner_id=ws.owner_id,
            message_count=message_count,
            created_at=ws.created_at,
        )


class MessageOut(BaseModel):
    id: int
    workspace_id: int
    role: str
    author: str
    content: str
    intent: str
    model: str | None
    latency_ms: int | None
    created_at: datetime

    @classmethod
    def of(cls, msg: Message, author: str) -> "MessageOut":
        return cls(
            id=msg.id,
            workspace_id=msg.workspace_id,
            role=msg.role,
            author=author,
            content=msg.content,
            intent=msg.intent,
            model=msg.model,
            latency_ms=msg.latency_ms,
            created_at=msg.created_at,
        )


class LatencyPoint(BaseModel):
    id: int
    ms: int
    created_at: str


class StatsOut(BaseModel):
    users: int
    workspaces: int
    messages: int
    ai_replies: int
    avg_ai_latency_ms: int | None
    online_users: int
    uptime_seconds: int
    started_at: str
    ai_mode: str
    ai_model: str
    intents: dict[str, int]
    recent_latencies: list[LatencyPoint]
