import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .ai import assistant
from .config import settings
from .database import init_db
from .routers import auth, chat, stats, workspaces

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(message)s")
logger = logging.getLogger("codetogether")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    logger.info("AI mode: %s (%s)", assistant.mode, assistant.model)
    yield


app = FastAPI(
    title=settings.app_name,
    description="Backend for CodeTogether: accounts, shared workspaces, real-time chat and an AI pair programmer.",
    version=settings.version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(chat.router)
app.include_router(stats.router)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"message": settings.app_name, "status": "ok", "docs": "/docs"}
