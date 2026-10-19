import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlmodel import Session, func, select

from ..ai import assistant
from ..database import get_session
from ..models import Message, User, Workspace
from ..realtime import manager
from ..schemas import LatencyPoint, StatsOut

router = APIRouter(prefix="/api", tags=["monitoring"])
STARTED_AT = time.time()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "ai_mode": assistant.mode}


@router.get("/stats", response_model=StatsOut)
def stats(session: Session = Depends(get_session)) -> StatsOut:
    count = lambda stmt: session.exec(stmt).one()  # noqa: E731
    ai_filter = Message.role == "assistant"

    intents = dict(
        session.exec(
            select(Message.intent, func.count()).where(Message.role == "user").group_by(Message.intent)
        ).all()
    )
    avg = session.exec(select(func.avg(Message.latency_ms)).where(ai_filter)).one()
    recent = session.exec(
        select(Message).where(ai_filter, Message.latency_ms.is_not(None)).order_by(Message.id.desc()).limit(24)
    ).all()

    return StatsOut(
        users=count(select(func.count()).select_from(User)),
        workspaces=count(select(func.count()).select_from(Workspace)),
        messages=count(select(func.count()).select_from(Message).where(Message.role == "user")),
        ai_replies=count(select(func.count()).select_from(Message).where(ai_filter)),
        avg_ai_latency_ms=round(avg) if avg is not None else None,
        online_users=manager.online_total(),
        uptime_seconds=int(time.time() - STARTED_AT),
        started_at=datetime.fromtimestamp(STARTED_AT, timezone.utc).isoformat(),
        ai_mode=assistant.mode,
        ai_model=assistant.model,
        intents=intents,
        recent_latencies=[
            LatencyPoint(id=m.id, ms=m.latency_ms, created_at=m.created_at.isoformat())
            for m in reversed(recent)
        ],
    )
