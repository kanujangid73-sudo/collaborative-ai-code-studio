import React, { useState } from "react";

export default function LatencyChart({ data }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(50, ...data.map((d) => d.ms));
  // Round the axis top up to a clean number.
  const step = max > 500 ? 100 : max > 100 ? 50 : 10;
  const top = Math.ceil(max / step) * step;
  const active = hover != null ? data[hover] : null;

  return (
    <article className="card chart-card">
      <div className="card-header">
        <div>
          <h2>Response time</h2>
          <p>Round-trip latency per request, in ms</p>
        </div>
        {data.length > 0 && (
          <span className="chart-latest">
            Latest <strong>{data[data.length - 1].ms} ms</strong>
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="chart-empty">Send a message to start measuring latency.</div>
      ) : (
        <div className="chart">
          <div className="y-axis" aria-hidden="true">
            <span>{top}</span>
            <span>{top / 2}</span>
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
                  aria-label={`Message ${d.id}: ${d.ms} milliseconds`}
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
                <strong>{active.ms} ms</strong>
                <span>Message #{active.id} · {active.time.toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
