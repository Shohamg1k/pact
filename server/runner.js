// The runner (PRD §16 VER-3, §6, Builder D). Writes a backend manifest to a real directory,
// npm installs it, boots it against an in-memory MongoDB, and proves it answers live HTTP —
// the moment the pipeline's claim ("a running backend, not a document", G1) stops being
// asserted and starts being verified. Imports no model client (PRD §2 non-negotiable #1).
//
// Every function here takes the target directory as a PARAMETER. It never hardcodes
// `.pact/runs/<id>/...` — the caller (today: agents/backend.js via kernel/store.js's
// runDir()) decides where that directory lives. This is deliberate: a parallel track is
// mid-pivot from a flat `.pact/runs/<id>/` layout to `.pact/chats/<id>/artifacts/*.json`,
// and this module must stay correct under either shape without changing.
//
// DECISION (documented per the handoff): the generated backend manifest has no way to
// declare a health-check route — schemas/backend.js's shape doesn't reserve one, and
// prompts/backend.md is owned by a different track. Rather than depend on a prompt change
// landing in lockstep, this module INJECTS `GET /__health` deterministically into the
// server_entry module's source before writing it to disk (injectHealthRoute below). Same
// reasoning for the listen port (injectPortEnv) and the Mongo connection string
// (injectMongoUri): the model's code may hardcode a port or a `mongodb://localhost/...`
// literal, so the injection rewrites `.listen(<port>` and `mongoose.connect('<uri>'` to
// prefer an env var when present, and the runner always sets that env var. Idempotent and
// a no-op when the code already reads the env var itself.
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import path from 'node:path';
import { resolveStack } from './stacks.js';
import { sha256 } from './kernel/store.js';

const execAsync = promisify(exec);

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_BOOT_TIMEOUT_MS = 20_000;
const HEALTH_ROUTE = '/__health';

// --- module-format detection -------------------------------------------------------------

