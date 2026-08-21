// Renders the Frontend agent's manifest as a REAL running page (not a screenshot, not a
// mock): the modules are written to disk, bundled with esbuild, and served as a single
// self-contained document the workbench shows inside an iframe with browser chrome.
//
// Two things make this work without an `npm install` per preview:
//   1. react/react-dom are resolved from PACT's OWN web workspace via esbuild's
//      nodePaths — the generated app declares them as dependencies, but we already have
//      a copy, so a preview costs a ~50ms bundle instead of a 60s install.
//   2. The generated app calls the backend with absolute paths (`fetch('/api/books')`).
//      Those would hit the PACT daemon, not the generated server, so a small fetch shim
//      (injected, not written into the user's code) rewrites them onto the proxy route
//      below, which forwards to whatever port the runner booted the backend on.
//
// Imports no model client — deterministic bundling only.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatDir, getArtifact } from '../kernel/chats.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_NODE_MODULES = path.resolve(HERE, '../../web/node_modules');

const previewDir = (chatId) => path.join(chatDir(chatId), 'frontend-preview');

/** Cache keyed by the frontend artifact's identity, so re-opening the tab is instant but
 * a regenerated frontend always rebuilds. */
const bundles = new Map(); // chatId -> { key, js, error }

function manifestKey(manifest) {
  return `${manifest.modules.length}:${manifest.modules.reduce((n, m) => n + m.code.length, 0)}`;
}

async function writeSources(dir, manifest) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const m of manifest.modules) {
    const file = path.join(dir, m.path);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, m.code, 'utf8');
  }
}

/** The generated entry usually mounts into `#root`; if its entry is missing we still
 * render something useful rather than a blank frame. */
function resolveEntry(dir, manifest) {
  const candidates = [manifest.entry, 'src/main.jsx', 'src/index.jsx', 'src/App.jsx'].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(path.join(dir, c))) return c;
  }
  return null;
}

export async function buildFrontendBundle(chatId) {
  const manifest = await getArtifact(chatId, 'frontend');
  if (!manifest) return { error: 'The Frontend agent has not run for this chat yet.' };

  const key = manifestKey(manifest);
  const cached = bundles.get(chatId);
  if (cached && cached.key === key) return cached;

  const dir = previewDir(chatId);
  await writeSources(dir, manifest);
  const entry = resolveEntry(dir, manifest);
  if (!entry) {
    const result = { key, error: `No entry module found (looked for ${manifest.entry ?? 'src/main.jsx'}).` };
    bundles.set(chatId, result);
    return result;
  }

  try {
    const esbuild = await import('esbuild');
    const out = await esbuild.build({
      entryPoints: [path.join(dir, entry)],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      // Generated code is frequently .js containing JSX — treat both as JSX rather than
      // failing the whole preview on a file-extension technicality.
      loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'css' },
      nodePaths: [WEB_NODE_MODULES],
      define: { 'process.env.NODE_ENV': '"development"' },
      logLevel: 'silent',
    });
    const js = out.outputFiles.map((f) => f.text).join('\n');
    const result = { key, js, error: null };
    bundles.set(chatId, result);
    return result;
  } catch (e) {
    const messages = (e.errors ?? []).map((x) => `${x.location?.file ?? ''}:${x.location?.line ?? ''} ${x.text}`).join('\n');
    const result = { key, error: messages || e.message };
    bundles.set(chatId, result);
    return result;
  }
}

/** Rewrites the app's own API calls onto the proxy route so they reach the generated
 * backend instead of the PACT daemon. Injected into the preview document only — the
 * user's generated source on disk is never modified. */
function apiShim(chatId) {
  return `
<script>
(function () {
  var BASE = ${JSON.stringify(`/api/chats/${chatId}/frontend-preview/proxy`)};
  function rewrite(url) {
    try {
      if (typeof url !== 'string') return url;
      if (url.startsWith('/')) return BASE + url;
      return url;
    } catch (e) { return url; }
  }
  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string') return nativeFetch(rewrite(input), init);
    if (input && input.url) return nativeFetch(new Request(rewrite(input.url), input), init);
    return nativeFetch(input, init);
  };
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    return open.apply(this, [m, rewrite(u)].concat([].slice.call(arguments, 2)));
  };
  window.addEventListener('error', function (e) {
    parent.postMessage({ __pactPreview: 'error', message: String(e.message || e.error) }, '*');
  });
})();
</script>`;
}

export function previewDocument(chatId, js, error) {
  if (error) {
    return `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;font:13px/1.6 ui-monospace,Menlo,Consolas,monospace;background:#1e1e1e;color:#f48771;padding:20px}
      h1{font:600 13px system-ui;color:#cccccc;margin:0 0 10px}
      pre{white-space:pre-wrap;word-break:break-word;margin:0}
    </style><h1>The generated frontend could not be bundled</h1><pre>${String(error)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</pre>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style>
${apiShim(chatId)}
</head><body><div id="root"></div><div id="app"></div>
<script>${js}</script>
</body></html>`;
}
