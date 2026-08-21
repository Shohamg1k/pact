// Assembles the Adapter objects (PRD §9 Adapter interface) from the registry + spawn +
// openrouter primitives. This module — together with openrouter.js and spawn.js — is the
// ONLY module allowed to make an outbound model call (PRD §2 non-negotiable #2).
import { CLAUDE_CFG, AGY_CFG } from './registry.js';
import { spawnCliAgent, probeCliAgent } from './spawn.js';
import { completeOpenRouter, probeOpenRouter, OPENROUTER_CFG } from './openrouter.js';

/**
 * @typedef {Object} Adapter
 * @property {string} id
 * @property {string} name
 * @property {'cli'|'http'} kind
 * @property {number} tier
 * @property {boolean} available
 * @property {number} [cooldownUntil]
 * @property {() => Promise<void>} probe
 * @property {(prompt: string, ctx: {runId: string, phase: string, cwd: string}) => Promise<string>} complete
 */

const claudeCode = {
  id: 'claude-code',
  name: 'Claude Code',
  kind: 'cli',
  tier: 0,
  available: false,
  detail: undefined,
  async probe() {
    this.available = await probeCliAgent(CLAUDE_CFG.bin);
    this.detail = this.available ? 'CLI detected' : 'claude CLI not on PATH';
  },
  complete(prompt, ctx) {
    return spawnCliAgent(CLAUDE_CFG, prompt, ctx.cwd);
  },
};

const agy = {
  id: 'agy',
  name: 'Antigravity (agy)',
  kind: 'cli',
  tier: 1,
  available: false,
  detail: undefined,
  async probe() {
    this.available = await probeCliAgent(AGY_CFG.bin);
    this.detail = this.available ? 'agy CLI detected (headless)' : 'agy CLI not on PATH';
  },
  complete(prompt, ctx) {
    return spawnCliAgent(AGY_CFG, prompt, ctx.cwd);
  },
};

const openrouter = {
  id: 'openrouter',
  name: 'OpenRouter (BYOK)',
  kind: 'http',
  tier: 2,
  available: false,
  detail: undefined,
  async probe() {
    this.available = await probeOpenRouter();
    this.detail = this.available ? `key configured (${OPENROUTER_CFG.model})` : 'set OPENROUTER_API_KEY in .env';
  },
  complete(prompt) {
    return completeOpenRouter(prompt);
  },
};

/** Tier order = ladder order. claude-code -> agy -> openrouter, per PRD §1 decision. */
export const adapters = [claudeCode, agy, openrouter];

export async function probeAll() {
  await Promise.all(
    adapters.map((a) =>
      a.probe().catch(() => {
        a.available = false;
      }),
    ),
  );
}