function looksLikeCJS(code) {
  return /\brequire\(/.test(code) || /\bmodule\.exports\b/.test(code);
}
function looksLikeESM(code) {
  return /^\s*import\s+[^;]+from\s+['"]/m.test(code) || /^\s*export\s+(default|const|function|class)\b/m.test(code);
}

/** CommonJS is the safe default (Node's own default, and what the one known-good backend
 * fixture in gates/v2.selftest.mjs actually uses) — only "module" when the code is
 * unambiguously ESM and never uses require()/module.exports anywhere. */
export function detectModuleFormat(manifest) {
  const all = manifest.modules.map((m) => m.code).join('\n');
  if (looksLikeCJS(all)) return 'commonjs';
  if (looksLikeESM(all)) return 'module';
  return 'commonjs';
}

// --- deterministic source injection -------------------------------------------------------

/** Inserts `GET /__health` right after the Express app is constructed. Idempotent. */
export function injectHealthRoute(code) {
  if (code.includes(HEALTH_ROUTE)) return code;
  const declMatch = code.match(/(\b(?:const|let|var)\s+(\w+)\s*=\s*express\(\)\s*;?)/);
  if (declMatch) {
    const [full, decl, varName] = declMatch;
    const injected = `${decl}\n${varName}.get('${HEALTH_ROUTE}', (req, res) => res.status(200).json({ ok: true }));`;
    return code.replace(full, injected);
  }
  // Fallback: no `= express()` found (e.g. the app is built elsewhere) — inject right
  // before the first `.listen(` call using its receiver as the app identifier.
  const listenMatch = code.match(/(\b(\w+)\.listen\()/);
  if (listenMatch) {
    const [full, , varName] = listenMatch;
    const injected = `${varName}.get('${HEALTH_ROUTE}', (req, res) => res.status(200).json({ ok: true }));\n${full}`;
    return code.replace(full, injected);
  }
  return code; // could not safely inject — boot check will surface BOOT_FAIL naming this file
}

/** Rewrites a hardcoded `.listen(<port>` to prefer PACT_RUNNER_PORT. No-op if the code
 * already reads an env var for its port (the env var the runner sets covers that case too,
 * via PORT — see startServerProcess). */
export function injectPortEnv(code) {
  return code.replace(/\.listen\(\s*(\d+)/, '.listen(process.env.PACT_RUNNER_PORT || $1');
}

/** Inserts a FastAPI `GET /__health` right after `app = FastAPI(...)`. Idempotent; a
 * no-op when the construction can't be found safely (boot check will then surface
 * BOOT_FAIL naming this file, same fallback contract as injectHealthRoute above). */
export function injectFastApiHealthRoute(code) {
  if (code.includes(HEALTH_ROUTE)) return code;
  const m = code.match(/(\b(\w+)\s*=\s*FastAPI\([^)]*\)\s*)/);
  if (!m) return code;
  const [full, decl, varName] = m;
  const injected = `${decl}\n\n@${varName}.get("${HEALTH_ROUTE}")\ndef __pact_health():\n    return {"ok": True}\n`;
  return code.replace(full, injected);
}

/** Inserts a Django `path('__health', ...)` into whichever module declares
 * `urlpatterns = [...]` — that is the root urlconf in every generated tree PACT produces
 * (a single small app, per stacks.js's Django promptRules), so the first match is the
 * right one. Idempotent. */
export function injectDjangoHealthRoute(code) {
  if (!/urlpatterns\s*=\s*\[/.test(code) || code.includes(HEALTH_ROUTE)) return code;
  let out = code;
  if (!/JsonResponse/.test(out)) out = `from django.http import JsonResponse\n${out}`;
  return out.replace(/urlpatterns\s*=\s*\[/, `urlpatterns = [\n    path('${HEALTH_ROUTE.slice(1)}', lambda request: JsonResponse({'ok': True})),`);
}

/** Rewrites a hardcoded `mongoose.connect('...'` literal to prefer the injected env var.
 * prompts/backend.md mandates MONGO_URL, but older artifacts (and models that ignore the
 * rule) emit MONGO_URI or a bare literal — startPreviewServer sets every spelling, and this
 * rewrite covers the bare-literal case so a stale manifest still boots. */
export function injectMongoUri(code) {
  return code.replace(/mongoose\.connect\(\s*(['"`])([^'"`]*)\1/, 'mongoose.connect(process.env.MONGO_URL || process.env.MONGO_URI || $1$2$1');
}

/** Best-effort: which manifest module's path is mentioned in this stderr/error text? Used
 * to give a BOOT_FAIL error a concrete subject_id for the repair prompt, same as tier 1/2. */
export function identifyFailingFile(text, manifest) {
  if (!text) return null;
  for (const m of manifest.modules) {
    if (text.includes(m.path)) return m.path;
  }
  return null;
}

// --- probe target selection -----------------------------------------------------------

/** Fills every path-param placeholder with a requestable literal, across the param
 * syntaxes different stacks' contracts actually use: Express `:id`, OpenAPI/FastAPI
 * `{id}`, and Django converters `<int:pk>` / `<slug:name>` / bare `<id>`. Contracts were
 * only ever tested against `:id` (Node); FastAPI/Django contracts declare their paths in
 * the framework's own native syntax (verified live: the architect wrote `/books/{book_id}`
 * for a FastAPI brief), so an unhandled syntax left the literal placeholder in the URL and
 * the probe 404'd against a path that was never actually requestable. */
export function fillPathParams(p) {
  return p
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '1')
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '1')
    .replace(/<(?:[A-Za-z_]+:)?[A-Za-z_][A-Za-z0-9_]*>/g, '1');
}

/** Picks one declared API to hit live after boot (VER-3's "probe one declared endpoint").
 * Prefers GET (no side effects) and fills path params with a placeholder so `/x/:id`
 * becomes a requestable `/x/1`. */
export function pickProbeEndpoint(contract) {
  const apis = contract?.apis ?? [];
  if (apis.length === 0) return null;
  const candidate = apis.find((a) => a.method === 'GET') ?? apis[0];
  return { method: candidate.method, path: fillPathParams(candidate.path), id: candidate.id };
}

// --- filesystem: write the generated tree -----------------------------------------------

/**
 * Writes a backend manifest's modules[] + package.json to `generatedDir`. Clears prior
 * generated source first (but preserves node_modules / the deps-hash marker so a repair
 * retry doesn't pay for a full reinstall when dependencies didn't change).
 * @param {string} generatedDir - absolute path, caller-owned (see file header)
 * @param {object} manifest - a validated backend/v1 manifest (schemas/backend.js)
 */
export async function writeGeneratedTree(generatedDir, manifest, stack = resolveStack(null)) {
  await mkdir(generatedDir, { recursive: true });
  const existing = await readdir(generatedDir).catch(() => []);
  for (const entry of existing) {
    if (entry === 'node_modules' || entry === '.pact-deps-hash') continue;
    await rm(path.join(generatedDir, entry), { recursive: true, force: true });
  }

  const format = detectModuleFormat(manifest);
  // Django's urlconf can live in any module (it's whichever one declares `urlpatterns`,
  // not necessarily server_entry — manage.py never is), so injection there is keyed off
  // content, not path; guard against injecting into more than one file if a generated
  // tree ever declares more than one urlpatterns list.
  let djangoHealthInjected = false;
  for (const m of manifest.modules) {
    const filePath = path.join(generatedDir, m.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    let code = m.code;
    if (stack.id === 'node') {
      if (m.path === manifest.server_entry) {
        code = injectHealthRoute(code);
        code = injectPortEnv(code);
      }
      code = injectMongoUri(code);
    } else if (stack.id === 'python' && m.path === manifest.server_entry) {
      code = injectFastApiHealthRoute(code);
    } else if (stack.id === 'django' && !djangoHealthInjected) {
      const injected = injectDjangoHealthRoute(code);
      if (injected !== code) djangoHealthInjected = true;
      code = injected;
    }
    await writeFile(filePath, code, 'utf8');
  }

  const declared = { ...(stack.deps ?? {}), ...(manifest.package_json?.dependencies ?? {}) };
  if (stack.manifestFile === 'requirements.txt') {
    // pip wants `name==version` (or a bare name); the model may give '' for "any".
    const lines = Object.entries(declared).map(([n, v]) => (v && /^[0-9]/.test(String(v)) ? `${n}==${v}` : n));
    await writeFile(path.join(generatedDir, 'requirements.txt'), lines.join('\n') + '\n', 'utf8');
  } else if (stack.manifestFile === 'package.json') {
    const pkg = {
      name: manifest.package_json?.name || 'pact-generated-backend',
      version: '0.0.0',
      private: true,
      ...(format === 'module' ? { type: 'module' } : {}),
      main: manifest.server_entry,
      dependencies: declared,
    };
    await writeFile(path.join(generatedDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  }

  return { entryPath: path.join(generatedDir, manifest.server_entry), format };
}

// --- process control ----------------------------------------------------------------------

/** Kills a process AND its full tree — a `node`/`npm` child left running after a timeout
 * or a failed run is exactly the orphan-process failure mode this track must never cause. */
export async function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      await execAsync(`taskkill /pid ${pid} /T /F`);
    } catch {
      /* already exited — fine */
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already exited — fine */
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * `npm install` in `generatedDir`. Skips the actual install (but still resolves) when
 * package.json is byte-identical to the last install AND node_modules already exists —
 * cheap-before-expensive (P6) across the bounded repair loop, which rewrites the tree on
 * every attempt but rarely changes dependencies.
 */
export async function installDeps(generatedDir, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
  const stack = opts.stack ?? resolveStack(null);
  // Java here has no build tool available, so it declares no install step — that's a
  // valid profile, not an error.
  if (!stack.install) return { skipped: true, stdout: '', stderr: '' };

  const pkgPath = path.join(generatedDir, stack.manifestFile);
  const pkgRaw = await readFile(pkgPath, 'utf8').catch(() => '');
  if (!pkgRaw.trim()) return { skipped: true, stdout: '', stderr: '' };
  const depsHash = sha256(pkgRaw);
  const markerPath = path.join(generatedDir, '.pact-deps-hash');
  const prevHash = await readFile(markerPath, 'utf8').catch(() => null);
  // node_modules is Node's marker; other stacks install into the interpreter, so the
  // hash alone decides whether a reinstall is needed.
  const alreadyInstalled = stack.id === 'node' ? existsSync(path.join(generatedDir, 'node_modules')) : true;
  if (prevHash === depsHash && alreadyInstalled) {
    return { skipped: true, stdout: '', stderr: '' };
  }

  const result = await new Promise((resolve, reject) => {
    const p = spawn(stack.install.cmd, stack.install.args, {
      cwd: generatedDir,
      shell: true, // npm is a .cmd shim on Windows — same convention as adapters/spawn.js
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(async () => {
      await killTree(p.pid);
      reject(Object.assign(new Error(`npm install timed out after ${timeoutMs}ms`), { stdout, stderr }));
    }, timeoutMs);
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      reject(Object.assign(new Error(`npm install exited with code ${code}`), { stdout, stderr: stderr.slice(-2000) }));
    });
  });

  await writeFile(markerPath, depsHash, 'utf8');
  return { skipped: false, ...result };
}

/** Starts a zero-install, in-memory MongoDB (PRD §5, §16 VER-3). The mongod binary is
 * downloaded once and cached by the library on first use; launchTimeout is generous
 * because a first-ever launch on a fresh binary can be slow (AV scan, disk cache warm-up) —
 * verified locally: >10s on first launch, <1s once cached. */
export async function startMemoryMongo(opts = {}) {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: opts.launchTimeoutMs ?? 45_000 } });
  return {
    uri: mongod.getUri(),
    async stop() {
      await mongod.stop();
    },
  };
}

/** Spawns the generated server as a child process. Returns a handle with rolling
 * stdout/stderr buffers (capped, so a crash-looping server can't leak memory) and exit
 * tracking so callers can fail fast instead of waiting out the full health-check timeout. */
function startServerProcess(generatedDir, manifest, env, stack, port) {
  const entry = manifest.server_entry || stack.entryDefault;
  const spec = stack.start(entry, { port });
  // Node resolves to the real node.exe so child.pid IS the process to kill; other
  // launchers (py, java) are PATH shims on Windows and need a shell, which is exactly
  // why killTree walks the process tree rather than killing one pid.
  const isNode = spec.cmd === 'node';
  const child = spawn(isNode ? process.execPath : spec.cmd, isNode ? [path.join(generatedDir, entry)] : spec.args, {
    cwd: generatedDir,
    env: { ...process.env, ...env },
    shell: !isNode,
  });
  const MAX_BUF = 20_000;
  let stdout = '';
  let stderr = '';
  let exited = false;
  let exitInfo = null;
  child.stdout.on('data', (d) => {
    stdout = (stdout + d).slice(-MAX_BUF);
  });
  child.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-MAX_BUF);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });
  return {
    pid: child.pid,
    getStdout: () => stdout,
    getStderr: () => stderr,
    hasExited: () => exited,
    exitInfo: () => exitInfo,
  };
}

async function waitForHealth(baseUrl, handle, { timeoutMs = DEFAULT_BOOT_TIMEOUT_MS, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (handle.hasExited()) {
      const info = handle.exitInfo();
      throw new Error(`server process exited early (code=${info?.code}, signal=${info?.signal}) before ${HEALTH_ROUTE} responded`);
    }
    try {
      const res = await fetch(`${baseUrl}${HEALTH_ROUTE}`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return true;
      lastErr = new Error(`${HEALTH_ROUTE} returned HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw lastErr ?? new Error('health probe timed out');
}

// --- the tier-3 boot check (VER-3) -------------------------------------------------------

function bootError(summary, err, manifest, stderr = '') {
  const failingFile = manifest ? identifyFailingFile(`${stderr} ${err?.message ?? ''}`, manifest) : null;
  return {
    valid: false,
    tier: 3,
    errors: [
      {
        code: 'BOOT_FAIL',
        subject_id: failingFile,
        detail: `${summary}: ${err?.message ?? String(err)}${stderr ? `\n--- stderr (tail) ---\n${stderr.slice(-2000)}` : ''}`,
        recoverable: true,
      },
    ],
  };
}

/**
 * Gate V2 tier 3 (PRD §16 VER-3): write tree -> npm install -> boot against an in-memory
 * Mongo -> GET /__health -> probe one declared endpoint -> kill cleanly. Runs AFTER tiers
 * 1 (syntax) and 2 (coverage/drift/conformance) — the caller (agents/backend.js) is
 * responsible for that ordering (P6: cheap before expensive); this function assumes it
 * was only called because the manifest already passed both.
 *
 * Returns the SAME `{valid, errors, tier}` shape as gates/v2.js's tiers so callers can
 * compose it into the identical bounded-repair pattern (repairFeedbackV2 already handles
 * a generic `{code, subject_id, detail}` error list).
 *
 * @param {string} generatedDir - absolute path, caller-owned (see file header)
 * @param {object} contract - the validated architecture contract
 * @param {object} manifest - the validated backend manifest
 */
export async function runBootCheck(generatedDir, contract, manifest, opts = {}) {
  const stack = resolveStack(contract);
  await writeGeneratedTree(generatedDir, manifest, stack);

  // A stack we cannot start here isn't a failing gate — it's a check we honestly cannot
  // run, so tier 3 is skipped and says why rather than reporting a false BOOT_FAIL.
  if (stack.runnable === false) {
    return { ok: true, skipped: true, reason: stack.runnableNote ?? `${stack.label} cannot be started on this machine`, stack: stack.id, issues: [] };
  }

  try {
    await installDeps(generatedDir, { timeoutMs: opts.installTimeoutMs, stack });
  } catch (e) {
    return bootError(`${stack.install?.cmd ?? 'dependency'} install failed`, e, manifest, e.stderr);
  }

  let mongo;
  try {
    mongo = stack.db === 'mongo' ? await startMemoryMongo(opts.mongo) : { uri: '', stop: async () => {} };
  } catch (e) {
    return bootError('in-memory MongoDB failed to start', e, manifest);
  }

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const handle = startServerProcess(
    generatedDir,
    manifest,
    { PACT_RUNNER_PORT: String(port), ...stack.env({ port, mongoUri: mongo.uri, dbPath: path.join(generatedDir, 'pact.db') }) },
    stack,
    port,
  );

  try {
    await waitForHealth(baseUrl, handle, { timeoutMs: opts.bootTimeoutMs });
  } catch (e) {
    const stderr = handle.getStderr();
    await killTree(handle.pid);
    await mongo.stop();
    return bootError(`${HEALTH_ROUTE} check failed`, e, manifest, stderr);
  }

  let endpointProbe = null;
  const target = pickProbeEndpoint(contract);
  if (target) {
    try {
      const res = await fetch(`${baseUrl}${target.path}`, { method: target.method, signal: AbortSignal.timeout(5000) });
      endpointProbe = { method: target.method, path: target.path, id: target.id, status: res.status };
    } catch (e) {
      endpointProbe = { method: target.method, path: target.path, id: target.id, error: e.message };
    }
  }

  const stderr = handle.getStderr();
  await killTree(handle.pid);
  await mongo.stop();

  return { valid: true, errors: [], tier: 0, port, endpointProbe, stderr };
}

// --- long-lived preview (PRD UI-5, T8) ----------------------------------------------------

/**
 * Boots the generated app and leaves it running for the live preview console / connector
 * demo — unlike runBootCheck (ephemeral, tears itself down), the caller owns this handle's
 * lifecycle and MUST call .stop() (run completion, a new run superseding it, or daemon
 * shutdown) or the process/mongod will orphan.
 */
export async function startPreviewServer(generatedDir, contract, manifest, opts = {}) {
  const stack = resolveStack(contract);
  if (stack.runnable === false) {
    throw Object.assign(new Error(stack.runnableNote ?? `${stack.label} cannot be started on this machine`), { code: 'STACK_NOT_RUNNABLE', stack: stack.id });
  }
  await writeGeneratedTree(generatedDir, manifest, stack);
  await installDeps(generatedDir, { timeoutMs: opts.installTimeoutMs, stack });

  // Only Mongo-backed stacks pay for an in-memory mongod; SQLite stacks just get a path.
  const mongo = stack.db === 'mongo' ? await startMemoryMongo(opts.mongo) : { uri: '', stop: async () => {} };
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const handle = startServerProcess(
    generatedDir,
    manifest,
    { PACT_RUNNER_PORT: String(port), ...stack.env({ port, mongoUri: mongo.uri, dbPath: path.join(generatedDir, 'pact.db') }) },
    stack,
    port,
  );

  try {
    await waitForHealth(baseUrl, handle, { timeoutMs: opts.bootTimeoutMs });
  } catch (e) {
    await killTree(handle.pid);
    await mongo.stop();
    throw Object.assign(e, { stderr: handle.getStderr() });
  }

  let stopped = false;
  return {
    port,
    baseUrl,
    getStderr: handle.getStderr,
    async proxy(method, urlPath, body) {
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON — return the raw text */
      }
      return { status: res.status, body: json ?? text };
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await killTree(handle.pid);
      await mongo.stop();
    },
  };
}
