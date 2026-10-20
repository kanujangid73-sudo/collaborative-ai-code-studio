import React, { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import Markdown from "./Markdown.jsx";
import { formatTime, modelLabel } from "../lib/format.js";

const SUGGESTIONS = [
  "Write a FastAPI endpoint for user signup",
  "Why does my React useEffect run twice?",
  "Write pytest tests for a login route",
  "How should I deploy this app with Docker?",
];

const STATUS_TEXT = {
  open: "Live",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

function typingText(users) {
  if (users.length === 1) return `${users[0]} is typing…`;
  if (users.length === 2) return `${users[0]} and ${users[1]} are typing…`;
  return `${users.length} people are typing…`;
}

function quotaText(quota) {
  if (!quota?.enabled) return null;
  if (quota.remaining > 0) return `${quota.remaining}/${quota.limit} AI replies left this hour`;
  return `AI limit reached · resets in ~${Math.max(1, Math.round(quota.reset_seconds / 60))} min`;
}

export default function ChatConsole({
  workspace, user, socket, canClear, onClear, onSettings, canModerate, onDeleteMessage, onInsertCode,
}) {
  const {
    messages, streams, typingUsers, status, loadError, send, sendTyping, quota, notice, dismissNotice, regenerate,
  } = socket;
  const [text, setText] = useState("");
  const [askAi, setAskAi] = useState(true);
  const [sendError, setSendError] = useState("");
  const listRef = useRef(null);
  const streamEntries = Object.entries(streams);
  const others = typingUsers.filter((u) => u !== user.username);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Only auto-scroll when the user is already near the bottom.
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages, streams, others.length]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [workspace?.id]);

  // Server notices (rate limits, errors) disappear on their own.
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(dismissNotice, 6000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = lastMessage?.role === "assistant" && !streamEntries.length && status === "open";
  const quotaLabel = quotaText(quota);

  function submit(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (send(trimmed, askAi)) {
      setText("");
      setSendError("");
    } else {
      setSendError("Not connected yet. Your message wasn't sent.");
    }
  }

  return (
    <article className="card console">
      <div className="card-header">
        <div>
          <h2>
            <span className="hash" aria-hidden="true">{workspace?.is_private ? "🔒" : "#"}</span>{" "}
            {workspace?.name ?? "Workspace"}
          </h2>
          <p>{workspace?.description || "Shared, real-time conversation with your team and the AI."}</p>
        </div>
        <div className="console-actions">
          <span className={`conn ${status}`}>
            <span className="status-dot" /> {STATUS_TEXT[status]}
          </span>
          {canClear && (
            <button className="button-ghost small" onClick={onClear} disabled={!messages.length}>
              Clear
            </button>
          )}
          <button className="icon-button" onClick={onSettings} aria-label="Workspace settings" title="Workspace settings">
            ⚙
          </button>
        </div>
      </div>

      <div className="message-list" ref={listRef} aria-live="polite">
        {loadError && <div className="alert">{loadError}</div>}

        {!messages.length && !streamEntries.length && !loadError && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">❯_</span>
            <p>This workspace is quiet. Start the conversation:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => submit(s)} disabled={status !== "open"}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const mine = m.role === "user" && m.author === user.username;
          const ai = m.role === "assistant";
          const deletable = mine || canModerate;
          const isLast = m.id === lastMessage?.id;
          return (
            <div key={m.id} className={`msg ${mine ? "mine" : ""} ${ai ? "ai" : ""}`}>
              {!mine && <Avatar name={m.author} ai={ai} size={30} />}
              <div className="bubble">
                <div className="bubble-head">
                  <strong>{mine ? "You" : m.author}</strong>
                  <span className="meta">{formatTime(m.created_at)}</span>
                </div>
                {ai || m.content.includes("```") ? (
                  <Markdown onInsertCode={onInsertCode}>{m.content}</Markdown>
                ) : (
                  <p className="plain">{m.content}</p>
                )}
                {ai && (
                  <span className="meta">
                    <span className="intent-tag">{m.intent}</span> · {modelLabel(m.model)}
                    {m.latency_ms != null && <> · {(m.latency_ms / 1000).toFixed(1)}s</>}
                  </span>
                )}
                {(deletable || (ai && isLast)) && (
                  <div className="msg-actions">
                    {ai && isLast && (
                      <button onClick={regenerate} disabled={!canRegenerate} title="Ask the AI to answer again">
                        ↻ Regenerate
                      </button>
                    )}
                    {deletable && (
                      <button
                        onClick={() => window.confirm("Delete this message?") && onDeleteMessage(m.id)}
                        title="Delete message"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {streamEntries.map(([id, partial]) => (
          <div key={id} className="msg ai">
            <Avatar ai size={30} />
            <div className="bubble streaming">
              <div className="bubble-head">
                <strong>AI</strong>
                <span className="meta">thinking…</span>
              </div>
              {partial ? (
                <Markdown>{partial}</Markdown>
              ) : (
                <div className="typing-dots" aria-label="AI is thinking"><span /><span /><span /></div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="typing-line" aria-live="polite">{others.length > 0 && typingText(others)}</div>

      {sendError && <div className="alert" role="alert">{sendError}</div>}
      {notice && (
        <div className={`alert ${notice.code === "ai_limit" ? "warn" : ""}`} role="alert">
          {notice.text}
          <button className="alert-close" onClick={dismissNotice} aria-label="Dismiss">×</button>
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor="message" className="sr-only">Message</label>
        <textarea
          id="message"
          rows={1}
          value={text}
          maxLength={4000}
          onChange={(e) => {
            setText(e.target.value);
            sendTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder={status === "open" ? "Message the team… (Shift+Enter for a new line)" : "Connecting…"}
        />
        <div className="composer-actions">
          <label className="toggle" title="When on, the AI replies to your message">
            <input type="checkbox" checked={askAi} onChange={(e) => setAskAi(e.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span /></span>
            Ask AI
          </label>
          {quotaLabel && askAi && (
            <span className={`quota ${quota.remaining === 0 ? "empty" : ""}`}>{quotaLabel}</span>
          )}
          <button type="submit" className="button-primary" disabled={!text.trim() || status !== "open"}>
            Send <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </article>
  );
}
