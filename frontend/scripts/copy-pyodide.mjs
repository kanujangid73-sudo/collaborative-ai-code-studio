// Copies the Pyodide runtime into public/ so Python runs from our own origin,
// without depending on a CDN the user's network or browser may block.
// Runs automatically before `npm run dev` and `npm run build`.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pyodide/package.json"));
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "pyodide");
const FILES = ["pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

mkdirSync(target, { recursive: true });
let copied = 0;
for (const file of FILES) {
  const from = join(source, file);
  const to = join(target, file);
  if (!existsSync(to) || statSync(to).size !== statSync(from).size) {
    copyFileSync(from, to);
    copied++;
  }
}
console.log(`Pyodide runtime ready in public/pyodide (${copied} file(s) updated)`);
