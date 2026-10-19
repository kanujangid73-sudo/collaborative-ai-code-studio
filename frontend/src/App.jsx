import React, { useCallback, useEffect, useRef, useState } from "react";
import AboutProject from "./components/AboutProject.jsx";
import ActivityLog from "./components/ActivityLog.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import { AvatarStack } from "./components/Avatar.jsx";
import ChatConsole from "./components/ChatConsole.jsx";
import EndpointTable from "./components/EndpointTable.jsx";
import IntentBreakdown from "./components/IntentBreakdown.jsx";
import LatencyChart from "./components/LatencyChart.jsx";
import Sidebar from "./components/Sidebar.jsx";
import StatCard from "./components/StatCard.jsx";
import { API_URL } from "./config.js";
import { useAuth } from "./hooks/useAuth.js";
import { useWorkspaceSocket } from "./hooks/useWorkspaceSocket.js";
import { api } from "./lib/api.js";
import { formatUptime, modelLabel } from "./lib/format.js";

const POLL_MS = 10000;

export default function App() {
  const auth = useAuth();

  if (auth.checking) {
    return <div className="splash"><span className="brand-mark">{"</>"}</span></div>;
  }
  if (!auth.token || !auth.user) {
    return <AuthScreen onSubmit={auth.authenticate} />;
  }
  return <Dashboard {...auth} />;
}

function Dashboard({ token, user, logout }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [stats, setStats] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const [activity, setActivity] = useState([]);
  const presenceRef = useRef(null);

  const log = useCallback((type, text) => {
    setActivity((items) => [{ id: crypto.randomUUID(), type, text, time: new Date() }, ...items].slice(0, 40));
  }, []);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api("/api/stats"));
      setApiStatus((prev) => {
        if (prev === "offline") log("success", "Reconnected to the backend");
        return "online";
      });
    } catch {
      setApiStatus((prev) => {
        if (prev !== "offline") log("error", "Backend unreachable");
        return "offline";
      });
    }
  }, [log]);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await api("/api/workspaces", { token });
      setWorkspaces(list);
      setActiveId((current) => current ?? list[0]?.id ?? null);
    } catch (err) {
      if (err.status === 401) logout();
    }
  }, [token, logout]);

  useEffect(() => {
    refreshWorkspaces();
    refreshStats();
    const timer = setInterval(refreshStats, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshWorkspaces, refreshStats]);

  // Tick uptime locally between polls.
  useEffect(() => {
    const timer = setInterval(() => {
      setStats((s) => (s ? { ...s, uptime_seconds: s.uptime_seconds + 1 } : s));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const activeWorkspace = workspaces.find((w) => w.id === activeId);

  const handleEvent = useCallback(
    (event) => {
      if (event.type === "presence") {
        const prev = presenceRef.current;
        presenceRef.current = event.users;
        if (prev) {
          event.users.filter((u) => !prev.includes(u)).forEach((u) => log("info", `${u} joined the workspace`));
          prev.filter((u) => !event.users.includes(u)).forEach((u) => log("info", `${u} left the workspace`));
        }
      } else if (event.type === "message" && event.message.author !== user.username) {
        log("message", `${event.message.author} sent a message`);
      } else if (event.type === "ai_done") {
        const m = event.message;
        log("success", `AI replied in ${(m.latency_ms / 1000).toFixed(1)}s (${m.intent})`);
        refreshStats();
        refreshWorkspaces();
      } else if (event.type === "cleared") {
        log("info", `${event.by} cleared the history`);
        refreshStats();
        refreshWorkspaces();
      }
    },
    [log, user.username, refreshStats, refreshWorkspaces],
  );

  const socket = useWorkspaceSocket({ workspaceId: activeId, token, onEvent: handleEvent, onUnauthorized: logout });

  useEffect(() => {
    presenceRef.current = null;
    if (activeWorkspace) log("info", `Opened #${activeWorkspace.name}`);
    // Only log when the workspace changes, not on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  async function createWorkspace(name) {
    const ws = await api("/api/workspaces", { token, method: "POST", body: { name } });
    setWorkspaces((list) => [...list, ws]);
    setActiveId(ws.id);
    log("success", `Created workspace #${ws.name}`);
  }

  async function clearHistory() {
    if (!activeWorkspace || !window.confirm(`Clear all messages in #${activeWorkspace.name}?`)) return;
    try {
      await api(`/api/workspaces/${activeWorkspace.id}/messages`, { token, method: "DELETE" });
    } catch (err) {
      log("error", err.message);
    }
  }

  const aiLabel = stats ? modelLabel(stats.ai_model) : "…";

  return (
    <div className="layout">
      <Sidebar
        user={user}
        workspaces={workspaces}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={createWorkspace}
        onLogout={logout}
        apiStatus={apiStatus}
      />

      <main className="main">
        <header className="page-header" id="overview">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Welcome back, {user.username}</h1>
            <p className="subtitle">Your team's collaborative AI coding studio, live.</p>
          </div>
          <div className="header-actions">
            <AvatarStack names={socket.presence} />
            <span className={`ai-badge ${stats?.ai_mode ?? ""}`} title="AI model answering in chat">
              ✦ {aiLabel}
            </span>
            <span className={`status-pill ${apiStatus}`}>
              <span className="status-dot" />
              API {apiStatus}
            </span>
            <a className="button-ghost" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
              API docs <span aria-hidden="true">↗</span>
            </a>
          </div>
        </header>

        <section className="stats-grid" aria-label="Key metrics">
          <StatCard
            label="Messages"
            value={stats?.messages ?? "—"}
            hint={stats ? `${stats.ai_replies} AI replies · ${stats.workspaces} workspaces` : "Waiting for backend"}
            icon="✉"
          />
          <StatCard
            label="Avg AI response"
            value={stats?.avg_ai_latency_ms != null ? (stats.avg_ai_latency_ms / 1000).toFixed(1) : "—"}
            unit={stats?.avg_ai_latency_ms != null ? "s" : ""}
            hint={stats?.ai_replies ? `Across ${stats.ai_replies} replies` : "Ask the AI to measure"}
            icon="⚡"
          />
          <StatCard
            label="Online now"
            value={stats?.online_users ?? "—"}
            hint={stats ? `${stats.users} registered users` : "—"}
            icon="◉"
          />
          <StatCard
            label="Server uptime"
            value={formatUptime(stats?.uptime_seconds)}
            hint={stats ? `Since ${new Date(stats.started_at).toLocaleTimeString()}` : "Offline"}
            icon="◷"
          />
        </section>

        <section className="grid-main" id="console">
          <ChatConsole
            workspace={activeWorkspace}
            user={user}
            socket={socket}
            canClear={Boolean(activeWorkspace) && [null, user.id].includes(activeWorkspace.owner_id)}
            onClear={clearHistory}
          />
          <div className="stack">
            <LatencyChart data={stats?.recent_latencies ?? []} />
            <IntentBreakdown intents={stats?.intents ?? {}} />
          </div>
        </section>

        <section className="grid-split" id="endpoints">
          <EndpointTable status={apiStatus} />
          <ActivityLog items={activity} />
        </section>

        <AboutProject />

        <footer className="page-footer">
          <span>CodeTogether · React, FastAPI, WebSockets &amp; Claude</span>
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            OpenAPI documentation ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
