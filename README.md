# CodeTogether: Collaborative AI Code Studio

[![CI](https://github.com/kanujangid73-sudo/collaborative-ai-code-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/kanujangid73-sudo/collaborative-ai-code-studio/actions/workflows/ci.yml)

**Live demo: [codetogether-web.onrender.com](https://codetogether-web.onrender.com)** · [API docs](https://codetogether-api-lmtr.onrender.com/docs)

> Hosted on free plans: the first visit after a quiet spell can take up to a minute while the server wakes up.

A full-stack, real-time workspace where developers and an AI pair programmer build code together. Teammates sign in, join shared workspaces, edit code together in a live editor with named cursors, and chat. Claude answers in the same conversation, streaming Markdown and syntax-highlighted code to everyone in the room.

<!-- Add a screenshot: save it as docs/screenshot.png and uncomment the next line. -->
<!-- ![CodeTogether dashboard](docs/screenshot.png) -->

## Features

- **One-click demo.** **Try the demo** on the login screen creates a temporary guest account with a private sandbox: a guided README, a Python file with a bug to fix with AI, and a JavaScript file. Guests are rate-limited per IP address and cleaned up after 24 hours.
- **Shared code editor.** Google-Docs-style co-editing with CodeMirror 6 and Yjs CRDTs. Several people can type in the same file at once without conflicts, see each other's named cursors, and manage multiple files with syntax highlighting. The server merges edits with pycrdt and saves them to the database.
- **Run code in the browser.** Press **▶ Run** to execute Python (via Pyodide, CPython compiled to WebAssembly) or JavaScript in a Web Worker, with live output, a timeout, and a Stop button. When it fails, **Ask AI to fix** sends the error and the code to the AI.
- **Ask AI about code.** Select code (or use the whole file), press **Ask AI** or `Ctrl+Enter`, and the snippet goes to the AI together with your question. The answer appears in the shared chat.
- **AI pair programmer.** Replies stream token by token over WebSockets and render as Markdown with highlighted code. Providers are chosen automatically, in this order: the **Claude API** (paid), **Google Gemini** (free tier), a **local model through Ollama** (free), or a built-in **offline assistant**. The app always works and can run entirely for free.
- **Real-time collaboration.** One WebSocket room per workspace, with live messages, presence avatars, typing indicators and automatic reconnect.
- **Accounts and workspaces.** Sign up and log in with JWT tokens and PBKDF2-hashed passwords. Workspaces can be public or **private (invite only)**, with owner and member roles. Owners can rename, invite, remove members and delete; members can leave. Removed members are disconnected right away.
- **Chat tools.** Copy or **insert AI code blocks straight into the editor**, regenerate the last AI reply, and delete your own messages (owners can moderate).
- **AI usage limits.** A per-user hourly cap on AI replies (20 by default) protects free-tier quotas, with the remaining count shown in the chat.
- **Persistent storage.** Users, workspaces, messages and files are stored through SQLModel: SQLite for local development, Postgres in production, with schema changes managed by Alembic migrations.
- **Live analytics dashboard.** Shows AI response times as a bar chart, detected topics, online users, message counts and server uptime.
- **Engineering setup.** Pytest and Vitest test suites (the backend suite runs on both SQLite and Postgres), Docker Compose, GitHub Actions CI on every push, and a one-click Render Blueprint for free deployment.

## Architecture

```
┌──────────────┐  REST (JWT)   ┌──────────────────┐   SQLModel   ┌──────────┐
│  React SPA   │ ────────────▶ │     FastAPI      │ ───────────▶ │ Postgres │
│  Vite :5173  │ ◀──────────── │  Uvicorn :8000   │              │ / SQLite │
│              │               │                  │              └──────────┘
│              │   WebSocket   │                  │   streaming  ┌──────────┐
│              │ ◀───────────▶ │ rooms + presence │ ───────────▶ │ Claude / │
└──────────────┘               └──────────────────┘              │ Gemini / │
                                                                 │  Ollama  │
                                                                 └──────────┘
```

When someone types in the editor:

1. The browser's Yjs document produces a small binary update, which is sent as `doc_update` over the workspace WebSocket.
2. The server merges it into its copy of the file (pycrdt) and relays it to everyone else in the room.
3. Cursor positions travel the same way as `awareness` updates.
4. The merged document is saved to the database every few seconds, so a late joiner gets the latest version.

When someone sends a message in a workspace:

1. The browser sends `{"type": "message"}` over the workspace WebSocket.
2. The server saves it and broadcasts it to everyone in the room.
3. If "Ask AI" is on, the server loads the recent history and streams the AI's reply as `ai_delta` events.
4. The finished reply is saved and broadcast as `ai_done`, along with its response time.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 18, Vite 6, CodeMirror 6, Yjs, react-markdown, highlight.js, Vitest |
| Backend | Python, FastAPI, SQLModel/SQLAlchemy, Alembic, PostgreSQL / SQLite, pycrdt, PyJWT, WebSockets |
| AI | Anthropic Python SDK (Claude), Gemini REST API, Ollama, offline fallback |
| DevOps | Docker, Docker Compose, nginx, GitHub Actions, Render, Neon |

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

### 3. Free AI with Gemini (optional, recommended)

1. Create a free API key at https://aistudio.google.com/apikey. You need a Google account; no card is required.
2. In `backend/.env`, set `GEMINI_API_KEY=your-key`.
3. Restart the backend. The dashboard badge shows **Gemini 3.8 Flash**.

The free tier has rate limits, which you can see in Google AI Studio. Google may use free-tier prompts to improve its products, so don't send private code.

### 4. Free AI with Ollama (optional, fully local)

Real AI replies with no API key and no cost. The model runs on your own computer.

1. Install Ollama from https://ollama.com/download.
2. Download a small coding model (about 1 GB):
   ```bash
   ollama pull qwen2.5-coder:1.5b
   ```
3. Keep Ollama running. The backend detects it within about 15 seconds, and the dashboard badge shows `qwen2.5-coder:1.5b · local`.

On a machine with 16 GB+ RAM or a GPU, a larger model gives better answers, for example `OLLAMA_MODEL=qwen2.5-coder:7b` in `backend/.env`.

### Run with Docker

```bash
docker compose up --build
```

The frontend is served at http://localhost:5173 and the backend at http://localhost:8000, with a Postgres database in its own container, as in production.

## Deploy

CodeTogether can be deployed for free: Render hosts the API and the frontend, and Neon hosts the Postgres database. [`render.yaml`](render.yaml) creates both services in one step. See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the step-by-step guide.

## Configuration

Set these in `backend/.env` (see [`backend/.env.example`](backend/.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `APP_ENV` | `development` | `production` refuses to start without `SECRET_KEY`, a Postgres `DATABASE_URL` and `CORS_ORIGINS`, and stops allowing localhost origins |
| `SECRET_KEY` | random per start | Signs login tokens. **Required in production**, otherwise everyone is logged out on restart. |
| `ANTHROPIC_API_KEY` | none | Turns on Claude replies (paid). Takes priority over Ollama. |
| `GEMINI_API_KEY` | none | Turns on Gemini replies (free tier). Used when there's no Anthropic key. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model used for replies |
| `OLLAMA_MODEL` | `qwen2.5-coder:1.5b` | Local model used when Ollama is running |
| `OLLAMA_URL` | `http://localhost:11434` | Address of the Ollama server |
| `AI_ENABLED` | `true` | Set to `false` to always use the offline assistant |
| `AI_REQUESTS_PER_HOUR` | `20` | AI replies each user may request per hour (`0` = unlimited) |
| `AI_MODEL` | `claude-opus-5-5` | Claude model used for replies |
| `AI_EFFORT` | `low` | Reasoning effort (`low`, `medium`, `high`) |
| `DATABASE_URL` | `sqlite:///backend/codetogether.db` | SQLite or Postgres URL. `postgres://` and `postgresql://` URLs (as given by Neon, Supabase or Render) work as-is |
| `CORS_ORIGINS` | none | Allowed frontend origins, comma-separated. In development any localhost port is also allowed |

For the frontend, set `VITE_API_URL` to point at a deployed backend.

### Database migrations

The schema is managed with Alembic, and the backend applies pending migrations when it starts. After changing `backend/app/models.py`:

```bash
cd backend
alembic revision --autogenerate -m "describe the change"
```

Review the generated file in `app/migrations/versions/` and commit it. A test fails if the models and migrations drift apart.

## Tests

```bash
cd backend && pytest        # 51 API, auth, demo, permissions, WebSocket, collaboration, AI and database tests

# Run the same suite against Postgres (CI does this on every push):
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/test_db pytest
cd frontend && npm test     # utility tests with Vitest
```

## API overview

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create an account and receive a JWT |
| POST | `/api/auth/login` | Log in and receive a JWT |
| POST | `/api/auth/demo` | Create a temporary guest account with a sample workspace |
| GET | `/api/auth/me` | Current user |
| GET / POST | `/api/workspaces` | List visible workspaces, or create one (optionally private) |
| PATCH / DELETE | `/api/workspaces/{id}` | Rename, describe, make private, or delete (owner only) |
| GET / POST | `/api/workspaces/{id}/members` | List members, or invite by username (owner only) |
| DELETE | `/api/workspaces/{id}/members/{user}` | Remove a member, or leave |
| GET / DELETE | `/api/workspaces/{id}/messages` | Message history, or clear it (owner only) |
| DELETE | `/api/workspaces/{id}/messages/{message}` | Delete a message (author or owner) |
| GET / POST | `/api/workspaces/{id}/files` | List or create code files |
| PATCH / DELETE | `/api/workspaces/{id}/files/{file}` | Rename or delete a file |
| WS | `/ws/workspaces/{id}?token=…` | Chat, presence, typing, AI streaming, live editing |
| GET | `/api/stats` | Usage and latency analytics |
| GET | `/api/health` | Health check |

## Project structure

```
backend/
  app/
    main.py          FastAPI app, CORS, router registration
    config.py        Settings from environment variables
    database.py      Engine, migrations on startup, default workspace seeding
    demo.py          Guest accounts for the one-click demo, and their cleanup
    migrations/      Alembic migrations
    models.py        SQLModel tables: User, Workspace, Message
    schemas.py       Request and response models
    security.py      Password hashing, JWT, auth dependency
    ai.py            AI providers: Claude, Gemini, Ollama, offline assistant
    realtime.py      WebSocket rooms, presence, kicking removed members
    ratelimit.py     Per-user AI request limiter
    collab.py        CRDT documents for the shared editor (pycrdt)
    routers/         auth, workspaces, files, chat (WebSocket), stats
  tests/             pytest suite
frontend/
  src/
    App.jsx          Auth gate and dashboard
    hooks/           useAuth, useWorkspaceSocket
    components/      Chat, charts, sidebar, auth screen and more
    lib/             API client, code runner, formatting helpers
    workers/         Web Worker that runs Python (Pyodide) and JavaScript
docs/DEPLOY.md       Free deployment guide (Render + Neon)
render.yaml          Render Blueprint
docker-compose.yml
.github/workflows/ci.yml
```

## Roadmap

- [x] REST API with authentication and a database
- [x] Real-time chat with AI streaming
- [x] Tests, Docker and CI
- [x] Shared live code editor
- [x] Workspace invites and roles
- [x] Run code in the browser
- [x] Production config, Postgres and migrations
- [x] Deploy a public demo
