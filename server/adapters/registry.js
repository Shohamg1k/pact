// Declarative CLI-agent registry (PRD §9). Ported from agenticteam/server/src/adapters.ts —
// these configs are LIVE-VERIFIED against the real binaries. Every flag fixes a real bug.
// Do not "clean them up" without re-verifying against the actual CLI.

/**
 * @typedef {Object} CliAgentConfig
 * @property {string} bin
 * @property {string[]} args - extra args for the one-shot completion, BEFORE the prompt/permission flag
 * @property {'stdin'|'argv'} promptVia - how the prompt reaches the process
 * @property {boolean} [shell] - true for .cmd/.bat PATH shims; false for a real native exe (see AGY_CFG)
 * @property {string} [permissionFlag] - appended AFTER the prompt, in yolo mode only
 * @property {string[]} [postPromptArgs] - static flags that must land AFTER the prompt
 * @property {number} [timeoutMs]
 * @property {string} [emptyOutputError]
 */

export const CLAUDE_CFG = {
  bin: 'claude',
  args: ['-p', '--output-format', 'text'],
  promptVia: 'stdin',
};

export const AGY_CFG = {
  bin: 'agy',
  // BUG 1: agy's `-p` requires the prompt as ITS OWN argv value (`agy -p "<prompt>"`).
  // With promptVia:'stdin' + yolo mode, `-p` swallowed the NEXT argv token — the
  // permission flag — as "the prompt", so agy spent every run investigating its own
  // permissions flag instead of doing the task, while the real prompt sat unread on
  // stdin. promptVia:'argv' fixes it: the prompt is inserted right after `-p`, and the
  // permission flag is appended AFTER that.
  args: ['-p'],
  promptVia: 'argv',
  // BUG 2: agy is a native Go executable — it never needed shell:true to resolve on
  // PATH. shell:true makes Node CONCATENATE argv into one cmd.exe string instead of
  // passing each element as a separately-quoted process argument. Invisible for a
  // short prompt; corrupts a real multi-KB prompt with embedded quotes/backticks/
  // newlines. shell:false + promptVia:'argv' is the combination that is actually safe.
  shell: false,
  permissionFlag: '--dangerously-skip-permissions',
  // BUG 3: without an explicit "start fresh" flag, agy treats the run as having no
  // active project and just chats instead of touching any files, even with a real
  // cwd. --new-project makes every run its own fresh, self-contained agy project.
  postPromptArgs: ['--new-project'],
  emptyOutputError: 'agy returned no output — check the installed agy version against AGY_CFG',
};

/** id -> config, for launchCommandFor(). */
export const CLI_AGENT_CONFIG_BY_ID = {
  'claude-code': CLAUDE_CFG,
  agy: AGY_CFG,
};

/**
 * The command a CLI-backed adapter is actually launched with, for display in the UI
 * (PRD ROUTE-6/UI-9). Derived from the SAME config object the spawn uses, so what the
 * UI shows can never drift from what actually runs.
 */
export function launchCommandFor(id) {
  const cfg = CLI_AGENT_CONFIG_BY_ID[id];
  if (!cfg) return undefined; // HTTP adapters (openrouter) have no command line
  const withPost = [...cfg.args, ...(cfg.postPromptArgs ?? [])];
  const args = cfg.permissionFlag ? [...withPost, cfg.permissionFlag] : withPost;
  return [cfg.bin, ...args].join(' ');
}
