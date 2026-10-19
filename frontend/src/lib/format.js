export function formatUptime(seconds) {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function initials(name = "") {
  const parts = name.split(/[_\s]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

// Stable hue per username so each person keeps the same avatar color.
export function avatarHue(name = "") {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

// Merge message lists by id, keeping chronological order.
export function mergeMessages(...lists) {
  const byId = new Map();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export function modelLabel(model) {
  if (!model) return "";
  if (model === "offline-assistant") return "Offline assistant";
  if (!model.startsWith("claude-")) return `${model} · local`; // Ollama model
  return model
    .replace(/^claude-/, "Claude ")
    .replace(/-(\d+)-(\d+)$/, " $1.$2")
    .replace(/-(\d+)$/, " $1")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
