// Tier 1 — syntax gate (PRD §16 VER-1). Ported from agenticteam/server/src/verify.ts:
// strip TS types, keep the logic and comments. This must catch a broken file in ~200ms —
// no install, no network (principle P6: cheap before expensive). Imports no model client.
//
// Until now a generated file went straight to the next gate with NOTHING checking it: not
// that it parsed, not that it was even complete. This pass parses every produced file and,
// when it fails, hands the concrete errors back to the model as feedback so it repairs its
// own work before a human — or Gate V2 tier 2/3 — ever sees it. Deliberately SYNTAX-level:
// it needs no project config, no install, no network, so it applies to every run.
//
// Bounded per the invariants: capped file count, capped file size, unknown extensions are
// skipped rather than guessed at.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MAX_FILES = 40;
const MAX_BYTES = 400_000;

/** @typedef {{path: string, content: string}} FileArtifact */
/** @typedef {{file: string, line?: number, column?: number, message: string}} VerifyIssue */
/** @typedef {{ok: boolean, checked: number, skipped: number, issues: VerifyIssue[]}} VerifyResult */

/** esbuild loader per extension; undefined means "we cannot check this, skip it". */
function loaderFor(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.mts':
    case '.cts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'js';
    case '.jsx':
      return 'jsx';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    default:
      return undefined;
  }
}

/** Run a real compiler/parser for languages esbuild cannot read. Returns [] when the
 * toolchain is absent — an unavailable checker must SKIP, never fail a valid file. */
async function checkExternal(f, tool) {
  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'pact-syn-'));
    const file = path.join(dir, path.basename(f.path));
    await writeFile(file, f.content, 'utf8');
    const spec = tool === 'py_compile'
      ? { cmd: 'py', args: ['-m', 'py_compile', file] }
      : { cmd: 'javac', args: ['-proc:none', '-d', dir, file] };
    const err = await new Promise((resolve) => {
      const p = spawn(spec.cmd, spec.args, { shell: true });
      let e = '';
      const t = setTimeout(() => { p.kill(); resolve(null); }, 20_000);
      p.stderr.on('data', (d) => (e += d));
      p.on('error', () => { clearTimeout(t); resolve(null); });   // toolchain missing -> skip
      p.on('exit', (code) => { clearTimeout(t); resolve(code === 0 ? '' : e); });
    });
    if (err === null || err === '') return [];
    // Compilers report `file:line: message`; keep the line so repair feedback stays precise.
    const m = err.match(/:(\d+)[:\s]/);
    const firstLine = err.trim().split(/\r?\n/)[0];
    return [{ file: f.path, line: m ? Number(m[1]) : undefined, message: firstLine.slice(0, 200) }];
  } catch {
    return [];
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Parse one file, returning its syntax errors (empty when it is valid). */
async function parseOne(f) {
  const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
  if (f.content.length > MAX_BYTES) return [];
  if (ext === '.py') return checkExternal(f, 'py_compile');
  if (ext === '.java') return checkExternal(f, 'javac');
  const loader = loaderFor(f.path);
  if (!loader) return [];
  if (f.content.length > MAX_BYTES) return [];
  // JSON has a precise native parser; esbuild is tolerant of some malformed JSON.
  if (loader === 'json') {
    try {
      JSON.parse(f.content);
      return [];
    } catch (e) {
      return [{ file: f.path, message: String(e?.message ?? e).slice(0, 200) }];
    }
  }
  try {
    const esbuild = await import('esbuild');
    await esbuild.transform(f.content, { loader, sourcefile: f.path });
    return [];
  } catch (e) {
    const errs = Array.isArray(e?.errors) && e.errors.length ? e.errors : null;
    if (!errs) return [{ file: f.path, message: String(e?.message ?? e).slice(0, 200) }];
    return errs.slice(0, 5).map((x) => ({
      file: f.path,
      line: x.location?.line,
      column: x.location?.column,
      message: String(x.text ?? '').slice(0, 200),
    }));
  }
}

/**
 * Verify a run's produced files. A run that produced no checkable file passes trivially —
 * that is never the case for backend.json (it always has at least one .js module), but the
 * function stays general-purpose.
 * @param {FileArtifact[]} files
 * @returns {Promise<VerifyResult>}
 */
export async function verifyArtifacts(files) {
  const subset = files.slice(0, MAX_FILES);
  let checked = 0;
  let skipped = 0;
  const issues = [];
  for (const f of subset) {
    const ext2 = f.path.slice(f.path.lastIndexOf('.')).toLowerCase();
    const checkable = loaderFor(f.path) || ext2 === '.py' || ext2 === '.java';
    if (!checkable || f.content.length > MAX_BYTES) {
      skipped++;
      continue;
    }
    checked++;
    issues.push(...(await parseOne(f)));
  }
  return { ok: issues.length === 0, checked, skipped, issues: issues.slice(0, 20) };
}

/** The repair brief handed back to the model — concrete, file-and-line specific. */
export function repairFeedback(result) {
  const lines = result.issues.map(
    (i) => `- ${i.file}${i.line ? `:${i.line}${i.column != null ? `:${i.column}` : ''}` : ''} — ${i.message}`,
  );
  return [
    `Automated verification REJECTED your output: ${result.issues.length} syntax error(s) across ${result.checked} file(s).`,
    '',
    ...lines,
    '',
    'Re-emit the COMPLETE corrected backend/v1 JSON object with these files fixed.',
    'Fix the actual syntax — do not truncate, do not stub, and do not drop the file to avoid the error.',
  ].join('\n');
}
