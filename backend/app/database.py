from collections.abc import Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, inspect, text
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
# The first migration. Databases created before migrations existed are stamped with it.
BASELINE_REVISION = "0001"


def make_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    # Hosted Postgres (Neon, Supabase) closes idle connections and limits how many are open,
    # so check connections before use and keep the pool small. Store times in UTC.
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_recycle=300,
        pool_size=5,
        max_overflow=5,
        connect_args={"options": "-c timezone=UTC"},
    )


engine = make_engine(settings.database_url)


def alembic_config(connection: Connection | None = None) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def _upgrade_legacy(conn: Connection) -> None:
    """Bring a database made by create_all() up to the baseline schema, then mark it as migrated."""
    SQLModel.metadata.create_all(conn)  # creates missing tables only
    existing = {c["name"] for c in inspect(conn).get_columns("workspace")}
    if "is_private" not in existing:
        conn.execute(text("ALTER TABLE workspace ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE"))
    command.stamp(alembic_config(conn), BASELINE_REVISION)


def run_migrations() -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        if inspector.has_table("user") and not inspector.has_table("alembic_version"):
            _upgrade_legacy(conn)
        command.upgrade(alembic_config(conn), "head")


def init_db() -> None:
    from .collab import starter_file
    from .models import CodeFile, Workspace

    run_migrations()
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
