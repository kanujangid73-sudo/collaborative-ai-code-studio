from collections.abc import Iterator

from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)


def init_db() -> None:
    from .models import Workspace

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        if not session.exec(select(Workspace)).first():
            session.add(Workspace(name="General", description="Default shared workspace for the team"))
            session.commit()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
