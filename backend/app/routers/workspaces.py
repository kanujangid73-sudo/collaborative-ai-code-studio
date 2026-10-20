from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, delete, func, or_, select

from ..collab import starter_file, store
from ..database import get_session
from ..models import CodeFile, Message, User, Workspace, WorkspaceMember
from ..realtime import manager
from ..schemas import MemberIn, MemberOut, MessageOut, WorkspaceIn, WorkspaceOut, WorkspaceUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


# ---------- access helpers (also used by the files router and the WebSocket) ----------


def get_workspace(workspace_id: int, session: Session) -> Workspace:
    workspace = session.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return workspace


def role_in(session: Session, workspace: Workspace, user_id: int) -> str | None:
    if workspace.owner_id == user_id:
        return "owner"
    if session.get(WorkspaceMember, (workspace.id, user_id)):
        return "member"
    return None


def can_access(session: Session, workspace: Workspace, user_id: int) -> bool:
    return not workspace.is_private or role_in(session, workspace, user_id) is not None


def require_access(workspace_id: int, session: Session, user: User) -> Workspace:
    workspace = get_workspace(workspace_id, session)
    if not can_access(session, workspace, user.id):
        # 404 rather than 403, so private workspaces don't reveal that they exist.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
    return workspace


def require_owner(workspace_id: int, session: Session, user: User) -> Workspace:
    workspace = require_access(workspace_id, session, user)
    if workspace.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the workspace owner can do that")
    return workspace


def message_out(session: Session, messages: list[Message]) -> list[MessageOut]:
    user_ids = {m.user_id for m in messages if m.user_id}
    names = {u.id: u.username for u in session.exec(select(User).where(User.id.in_(user_ids)))} if user_ids else {}
    return [MessageOut.of(m, "AI" if m.role == "assistant" else names.get(m.user_id, "unknown")) for m in messages]


