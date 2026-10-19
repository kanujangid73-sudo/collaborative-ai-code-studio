# CodeTogether: Collaborative AI Code Studio

[![CI](https://github.com/kanujangid73-sudo/collaborative-ai-code-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/kanujangid73-sudo/collaborative-ai-code-studio/actions/workflows/ci.yml)

A full-stack, real-time workspace where developers and an AI pair programmer build code together. Teammates sign in, join shared workspaces and chat live. Claude answers in the same conversation, streaming Markdown and syntax-highlighted code to everyone in the room.

<!-- Add a screenshot: save it as docs/screenshot.png and uncomment the next line. -->
<!-- ![CodeTogether dashboard](docs/screenshot.png) -->

## Features

- **AI pair programmer.** Replies come from the Anthropic Claude API, streamed token by token over WebSockets and rendered as Markdown with highlighted code. Without an API key, a built-in offline assistant takes over, so the app always works.
- **Real-time collaboration.** One WebSocket room per workspace, with live messages, presence avatars, typing indicators and automatic reconnect.
- **Accounts and workspaces.** Sign up and log in with JWT tokens and PBKDF2-hashed passwords. Anyone can create a shared workspace, and only its owner can clear the history.
- **Persistent storage.** Users, workspaces and messages are stored in SQLite through SQLModel.
- **Live analytics dashboard.** Shows AI response times as a bar chart, detected topics, online users, message counts and server uptime.
- **Engineering setup.** Pytest and Vitest test suites, Docker Compose, and GitHub Actions CI on every push.

## Architecture

```
┌──────────────┐  REST (JWT)   ┌──────────────────┐   SQLModel   ┌──────────┐
│  React SPA   │ ────────────▶ │     FastAPI      │ ───────────▶ │  SQLite  │
│  Vite :5173  │ ◀──────────── │  Uvicorn :8000   │              └──────────┘
│              │   WebSocket   │                  │   streaming  ┌──────────┐
│              │ ◀───────────▶ │ rooms + presence │ ───────────▶ │  Claude  │
└──────────────┘               └──────────────────┘              │   API    │
                                                                 └──────────┘
```

When someone sends a message in a workspace:

1. The browser sends `{"type": "message"}` over the workspace WebSocket.
2. The server saves it and broadcasts it to everyone in the room.
3. If "Ask AI" is on, the server loads the recent history and streams Claude's reply as `ai_delta` events.
4. The finished reply is saved and broadcast as `ai_done`, along with its response time.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite 6, react-markdown, highlight.js, Vitest |
| Backend | Python, FastAPI, SQLModel/SQLAlchemy, SQLite, PyJWT, WebSockets |
| AI | Anthropic Python SDK (Claude, streaming, refusal fallbacks) |
| DevOps | Docker, Docker Compose, nginx, GitHub Actions |

## Getting started

### Prerequisites

- Python 3.12+
- Node.js 20+

### 1. Backend

```bash
python -m venv .venv
# Windows: .\.venv\Scripts\Activate.ps1    macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements-dev.txt

cd backend
cp .env.example .env        # optional: add ANTHROPIC_API_KEY and SECRET_KEY
uvicorn app.main:app --reload --port 8000
```

The API docs are served at http://localhost:8000/docs.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, create an account, and start chatting. To try the real-time features, open a second browser window and sign up as another user.

### Run with Docker

```bash
docker compose up --build
```

The frontend is served at http://localhost:5173 and the backend at http://localhost:8000.

## Configuration

Set these in `backend/.env` (see [`backend/.env.example`](backend/.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `SECRET_KEY` | random per start | Signs login tokens. **Set it in production**, otherwise everyone is logged out on restart. |
| `ANTHROPIC_API_KEY` | none | Turns on Claude replies. Without it, the offline assistant is used. |
| `AI_MODEL` | `claude-opus-5-5` | Claude model used for replies |
| `AI_EFFORT` | `low` | Reasoning effort (`low`, `medium`, `high`) |
| `DATABASE_URL` | `sqlite:///backend/codetogether.db` | Any SQLAlchemy database URL |
| `CORS_ORIGINS` | none | Extra allowed frontend origins, comma-separated |

For the frontend, set `VITE_API_URL` to point at a deployed backend.

## Tests

```bash
cd backend && pytest        # 17 API, auth and WebSocket tests
cd frontend && npm test     # utility tests with Vitest
```

## API overview

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create an account and receive a JWT |
| POST | `/api/auth/login` | Log in and receive a JWT |
| GET | `/api/auth/me` | Current user |
| GET / POST | `/api/workspaces` | List or create workspaces |
| GET / DELETE | `/api/workspaces/{id}/messages` | Message history, or clear it (owner only) |
| WS | `/ws/workspaces/{id}?token=…` | Live chat, presence, typing, AI streaming |
| GET | `/api/stats` | Usage and latency analytics |
| GET | `/api/health` | Health check |

## Project structure

```
backend/
  app/
    main.py          FastAPI app, CORS, router registration
    config.py        Settings from environment variables
    database.py      Engine, session, default workspace seeding
    models.py        SQLModel tables: User, Workspace, Message
    schemas.py       Request and response models
    security.py      Password hashing, JWT, auth dependency
    ai.py            Claude streaming and offline assistant
    realtime.py      WebSocket rooms and presence
    routers/         auth, workspaces, chat (WebSocket), stats
  tests/             pytest suite
frontend/
  src/
    App.jsx          Auth gate and dashboard
    hooks/           useAuth, useWorkspaceSocket
    components/      Chat, charts, sidebar, auth screen and more
    lib/             API client and formatting helpers
docker-compose.yml
.github/workflows/ci.yml
```

## Roadmap

- [x] REST API with authentication and a database
- [x] Real-time chat with AI streaming
- [x] Tests, Docker and CI
- [ ] Shared live code editor
- [ ] Workspace invites and roles
