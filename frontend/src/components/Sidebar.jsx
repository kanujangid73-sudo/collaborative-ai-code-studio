import React, { useState } from "react";
import Avatar from "./Avatar.jsx";

const NAV = [
  { href: "#overview", label: "Overview", icon: "▦" },
  { href: "#studio", label: "Code studio", icon: "❯" },
  { href: "#analytics", label: "Analytics", icon: "◔" },
  { href: "#endpoints", label: "API & activity", icon: "⇄" },
  { href: "#about", label: "About", icon: "ⓘ" },
];

export default function Sidebar({ user, workspaces, activeId, onSelect, onCreate, onLogout, apiStatus }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState("");

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate(name.trim(), isPrivate);
      setName("");
      setIsPrivate(false);
      setCreating(false);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="CodeTogether home">
        <span className="brand-mark" aria-hidden="true">{"</>"}</span>
        <span>CodeTogether</span>
      </a>

      <nav className="nav" aria-label="Sections">
        {NAV.map((item) => (
          <a key={item.href} href={item.href} className="nav-link">
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>
            {item.label}
          </a>
        ))}
      </nav>

      <div className="workspaces">
        <div className="section-label">
          <span>Workspaces</span>
          <button
            className="icon-button"
            onClick={() => setCreating((v) => !v)}
            aria-label="New workspace"
            aria-expanded={creating}
          >
            +
          </button>
        </div>

        {creating && (
          <form className="new-workspace" onSubmit={create}>
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workspace name"
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            />
            <label className="check-label">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              Private (invite only)
            </label>
            {error && <span className="field-error">{error}</span>}
          </form>
        )}

        <ul className="workspace-list">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <button
                className={`workspace-item ${ws.id === activeId ? "active" : ""}`}
                onClick={() => onSelect(ws.id)}
                aria-current={ws.id === activeId}
              >
                <span className="hash" aria-hidden="true">{ws.is_private ? "🔒" : "#"}</span>
                <span className="ws-name">{ws.name}</span>
                {ws.message_count > 0 && <span className="count">{ws.message_count}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-footer">
        <div className={`server-card ${apiStatus}`}>
          <span className="status-dot" />
          <div>
            <strong>FastAPI server</strong>
            <span>{apiStatus}</span>
          </div>
        </div>
        {user && (
          <div className="user-card">
            <Avatar name={user.username} size={34} />
            <div>
              <strong>{user.username}</strong>
              <span>Signed in</span>
            </div>
            <button className="icon-button" onClick={onLogout} aria-label="Log out" title="Log out">
              ⏻
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
