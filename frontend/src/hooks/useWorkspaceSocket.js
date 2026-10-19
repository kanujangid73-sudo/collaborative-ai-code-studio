import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "../config.js";
import { api } from "../lib/api.js";
import { mergeMessages } from "../lib/format.js";

const TYPING_TTL_MS = 3000;
const TYPING_THROTTLE_MS = 2000;

/**
 * Live connection to one workspace: history, streaming AI replies,
 * presence and typing indicators. Reconnects with backoff.
 */
export function useWorkspaceSocket({ workspaceId, token, onEvent, onUnauthorized }) {
  const [messages, setMessages] = useState([]);
  const [streams, setStreams] = useState({}); // stream_id -> partial text
  const [presence, setPresence] = useState([]);
  const [typing, setTyping] = useState({}); // username -> expiry timestamp
  const [status, setStatus] = useState("connecting");
  const [loadError, setLoadError] = useState("");

  const socketRef = useRef(null);
  const lastTypingSent = useRef(0);
  const handlers = useRef({ onEvent, onUnauthorized });
  handlers.current = { onEvent, onUnauthorized };

  useEffect(() => {
    if (!workspaceId || !token) return undefined;
    let closedByUs = false;
    let retry = 0;
    let retryTimer;

    setMessages([]);
    setStreams({});
    setPresence([]);
    setTyping({});
    setLoadError("");

    api(`/api/workspaces/${workspaceId}/messages`, { token })
      .then((history) => setMessages((current) => mergeMessages(history, current)))
      .catch((err) => setLoadError(err.message));

    function handle(event) {
      switch (event.type) {
        case "presence":
          setPresence(event.users);
          break;
        case "message":
          setMessages((current) => mergeMessages(current, [event.message]));
          setTyping(({ [event.message.author]: _, ...rest }) => rest);
          break;
        case "typing":
          setTyping((current) => ({ ...current, [event.user]: Date.now() + TYPING_TTL_MS }));
          break;
        case "ai_start":
          setStreams((current) => ({ ...current, [event.stream_id]: "" }));
          break;
        case "ai_delta":
          setStreams((current) => ({ ...current, [event.stream_id]: (current[event.stream_id] ?? "") + event.text }));
          break;
        case "ai_done":
          setStreams(({ [event.stream_id]: _, ...rest }) => rest);
          setMessages((current) => mergeMessages(current, [event.message]));
          break;
        case "cleared":
          setMessages([]);
          break;
        default:
          break;
      }
      handlers.current.onEvent?.(event);
    }

    function connect() {
      setStatus("connecting");
      const ws = new WebSocket(`${WS_URL}/ws/workspaces/${workspaceId}?token=${encodeURIComponent(token)}`);
      socketRef.current = ws;
      ws.onopen = () => {
        retry = 0;
        setStatus("open");
      };
      ws.onmessage = (e) => {
        try {
          handle(JSON.parse(e.data));
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (e) => {
        if (socketRef.current === ws) socketRef.current = null;
        setStreams({});
        if (closedByUs) return;
        if (e.code === 4401) {
          setStatus("closed");
          handlers.current.onUnauthorized?.();
          return;
        }
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      };
    }

    connect();
    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [workspaceId, token]);

  // Expire typing indicators.
  useEffect(() => {
    if (!Object.keys(typing).length) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setTyping((current) => Object.fromEntries(Object.entries(current).filter(([, until]) => until > now)));
    }, 1000);
    return () => clearInterval(timer);
  }, [typing]);

  const send = useCallback((content, askAi) => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "message", content, ask_ai: askAi }));
    return true;
  }, []);

  const sendTyping = useCallback(() => {
    const ws = socketRef.current;
    const now = Date.now();
    if (!ws || ws.readyState !== WebSocket.OPEN || now - lastTypingSent.current < TYPING_THROTTLE_MS) return;
    lastTypingSent.current = now;
    ws.send(JSON.stringify({ type: "typing" }));
  }, []);

  return {
    messages,
    streams,
    presence,
    typingUsers: Object.keys(typing),
    status,
    loadError,
    send,
    sendTyping,
  };
}
