// Real OS folder mirroring via the File System Access API (Chrome/Edge only — an
// explicit, user-initiated export gesture, not a replacement for the server's
// canonical `.pact/` store, which remains the only thing the daemon writes to). The
// user picks a folder once; the handle is persisted in IndexedDB (lib/idb.js) and
// re-verified on reconnect. After each agent role completes, the chat page fetches
// that role's artifact and writes it into the linked folder in a layout meant to be
// genuinely useful to open in an editor — not a raw copy of internal .pact/ bookkeeping.
import { saveHandle, loadHandle } from './idb.js';

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickDirectory() {
  if (!isSupported()) throw new Error('This browser cannot grant folder access (Chrome/Edge only).');
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

/** true if we can write without prompting again; false if the user must re-grant. */
export async function hasPermission(handle) {
  if (!handle) return false;
  const perm = await handle.queryPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

/** Must be called from a user gesture (a click handler) — the browser requires it. */
export async function requestPermission(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

export async function linkFolder(key, handle) {
  await saveHandle(key, handle);
}

export async function getLinkedHandle(key) {
  return loadHandle(key);
}

/** Writes one file, creating any intermediate directories along a `a/b/c.js` path. */
async function writeFile(dirHandle, relativePath, content) {
  const parts = relativePath.split('/').filter(Boolean);
  const fileName = parts.pop();
  let dir = dirHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

const json = (obj) => JSON.stringify(obj, null, 2);

/** Role-specific sensible file layout — what a human would actually want to see if
 * they opened this folder, not a literal mirror of .pact/'s internal shape. */
export async function mirrorRole(dirHandle, role, artifact) {
  switch (role) {
    case 'pm':
      await writeFile(dirHandle, 'pm/features.json', json(artifact));
      return;
    case 'architect':
      await writeFile(dirHandle, 'architecture.json', json(artifact));
      return;
    case 'uiux':
      await writeFile(dirHandle, 'uiux/screens.json', json(artifact));
      return;
    case 'backend':
      for (const m of artifact.modules ?? []) await writeFile(dirHandle, `backend/${m.path}`, m.code);
      await writeFile(dirHandle, 'backend/package.json', json(artifact.package_json));
      return;
    case 'frontend':
      for (const m of artifact.modules ?? []) await writeFile(dirHandle, `frontend/${m.path}`, m.code);
      await writeFile(dirHandle, 'frontend/package.json', json(artifact.package_json));
      return;
    case 'qa':
      await writeFile(dirHandle, 'qa/test-cases.json', json(artifact));
      return;
    case 'docs':
      await writeFile(dirHandle, 'technical-spec.md', artifact.technical_spec ?? '');
      await writeFile(dirHandle, 'user-guide.md', artifact.user_guide ?? '');
      return;
    default:
      await writeFile(dirHandle, `${role}.json`, json(artifact));
  }
}
