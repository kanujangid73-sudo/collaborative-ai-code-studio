import logging
import time
from collections import deque
from datetime import datetime, timezone
from itertools import count

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger("code-studio")

app = FastAPI(
    title="Collaborative AI Code Studio API",
    description="Backend for the CodeTogether dashboard: messaging, history and live stats.",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STARTED_AT = time.time()
MAX_HISTORY = 100
history: deque[dict] = deque(maxlen=MAX_HISTORY)
message_ids = count(1)
total_messages = 0

# Keyword -> (intent, suggestion). First match wins.
INTENTS = [
    (("endpoint", "api", "route"), "api", "Define a Pydantic model for the payload, add the route, and cover it with a test."),
    (("bug", "error", "fix", "crash"), "debug", "Reproduce it with a failing test first, then check the logs around the failing call."),
    (("test", "pytest", "coverage"), "testing", "Start with the happy path, then add edge cases for empty and invalid input."),
    (("ui", "design", "css", "component"), "frontend", "Sketch the layout, build it as a small React component, and keep styles in tokens."),
    (("deploy", "docker", "server", "host"), "devops", "Containerize the app, pass config via environment variables, and add a health check."),
]


class MessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class MessageResponse(BaseModel):
    id: int
    message: str
    reply: str
    intent: str
    created_at: str


class StatsResponse(BaseModel):
    total_messages: int
    stored_messages: int
    uptime_seconds: int
    started_at: str
    intents: dict[str, int]


def build_reply(text: str) -> tuple[str, str]:
    lowered = text.lower()
    for keywords, intent, suggestion in INTENTS:
        if any(word in lowered for word in keywords):
            return intent, f"Got it. {suggestion}"
    words = len(text.split())
    return "general", f"FastAPI received your {words}-word message: \"{text}\""


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Collaborative AI Code Studio API", "status": "ok"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/message", response_model=MessageResponse)
def receive_message(request: MessageRequest) -> MessageResponse:
    global total_messages
    intent, reply = build_reply(request.message)
    entry = {
        "id": next(message_ids),
        "message": request.message,
        "reply": reply,
        "intent": intent,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    history.append(entry)
    total_messages += 1
    logger.info("Message #%s [%s]: %s", entry["id"], intent, request.message)
    return MessageResponse(**entry)


@app.get("/api/messages", response_model=list[MessageResponse])
def list_messages(limit: int = 50) -> list[MessageResponse]:
    return [MessageResponse(**entry) for entry in list(history)[-limit:]]


@app.delete("/api/messages")
def clear_messages() -> dict[str, int]:
    cleared = len(history)
    history.clear()
    return {"cleared": cleared}


@app.get("/api/stats", response_model=StatsResponse)
def stats() -> StatsResponse:
    intents: dict[str, int] = {}
    for entry in history:
        intents[entry["intent"]] = intents.get(entry["intent"], 0) + 1
    return StatsResponse(
        total_messages=total_messages,
        stored_messages=len(history),
        uptime_seconds=int(time.time() - STARTED_AT),
        started_at=datetime.fromtimestamp(STARTED_AT, timezone.utc).isoformat(),
        intents=intents,
    )
