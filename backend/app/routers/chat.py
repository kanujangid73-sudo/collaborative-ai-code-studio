"""Real-time chat over WebSockets.

Client -> server events:
    {"type": "message", "content": "...", "ask_ai": true}
    {"type": "typing"}

Server -> client events:
    presence, message, typing, ai_start, ai_delta, ai_done, cleared, error
"""

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session, select

from ..ai import HistoryItem, assistant, detect_intent
from ..config import settings
from ..database import engine
from ..models import Message, Workspace
from ..realtime import manager
from ..schemas import MessageOut
from ..security import user_from_token
from .workspaces import message_out

router = APIRouter(tags=["realtime"])
logger = logging.getLogger("codetogether.chat")

MAX_MESSAGE_LENGTH = 4000
ai_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
background_tasks: set[asyncio.Task] = set()


def load_history(workspace_id: int) -> list[HistoryItem]:
    with Session(engine) as session:
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
        with Session(engine) as session:
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
    with Session(engine) as session:
        user = user_from_token(token, session)
        workspace = session.get(Workspace, workspace_id)
        username = user.username if user else None
        user_id = user.id if user else None
    if not user:
        await websocket.close(code=4401, reason="Not authenticated")
        return
    if not workspace:
        await websocket.close(code=4404, reason="Workspace not found")
        return

    await manager.connect(workspace_id, websocket, username)
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
            elif kind == "message":
                content = str(data.get("content", "")).strip()
                if not content or len(content) > MAX_MESSAGE_LENGTH:
                    await websocket.send_json(
                        {"type": "error", "detail": f"Messages must be 1-{MAX_MESSAGE_LENGTH} characters"}
                    )
                    continue
                intent = detect_intent(content)
                with Session(engine) as session:
                    msg = Message(
                        workspace_id=workspace_id, user_id=user_id, role="user", content=content, intent=intent
                    )
                    session.add(msg)
                    session.commit()
                    session.refresh(msg)
                    payload = MessageOut.of(msg, username).model_dump(mode="json")
                logger.info("[%s] %s: %s", workspace_id, username, content)
                await manager.broadcast(workspace_id, {"type": "message", "message": payload})
                if data.get("ask_ai", True):
                    task = asyncio.create_task(run_ai_reply(workspace_id, intent))
                    background_tasks.add(task)
                    task.add_done_callback(background_tasks.discard)
            else:
                await websocket.send_json({"type": "error", "detail": f"Unknown event type: {kind}"})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(workspace_id, websocket)
