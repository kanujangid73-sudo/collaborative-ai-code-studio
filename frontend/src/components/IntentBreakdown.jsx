import React from "react";

const LABELS = {
  api: "API design",
  debug: "Debugging",
  testing: "Testing",
  frontend: "Frontend",
  devops: "DevOps",
  general: "General",
};

export default function IntentBreakdown({ intents }) {
  const rows = Object.entries(intents).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));

  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h2>Topics detected</h2>
          <p>What the backend classified your messages as</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="chart-empty small">No messages classified yet.</div>
      ) : (
        <ul className="hbars">
          {rows.map(([intent, n]) => (
            <li key={intent} title={`${LABELS[intent] ?? intent}: ${n}`}>
              <span className="hbar-label">{LABELS[intent] ?? intent}</span>
              <span className="hbar-track">
                <span className="hbar-fill" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="hbar-value">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
