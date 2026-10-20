"""Real-time chat over WebSockets.

Client -> server events:
    {"type": "message", "content": "...", "ask_ai": true, "code": {"file": "main.py", "content": "..."}}
    {"type": "typing"}
    {"type": "doc_join", "file_id": 1}                       -> replies with doc_state
    {"type": "doc_update", "file_id": 1, "update": "<base64 Yjs update>"}
    {"type": "awareness", "file_id": 1, "update": "<base64 awareness update>"}
    {"type": "regenerate"}                                   -> replaces the last AI reply

Server -> client events:
    presence, message, typing, ai_start, ai_delta, ai_done, ai_quota, cleared, error,
    message_deleted, doc_state, doc_update, awareness, file_created, file_renamed, file_deleted,
    workspace_updated, workspace_deleted, members_updated
"""

import asyncio
import base64
import binascii
import json
import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from .. import database
from ..ai import HistoryItem, assistant, detect_intent
from ..collab import store
from ..config import settings
from ..models import CodeFile, Message, Workspace
from ..ratelimit import SlidingWindowLimiter
from ..realtime import manager
from ..schemas import MessageOut
from ..security import user_from_token
from .workspaces import can_access, message_out

router = APIRouter(tags=["realtime"])
logger = logging.getLogger("codetogether.chat")

MAX_MESSAGE_LENGTH = 4000
MAX_CODE_LENGTH = 12000
FENCE_LANGUAGES = {
    "py": "python", "js": "javascript", "jsx": "jsx", "ts": "typescript", "tsx": "tsx",
    "html": "html", "css": "css", "json": "json", "md": "markdown", "sql": "sql",
}


def with_code(content: str, code: dict) -> str:
    """Append an attached code snippet to a chat message as a fenced block."""
    snippet = str(code.get("content", ""))[:MAX_CODE_LENGTH].rstrip()
    if not snippet:
        return content
    name = str(code.get("file", "snippet"))[:64]
    lang = FENCE_LANGUAGES.get(name.rsplit(".", 1)[-1].lower(), "")
    return f"{content}\n\n`{name}`\n```{lang}\n{snippet}\n```"


def file_in_workspace(file_id, workspace_id: int) -> bool:
    if not isinstance(file_id, int):
        return False
    with Session(database.engine) as session:
        file = session.get(CodeFile, file_id)
        return bool(file and file.workspace_id == workspace_id)


def decode(data: str) -> bytes | None:
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, TypeError, ValueError):
        return None
ai_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
background_tasks: set[asyncio.Task] = set()
ai_limiter = SlidingWindowLimiter(settings.ai_requests_per_hour)


def quota_event(user_id: int) -> dict:
    status = ai_limiter.status(user_id)
    # The offline assistant is free and local, so it is never limited.
    if assistant.mode == "offline":
        status = {**status, "enabled": False}
    return {"type": "ai_quota", **status}


async def use_ai(websocket: WebSocket, user_id: int) -> bool:
    """Count one AI request against the user's hourly quota. Tells the user when it is used up."""
    if assistant.mode != "offline" and not ai_limiter.hit(user_id):
        minutes = max(1, round(ai_limiter.status(user_id)["reset_seconds"] / 60))
        await websocket.send_json({
            "type": "error",
            "code": "ai_limit",
            "detail": f"AI limit reached ({ai_limiter.limit} replies per hour). Try again in about {minutes} min.",
        })
        return False
    await websocket.send_json(quota_event(user_id))
    return True


def start_ai_reply(workspace_id: int, intent: str) -> None:
    task = asyncio.create_task(run_ai_reply(workspace_id, intent))
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)


def pop_last_ai_reply(workspace_id: int) -> tuple[int, str] | None:
    """Delete the newest message if it is an AI reply; return (its id, the intent to reuse)."""
    with Session(database.engine) as session:
        last = session.exec(
            select(Message).where(Message.workspace_id == workspace_id).order_by(Message.id.desc())
        ).first()
        if not last or last.role != "assistant":
            return None
        intent, message_id = last.intent, last.id
        session.delete(last)
        session.commit()
    return message_id, intent


def load_history(workspace_id: int) -> list[HistoryItem]:
    with Session(database.engine) as session:
        rows = session.exec(
            select(Message)
            .where(Message.workspace_id == workspace_id)
            .order_by(Message.id.desc())
            .limit(settings.ai_history_messages)
        ).all()
        out = message_out(session, list(reversed(rows)))
    return [HistoryItem(role=m.role, author=m.author, content=m.content) for m in out]


