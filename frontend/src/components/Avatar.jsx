import React from "react";
import { avatarHue, initials } from "../lib/format.js";

export default function Avatar({ name, size = 32, ai = false }) {
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (!ai) style["--avatar-hue"] = avatarHue(name);
  return (
    <span className={`avatar ${ai ? "ai" : ""}`} style={style} title={ai ? "AI" : name} aria-hidden="true">
      {ai ? "AI" : initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="avatar-stack" aria-label={`Online: ${names.join(", ") || "nobody"}`}>
      {shown.map((n) => <Avatar key={n} name={n} size={30} />)}
      {extra > 0 && <span className="avatar more">+{extra}</span>}
    </div>
  );
}
