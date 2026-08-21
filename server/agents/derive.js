// Deterministic derivatives of the architecture contract (PRD CORE-3: "openapi.yaml,
// schema.mongo.json, decisions.md ... written to .pact/runs/<id>/"). No model calls —
// these are pure functions over the validated contract.

function yamlEscape(s) {
  if (s == null) return "''";
  const str = String(s);
  return /[:#\-?"'{}[\],&*!|>%@`]/.test(str) || str === '' ? JSON.stringify(str) : str;
}

/** Minimal, hand-rolled OpenAPI 3.1 YAML — no js-yaml dependency needed for this shape. */
export function deriveOpenApi(contract) {
  const lines = [];
  lines.push('openapi: 3.1.0');
  lines.push('info:');
  lines.push(`  title: ${yamlEscape(contract.meta.id)}`);
  lines.push('  version: 1.0.0');
  lines.push('paths:');

  const byPath = new Map();
  for (const api of contract.apis) {
    if (!byPath.has(api.path)) byPath.set(api.path, []);
    byPath.get(api.path).push(api);
  }

  for (const [p, apis] of byPath) {
    lines.push(`  ${yamlEscape(p)}:`);
    for (const api of apis) {
      const method = api.method.toLowerCase();
      lines.push(`    ${method}:`);
      lines.push(`      operationId: ${yamlEscape(api.id)}`);
      lines.push(`      x-feature-id: ${yamlEscape(api.feature_id)}`);
      lines.push('      responses:');
      lines.push(`        '200':`);
      lines.push('          description: OK');
      for (const code of api.errors ?? []) {
        lines.push(`        '${code}':`);
        lines.push(`          description: ${yamlEscape((api.rules ?? []).find((r) => r.includes(String(code))) ?? 'error')}`);
      }
      if ((api.rules ?? []).length) {
        lines.push('      x-rules:');
        for (const r of api.rules) lines.push(`        - ${yamlEscape(r)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

/** Mongoose-shape hints per collection — Agent 2 turns this into real models/*.js. */
export function deriveMongoSchema(contract) {
  return {
    schema: 'schema.mongo/v1',
    collections: contract.collections.map((c) => ({
      id: c.id,
      name: c.name,
      fields: c.fields,
    })),
  };
}

export function deriveDecisions(contract, gaps = []) {
  const lines = [`# Decisions — ${contract.meta.id}`, ''];
  lines.push(`Completeness score: **${contract.meta.completeness_score}**`, '');

  lines.push('## Stack', `- ${contract.stack.default} (db: ${contract.stack.db}, api: ${contract.stack.api})`, '');

  if (contract.assumptions?.length) {
    lines.push('## Assumptions (brief was silent — recorded, not guessed)');
    for (const a of contract.assumptions) {
      lines.push(`- **${a.id}** (confidence ${a.confidence}, source: ${a.source}): ${a.statement}`);
    }
    lines.push('');
  }

  if (contract.business_rules?.length) {
    lines.push('## Business rules', ...contract.business_rules.map((r) => `- ${r}`), '');
  }

  if (gaps.length) {
    lines.push('## Gaps (BLOCKED_ON_UPSTREAM — dropped after repair, needs human follow-up)');
    lines.push(...gaps.map((g) => `- ${g}`));
    lines.push('');
  }

  return lines.join('\n');
}
