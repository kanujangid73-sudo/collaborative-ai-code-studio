from collections.abc import Iterator

from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)


# Columns added after the first release. create_all() only creates missing tables,
# so existing databases get new columns here.
NEW_COLUMNS = {"workspace": {"is_private": "BOOLEAN NOT NULL DEFAULT 0"}}


def migrate() -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in NEW_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def init_db() -> None:
    from .collab import starter_file
    from .models import CodeFile, Workspace

    SQLModel.metadata.create_all(engine)
    migrate()
    with Session(engine) as session:
        general = session.exec(select(Workspace)).first()
        if not general:
            general = Workspace(name="General", description="Default shared workspace for the team")
            session.add(general)
            session.commit()
            session.refresh(general)
        if not session.exec(select(CodeFile)).first():
            session.add(starter_file(general.id))
            session.commit()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
