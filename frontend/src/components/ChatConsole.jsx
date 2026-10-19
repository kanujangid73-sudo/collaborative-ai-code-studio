import React, { useEffect, useRef, useState } from "react";

const SUGGESTIONS = [
  "Create a user signup endpoint",
  "Help me fix a login bug",
  "Write tests for the API",
  "How should I deploy this?",
];

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ChatConsole({ messages, onSend, onClear, isSending, error, disabled }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, isSending]);

  async function submit(value) {
    const trimmed = value.trim();
    if (!trimmed || isSending) return;
    if (await onSend(trimmed)) setText("");
  }

  return (
    <article className="card console">
      <div className="card-header">
        <div>
          <h2>AI Console</h2>
          <p>Messages go to <code>POST /api/message</code> and stay in history.</p>
        </div>
        <button className="button-ghost small" onClick={onClear} disabled={!messages.length}>
          Clear
        </button>
      </div>

      <div className="message-list" ref={listRef} aria-live="polite">
        {!messages.length && !isSending && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">❯_</span>
            <p>No messages yet. Try one of these:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => submit(s)} disabled={disabled}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="exchange">
            <div className="bubble user">
              <p>{m.message}</p>
              <span className="meta">You · {formatTime(m.created_at)}</span>
            </div>
            <div className="bubble bot">
              <p>{m.reply}</p>
              <span className="meta">
                <span className={`intent-tag ${m.intent}`}>{m.intent}</span>
                {m.latency != null && <> · {m.latency} ms</>}
              </span>
            </div>
          </div>
        ))}

        {isSending && (
          <div className="bubble bot typing" aria-label="Waiting for reply">
            <span /><span /><span />
          </div>
        )}
      </div>

      {error && (
        <div className="alert" role="alert">
          <strong>Could not connect.</strong> {error}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor="message" className="sr-only">Your message</label>
        <input
          id="message"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder={disabled ? "Backend is offline…" : "Ask the studio something…"}
          autoComplete="off"
        />
        <button type="submit" className="button-primary" disabled={!text.trim() || isSending}>
          {isSending ? "Sending…" : "Send"} <span aria-hidden="true">→</span>
        </button>
      </form>
    </article>
  );
}
