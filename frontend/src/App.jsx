import React, { useCallback, useEffect, useRef, useState } from "react";
import AboutProject from "./components/AboutProject.jsx";
import ActivityLog from "./components/ActivityLog.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import { AvatarStack } from "./components/Avatar.jsx";
import ChatConsole from "./components/ChatConsole.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import EndpointTable from "./components/EndpointTable.jsx";
import IntentBreakdown from "./components/IntentBreakdown.jsx";
import LatencyChart from "./components/LatencyChart.jsx";
import Sidebar from "./components/Sidebar.jsx";
import StatCard from "./components/StatCard.jsx";
import WorkspaceSettings from "./components/WorkspaceSettings.jsx";
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
    return <AuthScreen onSubmit={auth.authenticate} onDemo={auth.startDemo} />;
  }
  return <Dashboard {...auth} />;
}

function Dashboard({ token, user, landingWorkspaceId, logout }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeId, setActiveId] = useState(landingWorkspaceId);
  const [stats, setStats] = useState(null);
  const [apiStatus, setApiStatus] = useState("checking");
  const [activity, setActivity] = useState([]);
  const [files, setFiles] = useState([]);
  const presenceRef = useRef(null);
  const editorApi = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersVersion, setMembersVersion] = useState(0);

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
      // Stay on the current workspace unless it disappeared (deleted, or access removed).
      setActiveId((current) => (list.some((w) => w.id === current) ? current : list[0]?.id ?? null));
    } catch (err) {
      if (err.status === 401) logout();
    }
  }, [token, logout]);

  useEffect(() => {
    refreshWorkspaces();
    refreshStats();
    // Polling also picks up workspaces you were invited to while not connected to them.
    const timer = setInterval(() => {
      refreshStats();
      refreshWorkspaces();
    }, POLL_MS);
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
      } else if (event.type === "workspace_updated") {
        if (event.by !== user.username) log("info", `${event.by} updated the workspace settings`);
        refreshWorkspaces();
      } else if (event.type === "members_updated") {
        setMembersVersion((v) => v + 1);
      } else if (event.type === "workspace_deleted") {
        log("error", `${event.by} deleted this workspace`);
        setSettingsOpen(false);
        refreshWorkspaces();
      } else if (event.type === "message_deleted" && event.by !== user.username) {
        log("info", `${event.by} deleted a message`);
      } else if (event.type === "file_created") {
        setFiles((list) => (list.some((f) => f.id === event.file.id) ? list : [...list, event.file]));
        if (event.by !== user.username) log("info", `${event.by} created ${event.file.name}`);
      } else if (event.type === "file_renamed") {
        setFiles((list) => list.map((f) => (f.id === event.file.id ? event.file : f)));
        if (event.by !== user.username) log("info", `${event.by} renamed a file to ${event.file.name}`);
      } else if (event.type === "file_deleted") {
        setFiles((list) => list.filter((f) => f.id !== event.file_id));
        if (event.by !== user.username) log("info", `${event.by} deleted a file`);
      }
    },
    [log, user.username, refreshStats, refreshWorkspaces],
  );

  const handleForbidden = useCallback(() => {
    log("error", "You no longer have access to this workspace");
    setSettingsOpen(false);
    refreshWorkspaces();
  }, [log, refreshWorkspaces]);

  const socket = useWorkspaceSocket({
    workspaceId: activeId,
    token,
    onEvent: handleEvent,
    onUnauthorized: logout,
    onForbidden: handleForbidden,
  });

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    setFiles([]);
    api(`/api/workspaces/${activeId}/files`, { token })
      .then((list) => !cancelled && setFiles(list))
      .catch((err) => !cancelled && log("error", err.message));
    return () => {
      cancelled = true;
    };
  }, [activeId, token, log]);

  const filesUrl = `/api/workspaces/${activeId}/files`;
  const createFile = async (name) => {
    const file = await api(filesUrl, { token, method: "POST", body: { name } });
    setFiles((list) => (list.some((f) => f.id === file.id) ? list : [...list, file]));
    log("success", `Created ${file.name}`);
    return file;
  };
  const renameFile = async (id, name) => {
    const file = await api(`${filesUrl}/${id}`, { token, method: "PATCH", body: { name } });
    setFiles((list) => list.map((f) => (f.id === id ? file : f)));
  };
  const deleteFile = async (id) => {
    await api(`${filesUrl}/${id}`, { token, method: "DELETE" });
    setFiles((list) => list.filter((f) => f.id !== id));
  };

  useEffect(() => {
    presenceRef.current = null;
    if (activeWorkspace) log("info", `Opened #${activeWorkspace.name}`);
    // Only log when the workspace changes, not on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  async function deleteMessage(id) {
    try {
      await api(`/api/workspaces/${activeId}/messages/${id}`, { token, method: "DELETE" });
    } catch (err) {
      log("error", err.message);
    }
  }

  function insertCode(text) {
    if (editorApi.current?.insert(text)) {
      log("success", "Inserted code into the editor");
      document.getElementById("studio")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      log("error", "Open a file in the editor first");
    }
  }

  async function createWorkspace(name, isPrivate = false) {
    const ws = await api("/api/workspaces", { token, method: "POST", body: { name, is_private: isPrivate } });
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
        {user.is_guest && (
          <div className="guest-banner" role="status">
            <span>
              You're exploring with a temporary guest account. It's deleted after 24 hours, so sign up
              to keep your work.
            </span>
            <button type="button" className="button-ghost small" onClick={logout}>
              Sign up free
            </button>
          </div>
        )}

        <header className="page-header" id="overview">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>{user.is_guest ? "Welcome to the demo" : `Welcome back, ${user.username}`}</h1>
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

        <section className="studio" id="studio">
          <CodeEditor
            workspace={activeWorkspace}
            files={files}
            user={user}
            socket={socket}
            onCreate={createFile}
            onRename={renameFile}
            onDelete={deleteFile}
            apiRef={editorApi}
          />
          <div id="console">
            <ChatConsole
              workspace={activeWorkspace}
              user={user}
              socket={socket}
              canClear={Boolean(activeWorkspace) && [null, user.id].includes(activeWorkspace.owner_id)}
              onClear={clearHistory}
              onSettings={() => setSettingsOpen(true)}
              canModerate={activeWorkspace?.role === "owner"}
              onDeleteMessage={deleteMessage}
              onInsertCode={insertCode}
            />
          </div>
        </section>

        <section className="grid-charts" id="analytics">
          <LatencyChart data={stats?.recent_latencies ?? []} />
          <IntentBreakdown intents={stats?.intents ?? {}} />
        </section>

        <section className="grid-split" id="endpoints">
          <EndpointTable status={apiStatus} />
          <ActivityLog items={activity} />
        </section>

        <AboutProject />

        {settingsOpen && activeWorkspace && (
          <WorkspaceSettings
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            user={user}
            token={token}
            refreshKey={membersVersion}
            onClose={() => setSettingsOpen(false)}
            onChanged={refreshWorkspaces}
            onLeft={() => {
              setSettingsOpen(false);
              log("info", `You left #${activeWorkspace.name}`);
              refreshWorkspaces();
            }}
            onDeleted={() => {
              setSettingsOpen(false);
              log("success", `Deleted #${activeWorkspace.name}`);
              refreshWorkspaces();
            }}
          />
        )}

        <footer className="page-footer">
          <span>CodeTogether · React, FastAPI, WebSockets &amp; AI</span>
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            OpenAPI documentation ↗
          </a>
        </footer>
      </main>
    </div>
  );
}