# ---------- workspaces ----------


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(session: Session = Depends(get_session), user: User = Depends(get_current_user)) -> list[WorkspaceOut]:
    member_of = set(session.exec(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)).all())
    visible = session.exec(
        select(Workspace)
        .where(or_(Workspace.is_private == False, Workspace.owner_id == user.id, Workspace.id.in_(member_of)))  # noqa: E712
        .order_by(Workspace.id)
    ).all()
    counts = dict(session.exec(select(Message.workspace_id, func.count()).group_by(Message.workspace_id)).all())

    def role(ws: Workspace) -> str | None:
        return "owner" if ws.owner_id == user.id else "member" if ws.id in member_of else None

    return [WorkspaceOut.of(ws, counts.get(ws.id, 0), role(ws)) for ws in visible]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: WorkspaceIn, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> WorkspaceOut:
    workspace = Workspace(
        name=data.name.strip(), description=data.description.strip(), owner_id=user.id, is_private=data.is_private
    )
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    session.add(starter_file(workspace.id, user.id))
    session.commit()
    return WorkspaceOut.of(workspace, role="owner")


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
async def update_workspace(
    workspace_id: int,
    data: WorkspaceUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> WorkspaceOut:
    workspace = require_owner(workspace_id, session, user)
    if data.name is not None:
        workspace.name = data.name.strip()
    if data.description is not None:
        workspace.description = data.description.strip()
    if data.is_private is not None:
        workspace.is_private = data.is_private
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    await manager.broadcast(workspace_id, {"type": "workspace_updated", "by": user.username})
    if workspace.is_private:
        # People who were browsing a now-private workspace without being members lose access.
        allowed = {u.username for u in session.exec(select(User).join(
            WorkspaceMember, WorkspaceMember.user_id == User.id).where(WorkspaceMember.workspace_id == workspace_id))}
        allowed.add(user.username)
        for name in set(manager.online(workspace_id)) - allowed:
            await manager.kick(workspace_id, name)
    return WorkspaceOut.of(workspace, role="owner")


@router.delete("/{workspace_id}")
async def delete_workspace(
    workspace_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> dict[str, int]:
    require_owner(workspace_id, session, user)
    for file_id in session.exec(select(CodeFile.id).where(CodeFile.workspace_id == workspace_id)).all():
        store.forget(file_id)
    for model in (Message, CodeFile, WorkspaceMember):
        session.exec(delete(model).where(model.workspace_id == workspace_id))
    session.exec(delete(Workspace).where(Workspace.id == workspace_id))
    session.commit()
    await manager.broadcast(workspace_id, {"type": "workspace_deleted", "by": user.username})
    await manager.close_room(workspace_id)
    return {"deleted": workspace_id}


# ---------- members ----------


@router.get("/{workspace_id}/members", response_model=list[MemberOut])
def list_members(
    workspace_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> list[MemberOut]:
    workspace = require_access(workspace_id, session, user)
    out = []
    if workspace.owner_id and (owner := session.get(User, workspace.owner_id)):
        out.append(MemberOut(user_id=owner.id, username=owner.username, role="owner"))
    members = session.exec(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id).order_by(User.username)
    ).all()
    out += [MemberOut(user_id=m.id, username=m.username, role="member") for m in members]
    return out


@router.post("/{workspace_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    workspace_id: int,
    data: MemberIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MemberOut:
    workspace = require_owner(workspace_id, session, user)
    invitee = session.exec(select(User).where(func.lower(User.username) == data.username.strip().lower())).first()
    if not invitee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No user named {data.username}")
    if role_in(session, workspace, invitee.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{invitee.username} is already in this workspace")
    session.add(WorkspaceMember(workspace_id=workspace_id, user_id=invitee.id))
    session.commit()
    await manager.broadcast(workspace_id, {"type": "members_updated", "by": user.username})
    return MemberOut(user_id=invitee.id, username=invitee.username, role="member")


@router.delete("/{workspace_id}/members/{member_id}")
async def remove_member(
    workspace_id: int,
    member_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    workspace = require_access(workspace_id, session, user)
    if user.id not in (workspace.owner_id, member_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can remove other members")
    membership = session.get(WorkspaceMember, (workspace_id, member_id))
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a member of this workspace")
    removed = session.get(User, member_id)
    session.delete(membership)
    session.commit()
    await manager.broadcast(workspace_id, {"type": "members_updated", "by": user.username})
    if workspace.is_private and removed:
        await manager.kick(workspace_id, removed.username)
    return {"removed": member_id}


# ---------- messages ----------


@router.get("/{workspace_id}/messages", response_model=list[MessageOut])
def list_messages(
    workspace_id: int,
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[MessageOut]:
    require_access(workspace_id, session, user)
    rows = session.exec(
        select(Message).where(Message.workspace_id == workspace_id).order_by(Message.id.desc()).limit(limit)
    ).all()
    return message_out(session, list(reversed(rows)))


@router.delete("/{workspace_id}/messages")
async def clear_messages(
    workspace_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> dict[str, int]:
    workspace = require_access(workspace_id, session, user)
    if workspace.owner_id not in (None, user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the workspace owner can clear its history")
    result = session.exec(delete(Message).where(Message.workspace_id == workspace_id))
    session.commit()
    await manager.broadcast(workspace_id, {"type": "cleared", "by": user.username})
    return {"cleared": result.rowcount}


@router.delete("/{workspace_id}/messages/{message_id}")
async def delete_message(
    workspace_id: int,
    message_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    workspace = require_access(workspace_id, session, user)
    msg = session.get(Message, message_id)
    if not msg or msg.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    # Authors delete their own messages; the owner can moderate everything, including AI replies.
    if msg.user_id != user.id and workspace.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own messages")
    session.delete(msg)
    session.commit()
    await manager.broadcast(workspace_id, {"type": "message_deleted", "id": message_id, "by": user.username})
    return {"deleted": message_id}
