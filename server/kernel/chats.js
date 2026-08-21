// Chat/project domain layer (PRD, generalized from the flat runId model). A chat is
// created by its first message (the brief, stored byte-verbatim — CORE-1) and lives on
// after that: it accumulates one artifact per agent role that has run against it, so a
// chat is resumable — run Architect+Backend today, come back next week and add
// Frontend, reading the SAME chat's already-committed artifacts. A project is just a
// named grouping of chats (a folder, in the user-facing sense).
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  PACT_ROOT,
  writeFileAt,
  readFileAt,
  readJSONAt,
  appendLogAt,
  readLogAt,
  listDirNames,
} from './store.js';
import { ROLE_IDS } from '../agents/registry.js';

export function chatDir(chatId) {
  return path.join(PACT_ROOT, 'chats', chatId);
}
export function jobDir(chatId, jobId) {
  return path.join(chatDir(chatId), 'jobs', jobId);
}
export function projectDir(projectId) {
  return path.join(PACT_ROOT, 'projects', projectId);
}

// --- chat-scoped file I/O ---
export const writeChatFile = (chatId, name, content) => writeFileAt(chatDir(chatId), name, content);
export const readChatFile = (chatId, name) => readFileAt(chatDir(chatId), name);
export const readChatJSON = (chatId, name) => readJSONAt(chatDir(chatId), name);
export const appendChatLog = (chatId, name, entry) => appendLogAt(chatDir(chatId), name, entry);
export const readChatLog = (chatId, name) => readLogAt(chatDir(chatId), name);

// --- job-scoped file I/O (packs/raw output/job.json — one job per agent execution) ---
export const writeJobFile = (chatId, jobId, name, content) => writeFileAt(jobDir(chatId, jobId), name, content);
export const readJobJSON = (chatId, jobId, name) => readJSONAt(jobDir(chatId, jobId), name);

export async function listChats() {
  return listDirNames(path.join(PACT_ROOT, 'chats'));
}

export async function getChat(chatId) {
  return readChatJSON(chatId, 'chat.json');
}

export async function patchChat(chatId, patch) {
  const current = (await getChat(chatId)) ?? {};
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeChatFile(chatId, 'chat.json', next);
  return next;
}

/** CORE-1: the brief is stored byte-verbatim as the chat's first message. PACT is not
 * a free-form conversational agent — a chat's "message" IS the brief; everything after
 * is an activity log (agent runs, clarifications), not further model-directed chat. */
export async function createChat({ text, projectId = null, mode = 'batch', pinnedAdapter = null }) {
  const id = randomUUID().slice(0, 8);
  const now = new Date().toISOString();
  const chat = {
    id,
    title: text.slice(0, 60),
    projectId,
    brief: text,
    mode,
    pinnedAdapter: pinnedAdapter ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await writeChatFile(id, 'chat.json', chat);
  await appendChatLog(id, 'worklog.jsonl', { ts: Date.now(), phase: 'chat', event: 'created', detail: {} });
  return chat;
}

export async function listJobs(chatId) {
  const ids = await listDirNames(path.join(chatDir(chatId), 'jobs'));
  const jobs = [];
  for (const id of ids) {
    const job = await readJobJSON(chatId, id, 'job.json');
    if (job) jobs.push(job);
  }
  return jobs.sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
}

export async function getArtifact(chatId, role) {
  return readChatJSON(chatId, `artifacts/${role}.json`);
}

/** Every role that currently has a committed artifact in this chat — the live "what's
 * already available" set runAgentSet checks new selections against (registry.js). */
export async function availableRoles(chatId) {
  const set = new Set();
  for (const role of ROLE_IDS) {
    if (await getArtifact(chatId, role)) set.add(role);
  }
  return set;
}

export async function listArtifacts(chatId) {
  const out = {};
  for (const role of ROLE_IDS) {
    const a = await getArtifact(chatId, role);
    if (a) out[role] = a;
  }
  return out;
}

// --- projects (a named grouping of chats — the user-facing "folder") ---
export async function createProject(name) {
  const id = randomUUID().slice(0, 8);
  const project = { id, name, createdAt: new Date().toISOString() };
  await writeFileAt(projectDir(id), 'project.json', project);
  return project;
}

export async function getProject(projectId) {
  return readJSONAt(projectDir(projectId), 'project.json');
}

export async function listProjects() {
  const ids = await listDirNames(path.join(PACT_ROOT, 'projects'));
  const out = [];
  for (const id of ids) {
    const p = await readJSONAt(projectDir(id), 'project.json');
    if (p) out.push(p);
  }
  return out;
}

/**
 * Delete a chat and everything under it. Files are truth (P3), so removing the directory
 * IS the deletion — there is no index to keep in step. The caller must stop any running
 * preview first; this module owns files, not processes.
 */
export async function deleteChat(chatId) {
  await rm(chatDir(chatId), { recursive: true, force: true });
}

/**
 * Delete a project. Its chats are UNFILED rather than destroyed — losing a week of
 * generated work because a folder was tidied up would be indefensible, and the user can
 * still delete each chat deliberately.
 * @returns {Promise<{unfiled: number}>}
 */
export async function deleteProject(projectId) {
  let unfiled = 0;
  for (const id of await listChats()) {
    const chat = await getChat(id);
    if (chat?.projectId === projectId) {
      await patchChat(id, { projectId: null });
      unfiled++;
    }
  }
  await rm(projectDir(projectId), { recursive: true, force: true });
  return { unfiled };
}
