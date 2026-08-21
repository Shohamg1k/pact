// Files are truth (PRD §7, principle P3). Every read/write of `.pact/` goes through here —
// the daemon is the only writer (PRD §2 non-negotiable #3).
import { mkdir, readFile, writeFile, readdir, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.cwd(), '.pact');

export function runDir(runId) {
  return path.join(ROOT, 'runs', runId);
}

export function sha256(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

export async function ensureRunDir(runId) {
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, 'packs'), { recursive: true });
  await mkdir(path.join(dir, 'raw'), { recursive: true });
  return dir;
}

/** Write a run artifact as JSON (pretty) or raw text. Returns its hash. */
export async function writeArtifact(runId, name, content) {
  const dir = await ensureRunDir(runId);
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await writeFile(path.join(dir, name), body, 'utf8');
  return sha256(body);
}

export async function readArtifact(runId, name) {
  const file = path.join(runDir(runId), name);
  if (!existsSync(file)) return null;
  const body = await readFile(file, 'utf8');
  return name.endsWith('.json') || name.endsWith('.jsonl') ? body : body;
}

export async function readJSON(runId, name) {
  const body = await readArtifact(runId, name);
  return body ? JSON.parse(body) : null;
}

/** Append-only logs: worklog.jsonl, inbox.jsonl. One JSON object per line. */
export async function appendLog(runId, name, entry) {
  const dir = await ensureRunDir(runId);
  await appendFile(path.join(dir, name), JSON.stringify(entry) + '\n', 'utf8');
}

export async function readLog(runId, name) {
  const body = await readArtifact(runId, name);
  if (!body) return [];
  return body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function listRuns() {
  const dir = path.join(ROOT, 'runs');
  if (!existsSync(dir)) return [];
  return readdir(dir);
}

export async function getRun(runId) {
  return readJSON(runId, 'run.json');
}

export async function patchRun(runId, patch) {
  const current = (await getRun(runId)) ?? {};
  const next = { ...current, ...patch };
  await writeArtifact(runId, 'run.json', next);
  return next;
}
