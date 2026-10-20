import React, { useEffect, useRef, useState } from "react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { yCollab } from "y-codemirror.next";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { AvatarStack } from "./Avatar.jsx";
import { fromBase64, toBase64 } from "../lib/base64.js";
import { avatarHue } from "../lib/format.js";
import { languageExtension, languageLabel } from "../lib/languages.js";
import { CodeRunner, runnableLanguage } from "../lib/runner.js";

const REMOTE = "remote"; // origin tag for changes that came from the server
const MAX_ASK_CHARS = 12000;
const MAX_OUTPUT_LINES = 500;

const editorTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13.5px", backgroundColor: "transparent" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid var(--line)" },
  ".cm-content": { padding: "12px 0" },
  "&.cm-focused": { outline: "none" },
});

function userColors(name) {
  const hue = avatarHue(name);
  return { color: `hsl(${hue} 80% 65%)`, colorLight: `hsla(${hue} 80% 65% / 0.22)` };
}

export default function CodeEditor({ workspace, files, user, socket, onCreate, onRename, onDelete, apiRef }) {
  const [activeId, setActiveId] = useState(null);
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState([]);
  const [newName, setNewName] = useState(null); // null = not creating
  const [renaming, setRenaming] = useState(null); // { id, name }
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("Explain this code");
  const [notice, setNotice] = useState("");
  const [output, setOutput] = useState([]); // [{ kind: "stdout" | "stderr" | "info", text }]
  const [run, setRun] = useState({ state: "idle", status: "", ms: 0 }); // idle | running | ok | error
  const [showOutput, setShowOutput] = useState(false);
  const runnerRef = useRef(null);

  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const docRef = useRef(null);
  const joinRef = useRef(null);
  const langRef = useRef(new Compartment());
  const { sendRaw, subscribe, status, send } = socket;

  const activeFile = files.find((f) => f.id === activeId);
  const runLanguage = activeFile ? runnableLanguage(activeFile.name) : null;

  useEffect(() => () => runnerRef.current?.dispose(), []);

  // Let other panels (e.g. "Insert into editor" on AI code blocks) write into the editor.
  useEffect(() => {
    if (!apiRef) return undefined;
    apiRef.current = {
      insert(text) {
        const view = viewRef.current;
        if (!view) return false;
        const { from, to } = view.state.selection.main;
        const before = from > 0 && view.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
        const insert = `${before}${text}${text.endsWith("\n") ? "" : "\n"}`;
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
        view.focus();
        return true;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  // Keep a valid file selected as the list changes (switching workspaces, deletes).
  useEffect(() => {
    if (!files.some((f) => f.id === activeId)) setActiveId(files[0]?.id ?? null);
  }, [files, activeId]);

  // One Yjs document + editor per open file.
  useEffect(() => {
    if (!activeId || !hostRef.current) return undefined;
    const fileId = activeId;
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("code");
    const awareness = new Awareness(ydoc);
    awareness.setLocalStateField("user", { name: user.username, ...userColors(user.username) });
    docRef.current = { ydoc, fileId, synced: false };
    setSynced(false);

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        extensions: [
          basicSetup,
          oneDark,
          editorTheme,
          langRef.current.of(languageExtension(files.find((f) => f.id === fileId)?.name)),
          yCollab(ytext, awareness, { undoManager: new Y.UndoManager(ytext) }),
          keymap.of([{ key: "Mod-Enter", run: () => (setAsking(true), true) }]),
        ],
      }),
    });
    viewRef.current = view;

    const onDocUpdate = (update, origin) => {
      if (origin !== REMOTE) sendRaw({ type: "doc_update", file_id: fileId, update: toBase64(update) });
    };
    const onAwarenessUpdate = ({ added, updated, removed }, origin) => {
      if (origin === "local") {
        const changed = [...added, ...updated, ...removed];
        sendRaw({ type: "awareness", file_id: fileId, update: toBase64(encodeAwarenessUpdate(awareness, changed)) });
      }
      const names = [...awareness.getStates().values()].map((s) => s.user?.name).filter(Boolean);
      setPeers([...new Set(names)]);
    };
    ydoc.on("update", onDocUpdate);
    awareness.on("update", onAwarenessUpdate);

    const unsubscribe = subscribe((event) => {
      if (event.file_id !== fileId) return;
      if (event.type === "doc_state") {
        Y.applyUpdate(ydoc, fromBase64(event.update), REMOTE);
        if (!docRef.current.synced) {
          docRef.current.synced = true;
          setSynced(true);
        }
        // Announce our cursor to people already in the file.
        sendRaw({
          type: "awareness",
          file_id: fileId,
          update: toBase64(encodeAwarenessUpdate(awareness, [ydoc.clientID])),
        });
      } else if (event.type === "doc_update") {
        Y.applyUpdate(ydoc, fromBase64(event.update), REMOTE);
      } else if (event.type === "awareness") {
        applyAwarenessUpdate(awareness, fromBase64(event.update), REMOTE);
      }
    });

    joinRef.current = () => {
      sendRaw({ type: "doc_join", file_id: fileId });
      // After a reconnect, push anything typed while offline; CRDT merging makes this safe.
      if (docRef.current?.synced) {
        sendRaw({ type: "doc_update", file_id: fileId, update: toBase64(Y.encodeStateAsUpdate(ydoc)) });
      }
    };
    joinRef.current();

    return () => {
      removeAwarenessStates(awareness, [ydoc.clientID], "local");
      unsubscribe();
      ydoc.off("update", onDocUpdate);
      awareness.off("update", onAwarenessUpdate);
      awareness.destroy();
      view.destroy();
      ydoc.destroy();
      viewRef.current = null;
      docRef.current = null;
      joinRef.current = null;
      setPeers([]);
    };
    // Recreate only when switching files; renames are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, user.username, sendRaw, subscribe]);

  // Re-join after the socket reconnects.
  useEffect(() => {
    if (status === "open") joinRef.current?.();
  }, [status]);

  // Switch syntax highlighting when the file is renamed to another extension.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: langRef.current.reconfigure(languageExtension(activeFile?.name)) });
  }, [activeFile?.name]);

  function flash(text) {
    setNotice(text);
    setTimeout(() => setNotice(""), 2500);
  }

  function selectedCode() {
    const view = viewRef.current;
    if (!view) return { content: "", partial: false };
    const { from, to } = view.state.selection.main;
    const partial = from !== to;
    const content = partial ? view.state.sliceDoc(from, to) : view.state.doc.toString();
    return { content, partial };
  }

  function askAi(e) {
    e.preventDefault();
    const { content, partial } = selectedCode();
    if (!content.trim()) return flash("The file is empty. Write some code first.");
    if (content.length > MAX_ASK_CHARS) return flash("That's too much code. Select a smaller part.");
    const text = question.trim() || "Explain this code";
    const label = partial ? `${activeFile.name} (selection)` : activeFile.name;
    if (send(text, true, { file: label, content })) {
      setAsking(false);
      flash("Sent to the AI. The answer appears in the chat.");
    } else {
      flash("Not connected. Try again in a moment.");
    }
  }

  async function runCode() {
    if (!runLanguage || !viewRef.current) return;
    if (!runnerRef.current) runnerRef.current = new CodeRunner();
    const code = viewRef.current.state.doc.toString();
    setOutput([]);
    setShowOutput(true);
    setRun({ state: "running", status: "Starting…", ms: 0 });
    let started = performance.now();
    const ok = await runnerRef.current.run(runLanguage, code, (event) => {
      if (event.type === "status") setRun((r) => ({ ...r, status: event.text }));
      else if (event.type === "started") {
        started = performance.now();
        setRun((r) => ({ ...r, status: "Running…" }));
      } else {
        setOutput((lines) => [...lines, { kind: event.type, text: event.text }].slice(-MAX_OUTPUT_LINES));
      }
    });
    setRun({ state: ok ? "ok" : "error", status: "", ms: Math.round(performance.now() - started) });
  }

  function askAiToFix() {
    const errorText = output.filter((l) => l.kind === "stderr").map((l) => l.text).join("\n").slice(-1500);
    const code = viewRef.current?.state.doc.toString() ?? "";
    const message = `My code fails with this error:\n\n\`\`\`\n${errorText}\n\`\`\`\n\nWhat's wrong and how do I fix it?`;
    if (send(message, true, { file: activeFile.name, content: code.slice(0, MAX_ASK_CHARS) })) {
      flash("Sent to the AI. The answer appears in the chat.");
    } else {
      flash("Not connected. Try again in a moment.");
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(viewRef.current?.state.doc.toString() ?? "");
      flash("Copied to clipboard");
    } catch {
      flash("Copy failed. Select the text and press Ctrl+C.");
    }
  }

  function download() {
    const blob = new Blob([viewRef.current?.state.doc.toString() ?? ""], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeFile?.name ?? "code.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitNew(e) {
    e.preventDefault();
    try {
      const file = await onCreate(newName.trim());
      setNewName(null);
      setActiveId(file.id);
    } catch (err) {
      flash(err.message);
    }
  }

  async function submitRename(e) {
    e.preventDefault();
    try {
      if (renaming.name.trim() !== files.find((f) => f.id === renaming.id)?.name) {
        await onRename(renaming.id, renaming.name.trim());
      }
      setRenaming(null);
    } catch (err) {
      flash(err.message);
    }
  }

  async function remove(file) {
    if (!window.confirm(`Delete ${file.name}? This can't be undone.`)) return;
    try {
      await onDelete(file.id);
    } catch (err) {
      flash(err.message);
    }
  }

  return (
    <article className="card editor-card">
      <div className="card-header">
        <div>
          <h2>Code editor</h2>
          <p>Edit together in real time. Everyone in #{workspace?.name ?? "…"} sees changes live.</p>
        </div>
        <AvatarStack names={peers} />
      </div>

      <div className="file-tabs" role="tablist" aria-label="Files">
        {files.map((f) =>
          renaming?.id === f.id ? (
            <form key={f.id} onSubmit={submitRename} className="tab-form">
              <input
                autoFocus
                value={renaming.name}
                maxLength={64}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                aria-label="New file name"
              />
            </form>
          ) : (
            <div key={f.id} className={`file-tab ${f.id === activeId ? "active" : ""}`}>
              <button
                role="tab"
                aria-selected={f.id === activeId}
                onClick={() => setActiveId(f.id)}
                onDoubleClick={() => setRenaming({ id: f.id, name: f.name })}
                title="Double-click to rename"
              >
                {f.name}
              </button>
              <button className="tab-close" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}>
                ×
              </button>
            </div>
          ),
        )}
        {newName === null ? (
          <button className="file-add" onClick={() => setNewName("")} aria-label="New file">
            + New file
          </button>
        ) : (
          <form onSubmit={submitNew} className="tab-form">
            <input
              autoFocus
              value={newName}
              maxLength={64}
              placeholder="name.py"
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => !newName.trim() && setNewName(null)}
              onKeyDown={(e) => e.key === "Escape" && setNewName(null)}
              aria-label="File name"
            />
          </form>
        )}
      </div>

      <div className="editor-shell">
        {files.length === 0 ? (
          <div className="chart-empty">No files yet. Create one with “+ New file”.</div>
        ) : (
          <>
            <div ref={hostRef} className="editor-host" />
            {!synced && <div className="editor-loading">Loading {activeFile?.name}…</div>}
          </>
        )}
      </div>

      {showOutput && (
        <section className={`output-panel ${run.state}`} aria-label="Program output">
          <div className="output-head">
            <span>
              <strong>Output</strong>
              <span className="meta">
                {run.state === "running" && ` · ${run.status}`}
                {run.state === "ok" && ` · Finished in ${(run.ms / 1000).toFixed(2)}s`}
                {run.state === "error" && " · Failed"}
              </span>
            </span>
            <div className="editor-actions">
              {run.state === "error" && (
                <button className="button-primary small" onClick={askAiToFix} disabled={status !== "open"}>
                  ✦ Ask AI to fix
                </button>
              )}
              <button className="button-ghost small" onClick={() => setOutput([])} disabled={!output.length}>
                Clear
              </button>
              <button className="icon-button" onClick={() => setShowOutput(false)} aria-label="Hide output">×</button>
            </div>
          </div>
          <pre className="output-body" aria-live="polite">
            {output.length === 0 && run.state !== "running" && <span className="muted">(no output)</span>}
            {output.map((line, i) => (
              <span key={i} className={line.kind}>{line.text}{"\n"}</span>
            ))}
            {run.state === "running" && <span className="cursor-blink">▍</span>}
          </pre>
        </section>
      )}

      {asking && (
        <form className="ask-bar" onSubmit={askAi}>
          <input
            autoFocus
            value={question}
            maxLength={500}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
            aria-label="Question for the AI"
          />
          <button type="submit" className="button-primary">Send</button>
          <button type="button" className="button-ghost small" onClick={() => setAsking(false)}>Cancel</button>
        </form>
      )}

      <div className="editor-footer">
        <span className="meta">
          {activeFile ? languageLabel(activeFile.name) : "—"} · {synced ? "Synced" : "Connecting"}
          {notice && <span className="editor-notice"> · {notice}</span>}
        </span>
        <div className="editor-actions">
          {run.state === "running" ? (
            <button className="button-danger small" onClick={() => runnerRef.current?.stop()}>■ Stop</button>
          ) : (
            <button
              className="button-run small"
              onClick={runCode}
              disabled={!runLanguage || !synced}
              title={runLanguage ? `Run this ${runLanguage === "python" ? "Python" : "JavaScript"} file in your browser` : "Only .py and .js files can be run"}
            >
              ▶ Run
            </button>
          )}
          <button className="button-ghost small" onClick={copyCode} disabled={!activeFile}>Copy</button>
          <button className="button-ghost small" onClick={download} disabled={!activeFile}>Download</button>
          <button
            className="button-primary small"
            onClick={() => setAsking((v) => !v)}
            disabled={!activeFile || status !== "open"}
            title="Ask the AI about the selected code, or the whole file (Ctrl+Enter)"
          >
            ✦ Ask AI
          </button>
        </div>
      </div>
    </article>
  );
}
