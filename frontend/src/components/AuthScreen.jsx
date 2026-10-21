import React, { useEffect, useState } from "react";

import { API_URL } from "../config.js";

const HIGHLIGHTS = [
  ["Real-time workspaces", "Chat with your team over WebSockets, with presence and typing indicators."],
  ["AI pair programmer", "Claude streams answers with highlighted code right into the conversation."],
  ["Live analytics", "Response times, topics and activity, updated as you work."],
];

// Free hosting puts the API to sleep when idle, and the first request wakes it (up to a minute).
// Ping it on load so visitors see why they're waiting instead of a silent spinner.
function useServerStatus() {
  const [status, setStatus] = useState("checking"); // checking | waking | ready | down
  useEffect(() => {
    let cancelled = false;
    const slow = setTimeout(() => !cancelled && setStatus((s) => (s === "checking" ? "waking" : s)), 2500);
    const deadline = Date.now() + 120_000;
    async function ping() {
      try {
        const res = await fetch(`${API_URL}/api/health`);
        if (res.ok) {
          if (!cancelled) setStatus("ready");
          return;
        }
      } catch {
        // not up yet
      }
      if (cancelled) return;
      if (Date.now() > deadline) setStatus("down");
      else setTimeout(ping, 4000);
    }
    ping();
    return () => {
      cancelled = true;
      clearTimeout(slow);
    };
  }, []);
  return status;
}

export default function AuthScreen({ onSubmit, onDemo }) {
  const server = useServerStatus();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // null | "form" | "demo"

  async function run(kind, action) {
    setBusy(kind);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function submit(e) {
    e.preventDefault();
    run("form", () => onSubmit(mode, username.trim(), password));
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
        <p className="auth-stack">REACT · FASTAPI · WEBSOCKETS · YJS · POSTGRES</p>
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

          {server === "waking" && (
            <div className="alert warn" role="status">
              Waking up the server. Free hosting sleeps when idle, so this can take up to a minute.
            </div>
          )}
          {server === "down" && (
            <div className="alert" role="alert">
              The server isn't responding at {API_URL}. Please try again later.
            </div>
          )}
          {error && <div className="alert" role="alert">{error}</div>}

          <button type="submit" className="button-primary full" disabled={busy !== null}>
            {busy === "form" ? "Please wait…" : isLogin ? "Log in" : "Create account"} <span aria-hidden="true">→</span>
          </button>

          <div className="auth-divider"><span>or</span></div>

          <button type="button" className="button-ghost full" disabled={busy !== null} onClick={() => run("demo", onDemo)}>
            {busy === "demo" ? "Setting up your sandbox…" : "Try the demo, no sign-up"}
          </button>
          <p className="muted small-text auth-demo-note">
            Get a temporary account with sample code to run, fix with AI and edit live.
          </p>
        </form>
      </section>
    </div>
  );
}
