import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// PACT_PORT lets several worktrees run their own daemon+web pair side by side without
// fighting over 4300/5173 — the proxy target follows whatever the daemon was started on.
const daemonPort = process.env.PACT_PORT || 4300;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // npm hoists monaco-editor to the workspace ROOT node_modules, and the bundler
      // does not walk up for `?worker`-suffixed ids — without this alias the worker
      // imports fail to resolve and Monaco initialises with null workers.
      'monaco-editor': path.resolve(here, '../node_modules/monaco-editor'),
    },
  },
  // Monaco ships its own ESM worker entry points. Pre-bundling rewrites those into
  // plain deps, so the `?worker` imports lose their default export and Monaco starts
  // with null workers — excluding it hands the worker files to Vite's worker plugin.
  optimizeDeps: { exclude: ['monaco-editor', '@monaco-editor/react'] },
  worker: { format: 'es' },
  server: {
    port: Number(process.env.PACT_WEB_PORT) || 5173,
    strictPort: false,
    proxy: { '/api': `http://127.0.0.1:${daemonPort}` },
  },
});
