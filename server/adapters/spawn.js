// One spawn implementation shared by every CLI-backed adapter (PRD §9, §19 SEC-2).
// Ported from agenticteam/server/src/adapters.ts::spawnCliAgent/probeCliAgent.
//
// ORDER MATTERS: when promptVia === 'argv', the prompt must be inserted immediately
// after cfg.args, BEFORE the permission flag is appended. A value-taking flag like
// agy's -p consumes whatever token comes right after it as ITS OWN argument —
// appending the permission flag first would hand -p the flag string as "the prompt"
// and silently discard the real one. Not hypothetical: this is the exact bug fixed
// in registry.js's AGY_CFG.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DEFAULT_CLI_TIMEOUT_MS = 600_000; // 10 min

/**
 * @param {import('./registry.js').CliAgentConfig} cfg
 * @param {string} prompt
 * @param {string} cwd - the run's own sandbox dir (SEC-2: never the user's real repo)
 * @returns {Promise<string>}
 */
export function spawnCliAgent(cfg, prompt, cwd) {
  fs.mkdirSync(cwd, { recursive: true });
  const withPrompt =
    cfg.promptVia === 'argv'
      ? [...cfg.args, prompt, ...(cfg.postPromptArgs ?? [])]
      : [...cfg.args, ...(cfg.postPromptArgs ?? [])];
  const finalArgs = cfg.permissionFlag ? [...withPrompt, cfg.permissionFlag] : withPrompt;

  return new Promise((resolve, reject) => {
    const p = spawn(cfg.bin, finalArgs, { shell: cfg.shell ?? true, cwd });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      p.kill();
      reject(new Error(`${cfg.bin} run timed out (${Math.round((cfg.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS) / 60_000)} min)`));
    }, cfg.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS);

    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0) {
        const trimmed = out.trim();
        if (trimmed) return resolve(trimmed);
        if (cfg.emptyOutputError) return reject(new Error(cfg.emptyOutputError));
        return resolve(trimmed);
      }
      const e = new Error(err.trim().slice(0, 300) || `${cfg.bin} exited with code ${code}`);
      // Partial output is captured even on failure — this is what makes loss-free
      // failover (PRD §9 "Failover semantics") possible: the next rung gets it.
      if (out.trim()) e.partial = out.trim().slice(0, 4000);
      reject(e);
    });

    if (cfg.promptVia === 'stdin') {
      p.stdin.write(prompt);
      p.stdin.end();
    } else {
      p.stdin.end();
    }
  });
}

/** --version probe shared by every CLI adapter. Used on boot and every 30s (ROUTE-6). */
export function probeCliAgent(bin, versionArgs = ['--version']) {
  return new Promise((resolve) => {
    const p = spawn(bin, versionArgs, { shell: true, stdio: 'ignore' });
    const t = setTimeout(() => {
      p.kill();
      resolve(false);
    }, 8000);
    p.on('error', () => {
      clearTimeout(t);
      resolve(false);
    });
    p.on('exit', (code) => {
      clearTimeout(t);
      resolve(code === 0);
    });
  });
}
