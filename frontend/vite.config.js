import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The code runner is a module worker (required by Pyodide).
  worker: { format: "es" },
  build: {
    rollupOptions: {
      output: {
        // Keep large libraries in their own cacheable chunks.
        manualChunks: {
          react: ["react", "react-dom"],
          markdown: ["react-markdown", "remark-gfm", "rehype-highlight"],
          editor: ["codemirror", "@codemirror/state", "@codemirror/view", "yjs", "y-codemirror.next", "y-protocols/awareness"],
        },
      },
    },
  },
});
