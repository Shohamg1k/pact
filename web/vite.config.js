import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PACT_PORT lets several worktrees run their own daemon+web pair side by side without
// fighting over 4300/5173 — the proxy target follows whatever the daemon was started on.
const daemonPort = process.env.PACT_PORT || 4300;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PACT_WEB_PORT) || 5173,
    strictPort: false,
    proxy: { '/api': `http://127.0.0.1:${daemonPort}` },
  },
});
