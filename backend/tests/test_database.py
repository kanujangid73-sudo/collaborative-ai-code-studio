import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlmodel import SQLModel

from app import database
from app.config import Settings, _database_url, _origin


def test_postgres_urls_use_psycopg():
    assert _database_url("postgres://u:p@host/db") == "postgresql+psycopg://u:p@host/db"
    assert _database_url("postgresql://u:p@host/db?sslmode=require") == "postgresql+psycopg://u:p@host/db?sslmode=require"
    assert _database_url("sqlite:///x.db") == "sqlite:///x.db"


def test_origins_are_normalized():
    assert _origin("codetogether.onrender.com/") == "https://codetogether.onrender.com"
    assert _origin("http://localhost:5173") == "http://localhost:5173"


def test_production_rejects_unsafe_settings(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "short")
    prod = Settings()
    prod.is_production = True
    prod.database_url = "sqlite:///data.db"
    prod.cors_origins = []
    with pytest.raises(RuntimeError) as err:
        prod.check()
    assert "SECRET_KEY" in str(err.value) and "DATABASE_URL" in str(err.value) and "CORS_ORIGINS" in str(err.value)

    monkeypatch.setenv("SECRET_KEY", "x" * 40)
    prod.database_url = "postgresql+psycopg://u:p@host/db"
    prod.cors_origins = ["https://codetogether.onrender.com"]
    prod.check()


def test_migrations_match_models(client):
    """Fails when a model changes without a migration: run `alembic revision --autogenerate`."""
    with database.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), SQLModel.metadata)
    assert diff == []


def test_legacy_database_is_upgraded(tmp_path, monkeypatch):
    """Databases created before migrations existed keep their data and gain new columns."""
    engine = database.make_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE "user" (id INTEGER PRIMARY KEY, username VARCHAR(32), password_hash VARCHAR, created_at DATETIME)'))
        conn.execute(text("CREATE TABLE workspace (id INTEGER PRIMARY KEY, name VARCHAR(60), description VARCHAR(200), owner_id INTEGER, created_at DATETIME)"))
        conn.execute(text("INSERT INTO workspace (name, description) VALUES ('Old', '')"))
    monkeypatch.setattr(database, "engine", engine)

    database.run_migrations()

    with engine.connect() as conn:
        assert "is_private" in {c["name"] for c in inspect(conn).get_columns("workspace")}
        assert inspect(conn).has_table("codefile")
        assert "is_guest" in {c["name"] for c in inspect(conn).get_columns("user")}
        head = ScriptDirectory.from_config(database.alembic_config()).get_current_head()
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
        assert conn.execute(text("SELECT name FROM workspace")).scalar() == "Old"
    engine.dispose()
