"""Application settings, read from environment variables (and an optional .env file)."""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _database_url(url: str) -> str:
    """Use the psycopg 3 driver for Postgres URLs, as given by Neon, Supabase or Render."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


def _origin(value: str) -> str:
    """Normalize an origin: add https:// when the scheme is missing and drop any trailing slash."""
    value = value.strip().rstrip("/")
    return value if "://" in value else f"https://{value}"


class Settings:
    app_name = "CodeTogether API"
    version = "1.0.0"

    # "production" turns on the checks in check() and stops allowing localhost origins.
    environment = os.getenv("APP_ENV", "development").strip().lower()
    is_production = environment == "production"

    # SQLite by default; set a Postgres URL (e.g. from Neon) for a persistent hosted database.
    database_url = _database_url(os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'codetogether.db'}"))

    # A random key is generated when none is configured, so tokens reset on restart.
    # SECRET_KEY is required in production.
    secret_key = os.getenv("SECRET_KEY") or secrets.token_urlsafe(32)
    token_expire_minutes = int(os.getenv("TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))

    # Comma-separated list of allowed frontend origins (e.g. https://codetogether.onrender.com).
    # In development, any localhost port is also allowed.
    cors_origins = [_origin(o) for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

    # AI provider, in order of preference: Claude (paid, needs an API key), Gemini (free tier,
    # needs a Google API key), Ollama (free, local), then the built-in offline assistant.
    # AI_ENABLED=false forces offline.
    ai_enabled = _bool("AI_ENABLED", True)
    claude_enabled = ai_enabled and bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))
    ai_model = os.getenv("AI_MODEL", "claude-opus-5-5")
    ai_effort = os.getenv("AI_EFFORT", "low")
    ai_history_messages = int(os.getenv("AI_HISTORY_MESSAGES", "20"))
    # Per-user cap on AI replies, to protect free-tier quotas. 0 disables the limit.
    ai_requests_per_hour = int(os.getenv("AI_REQUESTS_PER_HOUR", "20"))

    gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
    gemini_enabled = ai_enabled and bool(gemini_api_key)
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
    gemini_url = os.getenv("GEMINI_URL", "https://generativelanguage.googleapis.com").rstrip("/")

    ollama_enabled = ai_enabled and _bool("OLLAMA_ENABLED", True)
    ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
    ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:1.5b")
    # Small local models on a CPU slow down a lot with long prompts, so send less history.
    ollama_history_messages = int(os.getenv("OLLAMA_HISTORY_MESSAGES", "8"))

    def check(self) -> None:
        """Refuse to start a production server with settings that would lose data or leak access."""
        if not self.is_production:
            return
        problems = []
        if len(os.getenv("SECRET_KEY", "")) < 32:
            problems.append("SECRET_KEY must be set to a random string of at least 32 characters")
        if self.database_url.startswith("sqlite"):
            problems.append("DATABASE_URL must point to Postgres (SQLite files are wiped on most free hosts)")
        if not self.cors_origins:
            problems.append("CORS_ORIGINS must list the frontend URL")
        if problems:
            raise RuntimeError("Invalid production settings:\n- " + "\n- ".join(problems))


settings = Settings()
