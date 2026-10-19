from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, delete, func, select

from ..database import get_session
from ..models import Message, User, Workspace
from ..realtime import manager
from ..schemas import MessageOut, WorkspaceIn, WorkspaceOut
from ..security import get_current_user

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def get_workspace(workspace_id: int, session: Session) -> Workspace:
    workspace = session.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return workspace


def message_out(session: Session, messages: list[Message]) -> list[MessageOut]:
    user_ids = {m.user_id for m in messages if m.user_id}
    names = {u.id: u.username for u in session.exec(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    return [MessageOut.of(m, "AI" if m.role == "assistant" else names.get(m.user_id, "unknown")) for m in messages]


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(
    session: Session = Depends(get_session), _: User = Depends(get_current_user)
) -> list[WorkspaceOut]:
    counts = dict(session.exec(select(Message.workspace_id, func.count()).group_by(Message.workspace_id)).all())
    workspaces = session.exec(select(Workspace).order_by(Workspace.id)).all()
    return [WorkspaceOut.of(ws, counts.get(ws.id, 0)) for ws in workspaces]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: WorkspaceIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> WorkspaceOut:
    workspace = Workspace(name=data.name.strip(), description=data.description.strip(), owner_id=user.id)
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return WorkspaceOut.of(workspace)


@router.get("/{workspace_id}/messages", response_model=list[MessageOut])
def list_messages(
    workspace_id: int,
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
) -> list[MessageOut]:
    get_workspace(workspace_id, session)
    rows = session.exec(
        select(Message).where(Message.workspace_id == workspace_id).order_by(Message.id.desc()).limit(limit)
    ).all()
    return message_out(session, list(reversed(rows)))


@router.delete("/{workspace_id}/messages")
async def clear_messages(
    workspace_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> dict[str, int]:
    workspace = get_workspace(workspace_id, session)
    if workspace.owner_id not in (None, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the workspace owner can clear its history")
    result = session.exec(delete(Message).where(Message.workspace_id == workspace_id))
    session.commit()
    await manager.broadcast(workspace_id, {"type": "cleared", "by": user.username})
    return {"cleared": result.rowcount}
