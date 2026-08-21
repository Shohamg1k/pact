// Writes a Backend manifest to disk, `npm install`s its declared dependencies, boots an
// in-memory MongoDB (`mongodb-memory-server` — no install, no network, PRD §1 decision)
// plus the generated server as an ISOLATED CHILD PROCESS (SEC-2: never the daemon's own
// process, never the user's real repo, cwd = the chat's own generated/ dir), and proxies
// real HTTP requests to it (VER-3, UI-5's PreviewConsole "KNOWN GAP" — this fills it).
// Imports no model client — deterministic process management only.
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { chatDir, getArtifact } from './kernel/chats.js';

const NPM_INSTALL_TIMEOUT_MS = 120_000;
const BOOT_TIMEOUT_MS = 30_000;

const boots = new Map(); // chatId -> boot record (process/mongo handles never serialized to the client)

function generatedDir(chatId) {
  return path.join(chatDir(chatId), 'generated');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function writeTree(dir, manifest) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const m of manifest.modules) {
    const filePath = path.join(dir, m.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, m.code, 'utf8');
  }
  // The generated app only needs the deps it actually requires — mongodb-memory-server
  // is the RUNNER's own dependency (PACT's server/package.json), never the generated
  // app's; it just gets handed a real mongodb:// URI to connect to (see bootChat below).
  const pkg = {
    name: manifest.package_json?.name ?? 'generated-backend',
    version: '1.0.0',
    private: true,
    dependencies: manifest.package_json?.dependencies ?? {},
  };
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
}

function npmInstall(dir) {
  return new Promise((resolve, reject) => {
    const p = spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, shell: true });
    let err = '';
    const t = setTimeout(() => {
      p.kill();
      reject(new Error(`npm install timed out after ${NPM_INSTALL_TIMEOUT_MS / 1000}s`));
    }, NPM_INSTALL_TIMEOUT_MS);
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(err.trim().slice(0, 1000) || `npm install exited ${code}`));
    });
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      const socket = net.createConnection(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.end();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} never opened within ${timeoutMs}ms`));
        else setTimeout(attempt, 400);
      });
    }
    attempt();
  });
}

/** A safe, parameter-free GET the contract declares — the boot smoke test (VER-3). */
function pickSmokeEndpoint(contract) {
  return contract?.apis?.find((a) => a.method === 'GET' && !a.path.includes(':')) ?? null;
}

function httpProbe(port, reqPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function publicRecord(chatId) {
  const r = boots.get(chatId);
  if (!r) return { status: 'not_booted' };
  return { status: r.status, port: r.port, error: r.error };
}

/** Idempotent: a chat already booting/running just returns its current record. */
export async function bootChat(chatId) {
  const existing = boots.get(chatId);
  if (existing && (existing.status === 'booting' || existing.status === 'running')) return publicRecord(chatId);

  const record = { status: 'booting', port: null, error: null, process: null, mongo: null };
  boots.set(chatId, record);

  try {
    const manifest = await getArtifact(chatId, 'backend');
    if (!manifest) throw new Error('backend has not produced a manifest yet');
    const contract = await getArtifact(chatId, 'architect');

    const dir = generatedDir(chatId);
    await writeTree(dir, manifest);
    await npmInstall(dir);

    const mongo = await MongoMemoryServer.create();
    const port = await freePort();
    const child = spawn('node', [manifest.server_entry], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), MONGO_URL: mongo.getUri('app') },
    });
    record.process = child;
    record.mongo = mongo;

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('exit', (code) => {
      if (record.status === 'running' || record.status === 'booting') {
        record.status = 'failed';
        record.error = `process exited (${code}): ${stderr.trim().slice(-1000)}`;
      }
    });

    await waitForPort(port, BOOT_TIMEOUT_MS);
    const smoke = pickSmokeEndpoint(contract);
    if (smoke) {
      const status = await httpProbe(port, smoke.path);
      if (status === null) throw new Error(`server accepted the connection but never responded to ${smoke.method} ${smoke.path}`);
    }

    record.status = 'running';
    record.port = port;
    return publicRecord(chatId);
  } catch (e) {
    record.process?.kill();
    await record.mongo?.stop().catch(() => {});
    record.status = 'failed';
    record.error = e.message;
    return publicRecord(chatId);
  }
}

export function getBoot(chatId) {
  return publicRecord(chatId);
}

export async function stopBoot(chatId) {
  const record = boots.get(chatId);
  if (!record) return;
  record.status = 'stopped';
  record.process?.kill();
  await record.mongo?.stop().catch(() => {});
  boots.delete(chatId);
}

/** Stops every booted process — called on daemon shutdown so nothing orphans (P5/SEC-2). */
export async function stopAllBoots() {
  await Promise.all([...boots.keys()].map(stopBoot));
}

/** Proxies one request to the booted server — VER-3/UI-5's PreviewConsole. */
export function proxyRequest(chatId, { method, path: reqPath, body }) {
  const record = boots.get(chatId);
  if (!record || record.status !== 'running') {
    return Promise.resolve({ status: null, error: `chat is not booted (status: ${record?.status ?? 'not_booted'})` });
  }
  return new Promise((resolve) => {
    const payload = body !== undefined && body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: record.port,
        path: reqPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', (e) => resolve({ status: null, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: null, error: 'request timed out' });
    });
    if (payload) req.write(payload);
    req.end();
  });
}
