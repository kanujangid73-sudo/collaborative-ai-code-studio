"""Application settings, read from environment variables (and an optional .env file)."""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    app_name = "CodeTogether API"
    version = "1.0.0"

    database_url = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'codetogether.db'}")

    # A random key is generated when none is configured, so tokens reset on restart.
    # Set SECRET_KEY in production.
    secret_key = os.getenv("SECRET_KEY") or secrets.token_urlsafe(32)
    token_expire_minutes = int(os.getenv("TOKEN_EXPIRE_MINUTES", str(60 * 24 * 7)))

    # Comma-separated list of extra allowed origins (e.g. a deployed frontend URL).
    cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

    # AI: Claude is used when an API key is configured, otherwise the offline assistant.
    ai_enabled = _bool("AI_ENABLED", True) and bool(
        os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN")
    )
    ai_model = os.getenv("AI_MODEL", "claude-opus-5-5")
    ai_effort = os.getenv("AI_EFFORT", "low")
    ai_history_messages = int(os.getenv("AI_HISTORY_MESSAGES", "20"))


settings = Settings()
