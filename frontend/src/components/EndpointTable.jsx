import React from "react";

const ENDPOINTS = [
  { method: "POST", path: "/api/auth/register", desc: "Create an account, get a JWT" },
  { method: "POST", path: "/api/auth/login", desc: "Log in, get a JWT" },
  { method: "GET", path: "/api/auth/me", desc: "Current user" },
  { method: "GET", path: "/api/workspaces", desc: "List shared workspaces" },
  { method: "POST", path: "/api/workspaces", desc: "Create a workspace" },
  { method: "GET", path: "/api/workspaces/{id}/messages", desc: "Message history" },
  { method: "DELETE", path: "/api/workspaces/{id}/messages", desc: "Clear history (owner)" },
  { method: "WS", path: "/ws/workspaces/{id}", desc: "Live chat, presence, AI streaming" },
  { method: "GET", path: "/api/stats", desc: "Usage and latency analytics" },
  { method: "GET", path: "/api/health", desc: "Liveness check" },
];

export default function EndpointTable({ status }) {
  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h2>API endpoints</h2>
          <p>REST routes exposed by the FastAPI backend</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Route</th>
              <th className="hide-sm">Purpose</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={`${e.method} ${e.path}`}>
                <td><span className={`method ${e.method.toLowerCase()}`}>{e.method}</span></td>
                <td><code>{e.path}</code></td>
                <td className="hide-sm muted">{e.desc}</td>
                <td>
                  <span className={`mini-status ${status}`}>
                    <span className="status-dot" />
                    {status === "online" ? "Live" : status === "offline" ? "Down" : "…"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
