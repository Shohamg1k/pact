// Gate V2 — coverage, drift, conformance (PRD §16 VER-2, §8.5). Deterministic, all plain
// code; imports no model client (PRD §2 non-negotiable #1). Tier 1 (syntax, gates/verify.js)
// runs first — cheapest before expensive (P6) — and if code doesn't even parse there is no
// point computing coverage/drift over it.
import { verifyArtifacts, repairFeedback as tier1RepairFeedback } from './verify.js';
import { resolveStack, extractRoutes as extractForStack } from '../stacks.js';

/** Every module + package.json as a checkable file list for gates/verify.js. */
function moduleFiles(backend) {
  return [
    ...backend.modules.map((m) => ({ path: m.path, content: m.code })),
    { path: 'package.json', content: JSON.stringify(backend.package_json, null, 2) },
  ];
}

/** Tier 1 — syntax. */
export async function runTier1(backend) {
  const result = await verifyArtifacts(moduleFiles(backend));
  if (result.ok) return { valid: true, errors: [] };
  const errors = result.issues.map((i) => ({
    code: 'TIER1_PARSE_FAIL',
    subject_id: i.file,
    detail: i.line ? `${i.file}:${i.line}${i.column != null ? `:${i.column}` : ''} — ${i.message}` : `${i.file} — ${i.message}`,
    recoverable: true,
  }));
  return { valid: false, errors, verifyResult: result };
}

/** Every ID a contract element can legitimately be cited by: features, apis, collections,
 * assumptions, and business rules (parsed from their "BR-xx: ..." prefix, PRD §8.1
 * example). Exported so gates/frontend.js and gates/qa.js can reuse the exact same id
 * space rather than re-deriving it — one shared notion of "a real contract id" across
 * every role.
 *
 * `assumptions` was missing here despite schemas/contract.js's AssumptionSchema giving
 * every one its own `id` (AS-NN) exactly like a feature or collection — live evidence: a
 * Django run's backend cited a real assumption ("AS-05: the API layer is built with
 * Django REST Framework...", justifying its settings.py choices) and DRIFT_REJECTED tier 2
 * rejected the citation as an unknown id, which fell through to P4's pruning and silently
 * dropped settings.py from the committed manifest — a Django tree with no settings module
 * cannot start regardless of anything else being correct. This omission isn't
 * stack-specific: any module on any stack citing an assumption id hit the same false
 * rejection. */
