// Files are truth (PRD §7, principle P3). Every read/write of `.pact/` goes through
// here — the daemon is the only writer (PRD §2 non-negotiable #3). Generic file I/O
// only; domain-specific paths (projects/chats/jobs) live in kernel/chats.js, which is
// built on top of these primitives.
import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PACT_ROOT = path.resolve(process.cwd(), '.pact');

export function sha256(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

/** Write a file as JSON (pretty) or raw text under absDir. Creates parent dirs, so a
 * nested name like 'artifacts/architect.json' works without a separate mkdir. Returns
 * its hash. */
export async function writeFileAt(absDir, name, content) {
  const filePath = path.join(absDir, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await writeFile(filePath, body, 'utf8');
  return sha256(body);
}

export async function readFileAt(absDir, name) {
  const filePath = path.join(absDir, name);
  if (!existsSync(filePath)) return null;
  return readFile(filePath, 'utf8');
}

export async function readJSONAt(absDir, name) {
  const body = await readFileAt(absDir, name);
  return body ? JSON.parse(body) : null;
}

/** Append-only logs: worklog.jsonl, inbox.jsonl. One JSON object per line. */
export async function appendLogAt(absDir, name, entry) {
  const filePath = path.join(absDir, name);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export async function readLogAt(absDir, name) {
  const body = await readFileAt(absDir, name);
  if (!body) return [];
  return body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function listDirNames(absDir) {
  if (!existsSync(absDir)) return [];
  return readdir(absDir);
}
