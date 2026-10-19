import React from "react";

const FEATURES = [
  {
    title: "Full-stack messaging",
    text: "React sends messages to a FastAPI REST API, which validates them with Pydantic and replies.",
  },
  {
    title: "Topic detection",
    text: "The backend classifies each message (API, debugging, testing, frontend, DevOps) and suggests a next step.",
  },
  {
    title: "Live monitoring",
    text: "Health polling, server uptime, round-trip latency and success rate update in real time.",
  },
  {
    title: "Persistent history",
    text: "Messages are kept server-side, so the console survives a page refresh.",
  },
];

const STACK = ["React 18", "Vite 6", "JavaScript (ES2022)", "CSS custom properties", "Python 3", "FastAPI", "Pydantic", "Uvicorn", "REST / JSON", "CORS"];

const FLOW = [
  { title: "React UI", sub: "Vite dev server · :5173" },
  { title: "REST / JSON", sub: "fetch + CORS" },
  { title: "FastAPI", sub: "Uvicorn · :8000" },
  { title: "In-memory store", sub: "history + stats" },
];

export default function AboutProject() {
  return (
    <section className="card about" id="about">
      <div className="about-intro">
        <p className="eyebrow">About this project</p>
        <h2>A shared workspace where developers and AI build code together.</h2>
        <p className="muted">
          CodeTogether is the foundation of a collaborative AI coding studio. This dashboard shows
          the core plumbing: a React single-page app talking to a Python FastAPI service, with live
          health monitoring, message history and request analytics. It is built to be extended with
          a real LLM, authentication and real-time collaboration.
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
            <li className="done">REST API with validation</li>
            <li className="done">Live dashboard &amp; analytics</li>
            <li>LLM-powered code suggestions</li>
            <li>Real-time collaboration over WebSockets</li>
            <li>User accounts &amp; shared workspaces</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