export function collectContractIds(contract) {
  const ids = new Set();
  for (const f of contract.features) ids.add(f.id);
  for (const a of contract.apis) ids.add(a.id);
  for (const c of contract.collections ?? []) ids.add(c.id);
  for (const a of contract.assumptions ?? []) ids.add(a.id);
  for (const r of contract.business_rules ?? []) {
    const m = r.match(/^([A-Za-z]+-\d+)/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Drift (PRD §8.5, VER-2): every module cites >=1 real contract ID. Empty or unknown =
 * DRIFT_REJECTED, rejected by name — the mirror image of Gate V1 pass 3 (ORPHAN_ELEMENT). */
export function checkDrift(contract, backend) {
  const validIds = collectContractIds(contract);
  const errors = [];
  for (const m of backend.modules) {
    const impl = m.implements ?? [];
    if (impl.length === 0) {
      errors.push({
        code: 'DRIFT_REJECTED',
        subject_id: m.path,
        detail: `${m.path} has an empty implements[] — it cites nothing in the contract`,
        recoverable: true,
      });
      continue;
    }
    for (const id of impl) {
      if (!validIds.has(id)) {
        errors.push({
          code: 'DRIFT_REJECTED',
          subject_id: m.path,
          detail: `${m.path} cites unknown contract id "${id}" — not a real feature/api/collection/business-rule id`,
          recoverable: true,
        });
      }
    }
  }
  return errors;
}

/** Django composes its URL space via `path('<prefix>', include('<dotted.module>'))` in a
 * root urlconf, delegating the actual `path(...)` registrations to another file entirely —
 * live evidence: a real generation split `path('api/', include('tracker.urls'))` in
 * config/urls.py from the six real path() calls in tracker/urls.py, and every one of them
 * came back CONFORMANCE_MISMATCH because the extracted route was bare `/projects/...` with
 * no `/api/` prefix at all. Scans every module up front (not just the one being extracted)
 * because the prefix and the paths it applies to live in two different files. Returns a
 * map from the included module's OWN dotted path (Python import convention: a file's
 * dotted path is its `/`-joined directory path with `.py` dropped — `tracker/urls.py` ->
 * `tracker.urls`, matching exactly what `include('tracker.urls')` names) to the prefix
 * string it was mounted under. A no-op map for any stack other than Django, since no other
 * stack here has this two-file indirection. */
function collectDjangoIncludePrefixes(modules) {
  const prefixes = new Map();
  const includeRe = /path\(\s*['"]([^'"]*)['"]\s*,\s*include\(\s*['"]([\w.]+)['"]/g;
  for (const m of modules) {
    includeRe.lastIndex = 0;
    let im;
    while ((im = includeRe.exec(m.code))) prefixes.set(im[2], im[1]);
  }
  return prefixes;
}

/** The raw path literals used as an `include()` mount point within one module — these
 * match the same generic `path(...)` regex as a real route registration (the regex has no
 * way to see the second argument), so they must be excluded from that module's OWN
 * extracted routes or a mount line like `path('api/', include('tracker.urls'))` gets
 * counted as a phantom endpoint `/api/` with no real handler and no contract entry to
 * match. */
function djangoIncludeMountPaths(code) {
  const mounts = new Set();
  const re = /path\(\s*['"]([^'"]*)['"]\s*,\s*include\(/g;
  let m;
  while ((m = re.exec(code))) mounts.add(m[1]);
  return mounts;
}

/** Extracts route registrations from every route-kind module, using the patterns of the
 * stack the contract actually declared (Express, FastAPI, Django, Spring — server/stacks.js)
 * rather than assuming Express. */
export function extractRoutes(modules, stack) {
  const includePrefixes = stack.id === 'django' ? collectDjangoIncludePrefixes(modules) : null;
  const routes = [];
  for (const m of modules) {
    if (m.kind !== 'route') continue;
    const dotted = m.path.replace(/\.py$/, '').replace(/[\\/]/g, '.');
    const prefix = includePrefixes?.get(dotted);
    const mounts = stack.id === 'django' ? djangoIncludeMountPaths(m.code) : null;
    for (const r of extractForStack(stack, m.code)) {
      if (mounts?.has(r.path.replace(/^\/+/, ''))) continue; // an include() mount, not a real endpoint
      const path = prefix ? `/${prefix.replace(/^\/+|\/+$/g, '')}/${r.path.replace(/^\/+/, '')}` : r.path;
      routes.push({ ...r, path, file: m.path });
    }
  }
  return routes;
}

/** Reduces a declared path to a stack-agnostic shape for comparison: every param-
 * placeholder syntax (Express `:id`, OpenAPI/FastAPI `{id}`, Django `<int:pk>`) becomes
 * the same token, and a trailing slash (Django's own URL convention — `path('books/')`,
 * never `path('books')`) doesn't create a phantom mismatch against a contract path that
 * has none. Positional, not name-aware: `{projectId}` and `<int:project_id>` compare
 * equal by POSITION, which is correct here — the same architect-declared param can and
 * (verified live, a real Django contract) does get a different, stack-idiomatic name once
 * the model writes it in framework-native syntax. */
function normalizePath(p) {
  const withoutParams = p
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, ':param')
    .replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ':param')
    .replace(/<(?:[A-Za-z_]+:)?[A-Za-z_][A-Za-z0-9_]*>/g, ':param');
  const trimmed = withoutParams.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** Conformance (VER-2): the router.<method>('<path>') set extracted from code, diffed
 * against the contract's declared APIs. This also IS the API coverage check — a contract
 * API with no matching route in code is definitionally an uncovered feature.
 *
 * Path comparison is normalized (see normalizePath) rather than a literal string match —
 * this stayed Express-string-exact until a live FastAPI/Django run showed the architect
 * writing `{book_id}` (OpenAPI/FastAPI's own syntax, which the generated code also used)
 * and Django's own generated code writing `<int:project_id>`/`<int:projectId>` for the
 * exact same declared param: a literal match rejected conforming code on every
 * parameterized route for both stacks. Method comparison treats a `null` extracted method
 * (Django: the URLconf itself never carries the verb, see stacks.js's methodInRoute) as
 * matching whatever method the contract declared for that path, rather than guessing GET
 * and rejecting every real POST/PATCH/DELETE route Django ever generates. */
export function checkConformance(contract, backend) {
  const codeRoutes = extractRoutes(backend.modules, resolveStack(contract));

  const codeByPath = new Map(); // normalized path -> Set<method>, 'ANY' for a method-less route
  for (const r of codeRoutes) {
    const np = normalizePath(r.path);
    if (!codeByPath.has(np)) codeByPath.set(np, new Set());
    codeByPath.get(np).add(r.method ?? 'ANY');
  }
  const contractByPath = new Map(); // normalized path -> Set<method>
  for (const a of contract.apis) {
    const np = normalizePath(a.path);
    if (!contractByPath.has(np)) contractByPath.set(np, new Set());
    contractByPath.get(np).add(a.method);
  }

  const errors = [];
  for (const a of contract.apis) {
    const methods = codeByPath.get(normalizePath(a.path));
    const matched = methods && (methods.has(a.method) || methods.has('ANY'));
    if (!matched) {
      errors.push({
        code: 'CONFORMANCE_MISMATCH',
        subject_id: a.id,
        detail: `declared ${a.method} ${a.path} (${a.id}) has no matching router.${a.method.toLowerCase()}('${a.path}') in the generated code`,
        recoverable: true,
      });
    }
  }
  for (const r of codeRoutes) {
    const np = normalizePath(r.path);
    const declaredMethods = contractByPath.get(np);
    const matched = declaredMethods && (r.method === null || declaredMethods.has(r.method));
    if (!matched) {
      errors.push({
        code: 'CONFORMANCE_MISMATCH',
        subject_id: r.file,
        detail: `generated route ${r.method ?? '(method not in URLconf)'} ${r.path} in ${r.file} is not declared in the contract's apis[]`,
        recoverable: true,
      });
    }
  }
  return errors;
}

/** Collection coverage (VER-2): every collection is modelled by >=1 module. */
export function checkCollectionCoverage(contract, backend) {
  const implemented = new Set(backend.modules.flatMap((m) => m.implements ?? []));
  const errors = [];
  for (const c of contract.collections ?? []) {
    if (!implemented.has(c.id)) {
      errors.push({
        code: 'CONFORMANCE_MISMATCH',
        subject_id: c.id,
        detail: `collection ${c.id} (${c.name}) has no module citing it — not modelled`,
        recoverable: true,
      });
    }
  }
  return errors;
}

/** Tier 2 — structural: coverage + drift + conformance, all deterministic, no model call. */
export function runTier2(contract, backend) {
  const errors = [...checkDrift(contract, backend), ...checkConformance(contract, backend), ...checkCollectionCoverage(contract, backend)];
  return { valid: errors.length === 0, errors };
}

/** Runs Gate V2 tiers 1 then 2, cheapest first (P6). Tier 3 (npm install / boot) is
 * runner.js's job on feat/runner-connectors, not this gate. */
export async function runGateV2(contract, backend) {
  const t1 = await runTier1(backend);
  if (!t1.valid) return { valid: false, errors: t1.errors, tier: 1 };
  const t2 = runTier2(contract, backend);
  return { valid: t2.valid, errors: t2.errors, tier: t2.valid ? 0 : 2 };
}

/** Builds the targeted repair prompt fragment quoting the exact Gate V2 errors. */
export function repairFeedbackV2(errors) {
  if (errors.length && errors[0].code === 'TIER1_PARSE_FAIL') {
    return tier1RepairFeedback({
      ok: false,
      checked: errors.length,
      issues: errors.map((e) => ({ file: e.subject_id, message: e.detail })),
    });
  }
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return (
    'Gate V2 REJECTED the previous output with these EXACT errors. Fix only these issues; ' +
    'do not otherwise change working modules. DRIFT_REJECTED files must either cite a real ' +
    'contract id or be removed and filed as a gap instead of writing invented code:\n' +
    lines.join('\n')
  );
}

/**
 * P4 (graceful partial output): when repairs are exhausted, drop exactly the modules named
 * by DRIFT_REJECTED / TIER1_PARSE_FAIL errors and proceed with the valid subset (CORE-7).
 * Coverage/conformance gaps that remain can't be fixed by dropping anything — those are
 * reported as gaps by the caller instead. Never used when nothing would survive pruning.
 * @returns {{backend: object, gaps: string[]}|null}
 */
export function pruneInvalidModules(backend, errors) {
  const dropPaths = new Set(errors.filter((e) => e.code === 'DRIFT_REJECTED' || e.code === 'TIER1_PARSE_FAIL').map((e) => e.subject_id));
  if (dropPaths.size === 0) return null;
  const modules = backend.modules.filter((m) => !dropPaths.has(m.path));
  if (modules.length === 0) return null; // nothing survives — no safe valid subset to build
  const gaps = errors.filter((e) => dropPaths.has(e.subject_id)).map((e) => `${e.code}: ${e.detail} (dropped, BLOCKED_ON_UPSTREAM)`);
  return { backend: { ...backend, modules }, gaps };
}
