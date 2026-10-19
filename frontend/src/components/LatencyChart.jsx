import React, { useState } from "react";

const secs = (ms) => (ms / 1000).toFixed(1);

export default function LatencyChart({ data }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1000, ...data.map((d) => d.ms));
  // Round the axis top up to a whole number of seconds.
  const top = Math.ceil(max / 1000) * 1000;
  const active = hover != null ? data[hover] : null;

  return (
    <article className="card chart-card">
      <div className="card-header">
        <div>
          <h2>Response time</h2>
          <p>Time for the AI to finish each reply, in seconds</p>
        </div>
        {data.length > 0 && (
          <span className="chart-latest">
            Latest <strong>{secs(data[data.length - 1].ms)}s</strong>
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="chart-empty">No AI replies yet. Ask the AI something to see its response times.</div>
      ) : (
        <div className="chart">
          <div className="y-axis" aria-hidden="true">
            <span>{top / 1000}s</span>
            <span>{top / 2000}s</span>
            <span>0</span>
          </div>
          <div className="plot" onMouseLeave={() => setHover(null)}>
            <div className="gridline" style={{ top: 0 }} />
            <div className="gridline" style={{ top: "50%" }} />
            <div className="bars">
              {data.map((d, i) => (
                <div
                  key={d.id}
                  className={`bar-slot ${hover === i ? "active" : ""}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`Reply ${d.id}: ${secs(d.ms)} seconds`}
                >
                  <div className="bar" style={{ height: `${Math.max(2, (d.ms / top) * 100)}%` }} />
                </div>
              ))}
            </div>
            {active && (
              <div
                className="tooltip"
                style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
                role="status"
              >
                <strong>{secs(active.ms)}s</strong>
                <span>Reply #{active.id} · {new Date(active.created_at).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
