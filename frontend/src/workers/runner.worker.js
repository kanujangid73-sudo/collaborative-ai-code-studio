/* Runs user code off the main thread so a slow or infinite loop can't freeze the page.
 * Python runs on Pyodide (CPython compiled to WebAssembly). The runtime is served by this app
 * from /pyodide/ (copied there by scripts/copy-pyodide.mjs), with the CDN as a fallback.
 * Extra packages such as numpy are downloaded from the CDN on demand.
 *
 * Main -> worker: { id, language: "python" | "javascript", code }
 * Worker -> main: { id, type: "status" | "started" | "stdout" | "stderr" | "done", text?, ok? }
 */

const CDN_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const LOCAL_URL = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href;
let pyodidePromise = null;
let currentId = null;

const post = (type, extra = {}) => self.postMessage({ id: currentId, type, ...extra });

// Pyodide only runs in module workers, so it is loaded with import(), not importScripts().
async function loadRuntime() {
  const failures = [];
  for (const base of [LOCAL_URL, CDN_URL]) {
    try {
      const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
      return { loadPyodide, indexURL: base };
    } catch (err) {
      failures.push(`${base}: ${err?.message ?? err}`);
    }
  }
  throw new Error(
    `Could not load the Python runtime. Check your internet connection, or disable ad blockers for this site.\n${failures.join("\n")}`,
  );
}

function loadPython() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      post("status", { text: "Loading Python (first run takes a few seconds)…" });
      const { loadPyodide, indexURL } = await loadRuntime();
      const pyodide = await loadPyodide({ indexURL, packageBaseUrl: CDN_URL });
      pyodide.setStdout({ batched: (line) => post("stdout", { text: line }) });
      pyodide.setStderr({ batched: (line) => post("stderr", { text: line }) });
      pyodide.setStdin({ stdin: () => null }); // input() gets end-of-file
      return pyodide;
    })();
    pyodidePromise.catch(() => {
      pyodidePromise = null; // allow a retry after a network failure
    });
  }
  return pyodidePromise;
}

async function runPython(code) {
  const pyodide = await loadPython();
  await pyodide.loadPackagesFromImports(code, {
    messageCallback: (msg) => post("status", { text: msg }),
    errorCallback: (msg) => post("stderr", { text: msg }),
  });
  post("started");
  const globals = pyodide.globals.get("dict")();
  try {
    await pyodide.runPythonAsync(code, { globals, filename: "main.py" });
  } finally {
    globals.destroy();
  }
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || String(value);
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

async function runJavaScript(code) {
  const write = (type) => (...args) => post(type, { text: args.map(formatValue).join(" ") });
  const sandboxConsole = {
    log: write("stdout"), info: write("stdout"), debug: write("stdout"), table: write("stdout"),
    warn: write("stderr"), error: write("stderr"),
  };
  post("started");
  // eslint-disable-next-line no-new-func
  const fn = new Function("console", `"use strict";\nreturn (async () => {\n${code}\n})();`);
  await fn(sandboxConsole);
}

// Drop Pyodide's internal frames so the traceback starts at the user's code.
function cleanTraceback(text) {
  const start = text.indexOf('  File "main.py"');
  return text.startsWith("Traceback") && start > 0 ? `Traceback (most recent call last):\n${text.slice(start)}` : text;
}

self.onmessage = async ({ data }) => {
  currentId = data.id;
  try {
    if (data.language === "python") await runPython(data.code);
    else await runJavaScript(data.code);
    post("done", { ok: true });
  } catch (err) {
    // Python errors arrive with the full traceback in err.message.
    post("stderr", { text: cleanTraceback(String(err?.message ?? err).trimEnd()) });
    post("done", { ok: false });
  }
};
