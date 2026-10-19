import React from "react";

const FEATURES = [
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
    text: "JWT authentication with hashed passwords, and shared workspaces any teammate can create.",
  },
  {
    title: "Persistent history",
    text: "Users, workspaces and messages are stored in SQLite through SQLModel, so nothing is lost on restart.",
  },
  {
    title: "Live analytics",
    text: "AI response times, topic detection, online users and uptime, refreshed automatically.",
  },
  {
    title: "Production-ready setup",
    text: "Pytest and Vitest suites, Docker Compose, and a GitHub Actions pipeline that tests every push.",
  },
];

const STACK = [
  "React 18", "Vite 6", "WebSockets", "react-markdown", "highlight.js", "Vitest",
  "Python 3", "FastAPI", "SQLModel", "SQLite", "JWT", "Claude API", "Gemini API", "Ollama", "Pytest",
  "Docker", "GitHub Actions",
];

const FLOW = [
  { title: "React SPA", sub: "Vite · :5173" },
  { title: "REST + WebSocket", sub: "JWT auth" },
  { title: "FastAPI", sub: "Uvicorn · :8000" },
  { title: "SQLite", sub: "SQLModel ORM" },
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
          workspaces and talk in real time, while an AI pair programmer answers questions with
          working code, streamed live to everyone in the room. It runs on Claude, on Google
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
            <li>Shared live code editor</li>
            <li>Workspace invites &amp; roles</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
