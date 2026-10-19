import React, { useState } from "react";

const HIGHLIGHTS = [
  ["Real-time workspaces", "Chat with your team over WebSockets, with presence and typing indicators."],
  ["AI pair programmer", "Claude streams answers with highlighted code right into the conversation."],
  ["Live analytics", "Response times, topics and activity, updated as you work."],
];

export default function AuthScreen({ onSubmit }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(mode, username.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const isLogin = mode === "login";

  return (
    <div className="auth">
      <section className="auth-pitch">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">{"</>"}</span>
          <span>CodeTogether</span>
        </a>
        <div>
          <p className="eyebrow">Collaborative AI Code Studio</p>
          <h1>
            Build better code,
            <br />
            <span>together.</span>
          </h1>
          <p className="muted auth-lead">
            A shared workspace where your team and an AI pair programmer design, debug and ship
            code in real time.
          </p>
        </div>
        <ul className="auth-highlights">
          {HIGHLIGHTS.map(([title, text]) => (
            <li key={title}>
              <span className="check" aria-hidden="true">✓</span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="auth-stack">REACT · FASTAPI · WEBSOCKETS · SQLITE · CLAUDE</p>
      </section>

      <section className="auth-panel">
        <form className="card auth-card" onSubmit={submit}>
          <div className="tabs" role="tablist">
            {["login", "register"].map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`tab ${mode === m ? "active" : ""}`}
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
              >
                {m === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          <div>
            <h2>{isLogin ? "Welcome back" : "Create your account"}</h2>
            <p className="muted small-text">
              {isLogin ? "Log in to join your team's workspaces." : "It takes ten seconds. No email needed."}
            </p>
          </div>

          <label className="field">
            <span>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="e.g. alex_dev"
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9_]+"
              title="Letters, numbers and underscores only"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={isLogin ? "Your password" : "At least 6 characters"}
              minLength={6}
              required
            />
          </label>

          {error && <div className="alert" role="alert">{error}</div>}

          <button type="submit" className="button-primary full" disabled={busy}>
            {busy ? "Please wait…" : isLogin ? "Log in" : "Create account"} <span aria-hidden="true">→</span>
          </button>
        </form>
      </section>
    </div>
  );
}
