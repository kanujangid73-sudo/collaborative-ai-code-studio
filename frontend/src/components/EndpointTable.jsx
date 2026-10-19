import React from "react";

const ENDPOINTS = [
  { method: "GET", path: "/api/health", desc: "Liveness check" },
  { method: "POST", path: "/api/message", desc: "Send a message, get a reply" },
  { method: "GET", path: "/api/messages", desc: "Recent message history" },
  { method: "DELETE", path: "/api/messages", desc: "Clear stored history" },
  { method: "GET", path: "/api/stats", desc: "Uptime and usage stats" },
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
