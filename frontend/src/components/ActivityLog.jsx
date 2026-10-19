import React from "react";

const ICONS = { success: "✓", error: "!", message: "✉", info: "i" };

export default function ActivityLog({ items }) {
  return (
    <article className="card">
      <div className="card-header">
        <div>
          <h2>Activity</h2>
          <p>Events from this session</p>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="chart-empty small">Nothing yet.</div>
      ) : (
        <ul className="activity">
          {items.map((item) => (
            <li key={item.id}>
              <span className={`activity-icon ${item.type}`} aria-hidden="true">
                {ICONS[item.type]}
              </span>
              <span className="activity-text">{item.text}</span>
              <time className="activity-time">
                {item.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
