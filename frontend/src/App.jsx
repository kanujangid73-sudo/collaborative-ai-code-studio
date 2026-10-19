import React, { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import StatCard from "./components/StatCard.jsx";
import ChatConsole from "./components/ChatConsole.jsx";
import LatencyChart from "./components/LatencyChart.jsx";
import IntentBreakdown from "./components/IntentBreakdown.jsx";
import EndpointTable from "./components/EndpointTable.jsx";
import ActivityLog from "./components/ActivityLog.jsx";
import AboutProject from "./components/AboutProject.jsx";
import { API_URL } from "./config.js";


const POLL_MS = 10000;

function formatUptime(seconds) {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function App() {
  const [status, setStatus] = useState("checking");
  const [stats, setStats] = useState(null);
  const [messages, setMessages] = useState([]);
  const [latencies, setLatencies] = useState([]);
  const [attempts, setAttempts] = useState({ ok: 0, failed: 0 });
  const [activity, setActivity] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const log = useCallback((type, text) => {
    setActivity((items) => [{ id: crypto.randomUUID(), type, text, time: new Date() }, ...items].slice(0, 30));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/health`),
        fetch(`${API_URL}/api/stats`),
      ]);
      if (!healthRes.ok || !statsRes.ok) throw new Error("bad response");
      setStats(await statsRes.json());
      setStatus((prev) => {
        if (prev !== "online") log("success", "Connected to FastAPI backend");
        return "online";
      });
    } catch {
      setStatus((prev) => {
        if (prev !== "offline") log("error", "Backend unreachable");
        return "offline";
      });
    }
  }, [log]);

  useEffect(() => {
    fetch(`${API_URL}/api/messages`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setMessages(data.map((m) => ({ ...m, latency: null }))))
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Tick uptime locally between polls.
  useEffect(() => {
    const timer = setInterval(() => {
      setStats((s) => (s ? { ...s, uptime_seconds: s.uptime_seconds + 1 } : s));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  async function sendMessage(text) {
    setIsSending(true);
    setError("");
    const started = performance.now();
    try {
      const res = await fetch(`${API_URL}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
      const data = await res.json();
      const latency = Math.round(performance.now() - started);
      setMessages((items) => [...items, { ...data, latency }]);
      setLatencies((items) => [...items, { id: data.id, ms: latency, time: new Date() }].slice(-24));
      setAttempts((a) => ({ ...a, ok: a.ok + 1 }));
      log("message", `Message #${data.id} answered in ${latency} ms (${data.intent})`);
      refresh();
      return true;
    } catch (err) {
      setAttempts((a) => ({ ...a, failed: a.failed + 1 }));
      setError(`${err.message}. Make sure the FastAPI server is running at ${API_URL}.`);
      log("error", "Message failed to send");
      return false;
    } finally {
      setIsSending(false);
    }
  }

  async function clearHistory() {
    try {
      const res = await fetch(`${API_URL}/api/messages`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages([]);
      log("info", `Cleared ${data.cleared} stored messages`);
      refresh();
    } catch {
      setError("Could not clear history.");
    }
  }

  const avgLatency = useMemo(() => {
    if (!latencies.length) return null;
    return Math.round(latencies.reduce((sum, l) => sum + l.ms, 0) / latencies.length);
  }, [latencies]);

  const totalAttempts = attempts.ok + attempts.failed;
  const successRate = totalAttempts ? Math.round((attempts.ok / totalAttempts) * 100) : null;

  return (
    <div className="layout">
      <Sidebar status={status} />

      <main className="main">
        <header className="page-header" id="overview">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Collaborative AI Code Studio</h1>
            <p className="subtitle">
              Live view of the React frontend talking to the FastAPI backend.
            </p>
          </div>
          <div className="header-actions">
            <span className={`status-pill ${status}`}>
              <span className="status-dot" />
              API {status}
            </span>
            <a className="button-ghost" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
              API docs <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>

        <section className="stats-grid" aria-label="Key metrics">
          <StatCard
            label="Messages processed"
            value={stats ? stats.total_messages : "—"}
            hint={stats ? `${stats.stored_messages} in history` : "Waiting for backend"}
            icon="✉"
          />
          <StatCard
            label="Avg response time"
            value={avgLatency != null ? `${avgLatency}` : "—"}
            unit={avgLatency != null ? "ms" : ""}
            hint={latencies.length ? `Across ${latencies.length} requests` : "Send a message to measure"}
            icon="⚡"
          />
          <StatCard
            label="Server uptime"
            value={formatUptime(stats?.uptime_seconds)}
            hint={stats ? `Since ${new Date(stats.started_at).toLocaleTimeString()}` : "Offline"}
            icon="◷"
          />
          <StatCard
            label="Success rate"
            value={successRate != null ? `${successRate}` : "—"}
            unit={successRate != null ? "%" : ""}
            hint={totalAttempts ? `${attempts.ok} of ${totalAttempts} requests` : "This session"}
            icon="✓"
          />
        </section>

        <section className="grid-main" id="console">
          <ChatConsole
            messages={messages}
            onSend={sendMessage}
            onClear={clearHistory}
            isSending={isSending}
            error={error}
            disabled={status === "offline"}
          />
          <div className="stack">
            <LatencyChart data={latencies} />
            <IntentBreakdown intents={stats?.intents ?? {}} />
          </div>
        </section>

        <section className="grid-split" id="endpoints">
          <EndpointTable status={status} />
          <ActivityLog items={activity} />
        </section>

        <AboutProject />

        <footer className="page-footer">
          <span>CodeTogether · Built with React, Vite &amp; FastAPI</span>
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            OpenAPI documentation ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
