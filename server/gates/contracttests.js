// VER-4 — generated contract tests (PRD §16, §24 T9). Test cases are derived
// DETERMINISTICALLY from the same contract data that produced openapi.yaml (deriveOpenApi
// in agents/derive.js) — never by a model — then executed against the LIVE running server
// (runner.js's boot). Imports no model client (PRD §2 non-negotiable #1).
//
// Per PRD §28 Q2: reporting, not blocking. This never throws on a failed assertion and is
// never wired into the pass/fail gate loop the way tiers 1-3 are — a red test here is
// surfaced to the human as a finding ("the handoff is proven by running code, not
// asserted" — §27), not a reason to repair-loop or reject the run.
//
// Two kinds of test per declared API:
//   1. declared_status — hitting the endpoint under default conditions (empty DB, no
//      auth, an empty body) must return ONE of the codes the contract itself declared for
//      that API (200 or any of errors[]) — never an undeclared/opaque failure.
//   2. business_rule   — an api.rules[] entry that starts with a status code
//      ("403 until paid_at set — BR-01") names a guard clause. Against a freshly booted,
//      unseeded database the guarded precondition can never be satisfied, so the guard
//      MUST fire — this is exactly T8's demo scenario (GET /reports/1 unpaid -> 403).

const RULE_CODE_RE = /^(\d{3})\b\s*(.*)$/;

/** Fills `:param` path segments with a placeholder — a fresh in-memory DB has no real ids,
 * so any syntactically valid placeholder exercises the same "not found"/guard code path. */
function fillPath(p) {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '000000000000000000000001');
}

function parseRuleCode(rule) {
  const m = String(rule).match(RULE_CODE_RE);
  return m ? { code: Number(m[1]), note: m[2] } : null;
}

/**
 * Pure function: contract -> test plan. No I/O, no model — exported separately from
 * runContractTests so the plan itself is inspectable/testable without a live server.
 * @param {object} contract - the validated architecture contract
 */
export function buildContractTestPlan(contract) {
  const tests = [];
  for (const api of contract.apis ?? []) {
    const reqPath = fillPath(api.path);

    tests.push({
      id: `${api.id}-declared-status`,
      apiId: api.id,
      kind: 'declared_status',
      method: api.method,
      path: reqPath,
      // The contract only declares its ERROR codes explicitly (errors[]); success is
      // implicitly "any 2xx" — the schema doesn't pin a single success code (200 vs 201
      // vs 204 are all legitimate depending on the verb), so this checks the 2xx family
      // rather than a literal 200.
      declaredErrors: api.errors ?? [],
      description: `${api.method} ${api.path} (${api.id}) should return 2xx or a status the contract declared as an error: ${JSON.stringify(api.errors ?? [])}`,
    });

    for (const rule of api.rules ?? []) {
      const parsed = parseRuleCode(rule);
      if (!parsed) continue; // not every rule string names a status code — only test the ones that do
      tests.push({
        id: `${api.id}-rule-${parsed.code}-${tests.length}`,
        apiId: api.id,
        kind: 'business_rule',
        method: api.method,
        path: reqPath,
        expectedStatus: parsed.code,
        rule,
        description: `${api.method} ${api.path} (${api.id}) — business rule guard: ${rule}`,
      });
    }
  }
  return tests;
}

/**
 * Executes the plan against a live server. Never throws on an assertion failure (§28 Q2) —
 * only a transport-level problem (unreachable server) surfaces as a per-test error, still
 * inside the results array, never as a rejected promise.
 * @param {object} contract
 * @param {string} baseUrl - e.g. http://127.0.0.1:PORT from runner.js
 */
export async function runContractTests(contract, baseUrl, opts = {}) {
  const plan = buildContractTestPlan(contract);
  const timeoutMs = opts.timeoutMs ?? 5000;
  const results = [];

  for (const t of plan) {
    const hasBody = t.method !== 'GET' && t.method !== 'DELETE';
    try {
      const res = await fetch(`${baseUrl}${t.path}`, {
        method: t.method,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? '{}' : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const pass =
        t.kind === 'declared_status' ? (res.status >= 200 && res.status < 300) || t.declaredErrors.includes(res.status) : res.status === t.expectedStatus;
      results.push({ ...t, actualStatus: res.status, pass });
    } catch (e) {
      results.push({ ...t, actualStatus: null, pass: false, error: e.message });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  return {
    schema: 'contracttests/v1',
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}
