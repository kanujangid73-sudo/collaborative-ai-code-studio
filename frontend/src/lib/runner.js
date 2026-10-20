import { extensionOf } from "./languages.js";

const RUNNABLE = { py: "python", js: "javascript", mjs: "javascript" };
export const RUN_TIMEOUT_MS = 15000;

export function runnableLanguage(fileName) {
  return RUNNABLE[extensionOf(fileName)] ?? null;
}

/**
 * Keeps one worker alive between runs (so Python only loads once) and kills it
 * on Stop or timeout. The timeout starts when the code begins executing, so the
 * first-time Python download doesn't count against it.
 */
export class CodeRunner {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.active = null; // { id, onEvent, resolve, timer }
  }

  _ensureWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/runner.worker.js", import.meta.url), { type: "module" });
      this.worker.onmessage = ({ data }) => this._handle(data);
      this.worker.onerror = (e) => {
        this._handle({ id: this.active?.id, type: "stderr", text: e.message || "The runner crashed." });
        this._finish(false);
      };
    }
    return this.worker;
  }

  _handle(event) {
    const active = this.active;
    if (!active || event.id !== active.id) return;
    if (event.type === "started") {
      active.timer = setTimeout(() => {
        active.onEvent({ type: "stderr", text: `Stopped: the code ran longer than ${RUN_TIMEOUT_MS / 1000} seconds.` });
        this._kill();
        this._finish(false);
      }, RUN_TIMEOUT_MS);
    }
    if (event.type === "done") this._finish(event.ok);
    else active.onEvent(event);
  }

  _finish(ok) {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timer);
    this.active = null;
    active.resolve(ok);
  }

  _kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Runs code; resolves to true on success. */
  run(language, code, onEvent) {
    this.stop();
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.active = { id, onEvent, resolve, timer: null };
      this._ensureWorker().postMessage({ id, language, code });
    });
  }

  stop() {
    if (!this.active) return;
    this.active.onEvent({ type: "stderr", text: "Stopped." });
    this._kill();
    this._finish(false);
  }

  dispose() {
    this.stop();
    this._kill();
  }
}
