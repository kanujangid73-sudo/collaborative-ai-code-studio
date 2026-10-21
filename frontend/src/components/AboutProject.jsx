import React from "react";

const FEATURES = [
  {
    title: "Shared code editor",
    text: "Google-Docs-style co-editing built on Yjs CRDTs and CodeMirror, with named live cursors, multiple files and syntax highlighting.",
  },
  {
    title: "Run code in the browser",
    text: "Python (Pyodide/WebAssembly) and JavaScript run in a Web Worker with live output, timeouts, and one-click \"Ask AI to fix\" on errors.",
  },
  {
    title: "AI pair programmer",
    text: "Answers stream into the shared chat as Markdown with highlighted code, from Claude, Google Gemini's free tier, or a local model via Ollama.",
  },
  {
    title: "Real-time collaboration",
    text: "WebSocket rooms per workspace with live messages, presence avatars and typing indicators.",
  },
  {
    title: "Accounts & workspaces",
    text: "JWT authentication, public or invite-only workspaces, owner/member roles, and per-user AI usage limits.",
  },
  {
    title: "Persistent history",
    text: "Users, workspaces, messages and files are stored in PostgreSQL through SQLModel, with Alembic migrations. Local development uses SQLite.",
  },
  {
    title: "Live analytics",
    text: "AI response times, topic detection, online users and uptime, refreshed automatically.",
  },
  {
    title: "Production-ready setup",
    text: "Pytest and Vitest suites, Docker Compose, a GitHub Actions pipeline that tests every push on SQLite and Postgres, and free hosting on Render and Neon.",
  },
];

const STACK = [
  "React 18", "Vite 6", "CodeMirror 6", "Yjs (CRDT)", "Pyodide (WebAssembly)", "Web Workers", "WebSockets", "react-markdown", "Vitest",
  "Python 3", "FastAPI", "SQLModel", "PostgreSQL", "Alembic", "pycrdt", "JWT", "Claude API", "Gemini API", "Ollama", "Pytest",
  "Docker", "GitHub Actions", "Render", "Neon",
];

const FLOW = [
  { title: "React SPA", sub: "Vite · :5173" },
  { title: "REST + WebSocket", sub: "JWT auth" },
  { title: "FastAPI", sub: "Uvicorn · :8000" },
  { title: "PostgreSQL", sub: "SQLModel + Alembic" },
  { title: "Claude / Gemini / Ollama", sub: "streaming AI replies" },
];

export default function AboutProject() {
  return (
    <section className="card about" id="about">
      <div className="about-intro">
        <p className="eyebrow">About this project</p>
        <h2>A shared workspace where developers and AI build code together.</h2>
        <p className="muted">
          CodeTogether is a full-stack collaborative coding studio. Teammates sign in, join shared
          workspaces, write code together in a live editor and talk in real time, while an AI pair
          programmer reviews selected code and answers with working examples, streamed live to
          everyone in the room. It runs on Claude, on Google
          Gemini's free tier, on a local model through Ollama, or on a built-in offline assistant,
          so the app always works and can run entirely for free.
        </p>
      </div>

      <div className="flow" aria-label="Architecture">
        {FLOW.map((step, i) => (
          <React.Fragment key={step.title}>
            <div className="flow-node">
              <strong>{step.title}</strong>
              <span>{step.sub}</span>
            </div>
            {i < FLOW.length - 1 && <span className="flow-arrow" aria-hidden="true">→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="features">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>

      <div className="about-bottom">
        <div>
          <h3 className="small-heading">Tech stack</h3>
          <div className="chips">
            {STACK.map((s) => <span key={s} className="chip static">{s}</span>)}
          </div>
        </div>
        <div>
          <h3 className="small-heading">Roadmap</h3>
          <ul className="roadmap">
            <li className="done">REST API, auth &amp; database</li>
            <li className="done">Real-time chat with AI streaming</li>
            <li className="done">Tests, Docker &amp; CI</li>
            <li className="done">Shared live code editor</li>
            <li className="done">Workspace invites &amp; roles</li>
            <li className="done">Run code in the browser</li>
            <li className="done">Public demo deployment</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