async def run_ai_reply(workspace_id: int, intent: str) -> None:
    stream_id = uuid.uuid4().hex
    async with ai_locks[workspace_id]:
        await manager.broadcast(workspace_id, {"type": "ai_start", "stream_id": stream_id})
        started = time.perf_counter()
        parts: list[str] = []
        try:
            async for chunk in assistant.stream_reply(load_history(workspace_id)):
                parts.append(chunk)
                await manager.broadcast(workspace_id, {"type": "ai_delta", "stream_id": stream_id, "text": chunk})
        except Exception:  # never leave the room with a stuck "AI is typing" state
            logger.exception("AI reply failed")
            parts.append("\n\n_Something went wrong while generating this reply._")

        latency_ms = round((time.perf_counter() - started) * 1000)
        with Session(database.engine) as session:
            msg = Message(
                workspace_id=workspace_id,
                role="assistant",
                content="".join(parts).strip() or "_No reply._",
                intent=intent,
                model=assistant.model,
                latency_ms=latency_ms,
            )
            session.add(msg)
            session.commit()
            session.refresh(msg)
            payload = MessageOut.of(msg, "AI").model_dump(mode="json")
        await manager.broadcast(workspace_id, {"type": "ai_done", "stream_id": stream_id, "message": payload})


@router.websocket("/ws/workspaces/{workspace_id}")
async def workspace_socket(websocket: WebSocket, workspace_id: int, token: str = "") -> None:
    with Session(database.engine) as session:
        user = user_from_token(token, session)
        workspace = session.get(Workspace, workspace_id)
        username = user.username if user else None
        user_id = user.id if user else None
        allowed = bool(user and workspace and can_access(session, workspace, user.id))
    if not user:
        await websocket.close(code=4401, reason="Not authenticated")
        return
    if not allowed:
        await websocket.close(code=4404, reason="Workspace not found")
        return

    await manager.connect(workspace_id, websocket, username)
    await websocket.send_json(quota_event(user_id))
    try:
        while True:
            try:
                data = json.loads(await websocket.receive_text())
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "detail": "Invalid JSON"})
                continue

            kind = data.get("type")
            if kind == "typing":
                await manager.broadcast(workspace_id, {"type": "typing", "user": username}, exclude=websocket)
            elif kind == "doc_join":
                file_id = data.get("file_id")
                if not file_in_workspace(file_id, workspace_id):
                    await websocket.send_json({"type": "error", "detail": "File not found"})
                    continue
                state = store.state(file_id)
                await websocket.send_json(
                    {"type": "doc_state", "file_id": file_id, "update": base64.b64encode(state).decode()}
                )
            elif kind in ("doc_update", "awareness"):
                file_id = data.get("file_id")
                update = decode(data.get("update", ""))
                if update is None or not file_in_workspace(file_id, workspace_id):
                    await websocket.send_json({"type": "error", "detail": "Invalid document update"})
                    continue
                if kind == "doc_update" and not store.apply(file_id, update):
                    await websocket.send_json({"type": "error", "detail": "Update rejected"})
                    continue
                await manager.broadcast(
                    workspace_id,
                    {"type": kind, "file_id": file_id, "update": data["update"], "user": username},
                    exclude=websocket,
                )
            elif kind == "message":
                content = str(data.get("content", "")).strip()
                if not content or len(content) > MAX_MESSAGE_LENGTH:
                    await websocket.send_json(
                        {"type": "error", "detail": f"Messages must be 1-{MAX_MESSAGE_LENGTH} characters"}
                    )
                    continue
                intent = detect_intent(content)
                if isinstance(data.get("code"), dict):
                    content = with_code(content, data["code"])
                with Session(database.engine) as session:
                    msg = Message(
                        workspace_id=workspace_id, user_id=user_id, role="user", content=content, intent=intent
                    )
                    session.add(msg)
                    session.commit()
                    session.refresh(msg)
                    payload = MessageOut.of(msg, username).model_dump(mode="json")
                logger.info("[%s] %s: %s", workspace_id, username, content)
                await manager.broadcast(workspace_id, {"type": "message", "message": payload})
                if data.get("ask_ai", True) and await use_ai(websocket, user_id):
                    start_ai_reply(workspace_id, intent)
            elif kind == "regenerate":
                if ai_locks[workspace_id].locked():
                    await websocket.send_json({"type": "error", "detail": "The AI is still replying. Wait for it to finish."})
                    continue
                last = pop_last_ai_reply(workspace_id)
                if last is None:
                    await websocket.send_json({"type": "error", "detail": "The latest message is not an AI reply."})
                    continue
                message_id, intent = last
                await manager.broadcast(workspace_id, {"type": "message_deleted", "id": message_id, "by": username})
                if await use_ai(websocket, user_id):
                    start_ai_reply(workspace_id, intent)
            else:
                await websocket.send_json({"type": "error", "detail": f"Unknown event type: {kind}"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(workspace_id, websocket)
