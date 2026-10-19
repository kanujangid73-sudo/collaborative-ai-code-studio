import React from "react";

export default function StatCard({ label, value, unit, hint, icon }) {
  return (
    <article className="card stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon" aria-hidden="true">{icon}</span>
      </div>
      <p className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </p>
      <p className="stat-hint">{hint}</p>
    </article>
  );
}
