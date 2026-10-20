import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";

const LANGUAGES = {
  py: { label: "Python", load: () => python() },
  js: { label: "JavaScript", load: () => javascript() },
  jsx: { label: "JavaScript (JSX)", load: () => javascript({ jsx: true }) },
  ts: { label: "TypeScript", load: () => javascript({ typescript: true }) },
  tsx: { label: "TypeScript (TSX)", load: () => javascript({ jsx: true, typescript: true }) },
  html: { label: "HTML", load: () => html() },
  css: { label: "CSS", load: () => css() },
  json: { label: "JSON", load: () => json() },
  md: { label: "Markdown", load: () => markdown() },
};

export function extensionOf(name = "") {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function languageLabel(name) {
  return LANGUAGES[extensionOf(name)]?.label ?? "Plain text";
}

export function languageExtension(name) {
  return LANGUAGES[extensionOf(name)]?.load() ?? [];
}
