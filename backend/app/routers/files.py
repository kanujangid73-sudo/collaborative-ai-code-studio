from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from ..collab import new_state, store
from ..database import get_session
from ..models import CodeFile, User
from ..realtime import manager
from ..schemas import FileIn, FileOut
from ..security import get_current_user
from .workspaces import require_access

router = APIRouter(prefix="/api/workspaces/{workspace_id}/files", tags=["files"])

MAX_FILES_PER_WORKSPACE = 30


def get_file(session: Session, workspace_id: int, file_id: int) -> CodeFile:
    file = session.get(CodeFile, file_id)
    if not file or file.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return file


def ensure_unique(session: Session, workspace_id: int, name: str, exclude_id: int | None = None) -> None:
    clash = session.exec(
        select(CodeFile).where(CodeFile.workspace_id == workspace_id, CodeFile.name == name)
    ).first()
    if clash and clash.id != exclude_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A file named {name} already exists")


@router.get("", response_model=list[FileOut])
def list_files(
    workspace_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)
) -> list[FileOut]:
    require_access(workspace_id, session, user)
    rows = session.exec(select(CodeFile).where(CodeFile.workspace_id == workspace_id).order_by(CodeFile.id)).all()
    return [FileOut.of(f) for f in rows]


@router.post("", response_model=FileOut, status_code=status.HTTP_201_CREATED)
async def create_file(
    workspace_id: int,
    data: FileIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FileOut:
    require_access(workspace_id, session, user)
    existing = session.exec(select(CodeFile).where(CodeFile.workspace_id == workspace_id)).all()
    if len(existing) >= MAX_FILES_PER_WORKSPACE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A workspace can have at most {MAX_FILES_PER_WORKSPACE} files")
    ensure_unique(session, workspace_id, data.name)
    file = CodeFile(workspace_id=workspace_id, name=data.name, ydoc=new_state(), created_by=user.id)
    session.add(file)
    session.commit()
    session.refresh(file)
    out = FileOut.of(file)
    await manager.broadcast(workspace_id, {"type": "file_created", "file": out.model_dump(mode="json"), "by": user.username})
    return out


@router.patch("/{file_id}", response_model=FileOut)
async def rename_file(
    workspace_id: int,
    file_id: int,
    data: FileIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FileOut:
    require_access(workspace_id, session, user)
    file = get_file(session, workspace_id, file_id)
    ensure_unique(session, workspace_id, data.name, exclude_id=file.id)
    file.name = data.name
    session.add(file)
    session.commit()
    session.refresh(file)
    out = FileOut.of(file)
    await manager.broadcast(workspace_id, {"type": "file_renamed", "file": out.model_dump(mode="json"), "by": user.username})
    return out


@router.delete("/{file_id}")
async def delete_file(
    workspace_id: int,
    file_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, int]:
    workspace = require_access(workspace_id, session, user)
    file = get_file(session, workspace_id, file_id)
    # Seeded files (no creator) can only be deleted by the workspace owner.
    if user.id != workspace.owner_id and file.created_by != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the file's creator or the workspace owner can delete it")
    store.forget(file.id)
    session.delete(file)
    session.commit()
    await manager.broadcast(workspace_id, {"type": "file_deleted", "file_id": file_id, "by": user.username})
    return {"deleted": file_id}
