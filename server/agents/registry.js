// The 7-agent dependency graph. "Any combination the user picks, as long as a clear
// logical handoff exists" is formalized here as a DAG — generalizing CORE-9's "each
// valid pair is one config entry" from a fixed pair to N agents. This is config, not
// code: runAgentSet (orchestrator.js) topologically sorts a selection against this
// table and validates every role's `requires` before any model is called — an
// unsatisfiable request (e.g. QA with no Backend ever run, in this chat or a prior
// one) is rejected by name, zero wasted model calls. Imports no model client.

export const ROLE_IDS = ['pm', 'architect', 'uiux', 'backend', 'frontend', 'qa', 'docs'];

export const ROLE_LABELS = {
  pm: 'Product Manager',
  architect: 'Solution Architect',
  uiux: 'UI/UX',
  backend: 'Backend',
  frontend: 'Frontend',
  qa: 'QA',
  docs: 'Documentation',
};

/**
 * requires: an OR of AND-groups — [['pm'], ['architect']] means "pm OR architect";
 *   [['uiux', 'backend']] means "uiux AND backend"; [] means no requirement (a valid
 *   entry point that can read the brief directly).
 * reads: which OTHER roles' artifacts this agent's pack includes, when present —
 *   independent of `requires` (e.g. architect can be an entry point but still reads
 *   pm's output when pm was also run).
 */
export const ROLE_GRAPH = {
  pm: { requires: [], reads: [] },
  architect: { requires: [], reads: ['pm'] },
  uiux: { requires: [['pm'], ['architect']], reads: ['pm', 'architect'] },
  backend: { requires: [['architect']], reads: ['architect'] },
  frontend: { requires: [['uiux', 'backend']], reads: ['uiux', 'backend'] },
  qa: { requires: [['backend']], reads: ['pm', 'architect', 'backend', 'frontend'] },
  docs: {
    requires: [['pm'], ['architect'], ['uiux'], ['backend'], ['frontend'], ['qa']],
    reads: ['pm', 'architect', 'uiux', 'backend', 'frontend', 'qa'],
  },
};

export function isSatisfied(role, availableRoles) {
  const { requires } = ROLE_GRAPH[role];
  if (requires.length === 0) return true;
  return requires.some((group) => group.every((r) => availableRoles.has(r)));
}

export function missingRequirement(role, availableRoles) {
  if (isSatisfied(role, availableRoles)) return null;
  const options = ROLE_GRAPH[role].requires.map((g) => g.map((r) => ROLE_LABELS[r]).join(' + ')).join(' OR ');
  return `${ROLE_LABELS[role]} requires: ${options}`;
}

/** In-batch dependency order (DFS topological sort). Cross-batch dependencies (an
 * artifact already committed from an earlier job) impose no ordering constraint here —
 * they're just already satisfied. The graph above is acyclic by construction (docs
 * depends on everything else; nothing depends on docs), so no cycle guard is needed
 * beyond the recursion itself. */
export function topoSort(roles) {
  const batch = new Set(roles);
  const sorted = [];
  const visited = new Set();

  function visit(role) {
    if (visited.has(role)) return;
    visited.add(role);
    const deps = new Set();
    for (const group of ROLE_GRAPH[role].requires) {
      for (const dep of group) if (batch.has(dep)) deps.add(dep);
    }
    for (const dep of deps) visit(dep);
    sorted.push(role);
  }
  for (const role of roles) visit(role);
  return sorted;
}

/**
 * Validates a selection against the chat's already-available artifacts, checking
 * requirements PROGRESSIVELY in topological order — so a role satisfied by another
 * role earlier in the SAME batch is valid, exactly like one already on disk from a
 * prior job (this is what makes "add Frontend next week" and "run
 * Architect+Backend+Frontend together" both valid through the same check).
 * @param {string[]} roles - the requested selection
 * @param {Set<string>} existingRoles - roles with an artifact already committed in this chat
 * @returns {{valid: boolean, order: string[], errors: {role:string, detail:string}[]}}
 */
export function validateSelection(roles, existingRoles = new Set()) {
  const unknown = roles.filter((r) => !ROLE_IDS.includes(r));
  if (unknown.length) {
    return { valid: false, order: [], errors: unknown.map((r) => ({ role: r, detail: `unknown agent role "${r}"` })) };
  }

  const order = topoSort(roles);
  const available = new Set(existingRoles);
  const errors = [];
  for (const role of order) {
    if (!isSatisfied(role, available)) {
      errors.push({ role, detail: missingRequirement(role, available) });
    }
    available.add(role); // this role's own output becomes available to the next one
  }
  return { valid: errors.length === 0, order, errors };
}
