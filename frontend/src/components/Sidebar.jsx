import React from "react";

const NAV = [
  { href: "#overview", label: "Overview", icon: "▦" },
  { href: "#console", label: "AI Console", icon: "❯" },
  { href: "#endpoints", label: "Endpoints", icon: "⇄" },
  { href: "#about", label: "About", icon: "ⓘ" },
];

export default function Sidebar({ status }) {
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

      <div className="sidebar-footer">
        <div className={`server-card ${status}`}>
          <span className="status-dot" />
          <div>
            <strong>FastAPI server</strong>
            <span>{status === "online" ? "localhost:8000" : status}</span>
          </div>
        </div>
        <p className="version">v0.2.0 · Portfolio build</p>
      </div>
    </aside>
  );
}
