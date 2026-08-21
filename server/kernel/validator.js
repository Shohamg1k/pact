// Deterministic validation — the kernel's core guarantee (PRD §8.2). Four passes, ALL
// plain code. No model judges its own homework (principle P1). This file must import
// no model client — that is enforced by a CI grep once one exists (PRD §2 non-negotiable #1).
import { ArchitectureContractSchema } from '../schemas/contract.js';

/** @typedef {{code:string, subject_id?:string, detail:string, recoverable:boolean}} PactErrorEntry */
/** @typedef {{valid:boolean, contract?:object, errors:PactErrorEntry[]}} ValidationResult */

const COMPLETENESS_THRESHOLD = 0.7;

/**
 * Runs all four passes against a raw (untrusted, model-produced) object.
 * @param {unknown} raw
 * @returns {ValidationResult}
 */
export function validateContract(raw) {
  // Pass 1 — schema
  const parsed = ArchitectureContractSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((iss) => ({
        code: 'SCHEMA_INVALID',
        subject_id: iss.path.join('.'),
        detail: iss.message,
        recoverable: true,
      })),
    };
  }
  const contract = parsed.data;
  const errors = [];

  // Pass 2 — coverage: every feature must be cited by >=1 API (catches SILENTLY DROPPED scope)
  const citedFeatureIds = new Set(contract.apis.map((a) => a.feature_id));
  for (const f of contract.features) {
    if (!citedFeatureIds.has(f.id)) {
      errors.push({
        code: 'FEATURE_UNCOVERED',
        subject_id: f.id,
        detail: `feature "${f.name}" (${f.id}) is not cited by any API`,
        recoverable: true,
      });
    }
  }

  // Pass 3 — orphans: every API's feature_id must resolve to a real feature
  // (catches SILENTLY INVENTED scope — the mirror image of pass 2)
  const featureIds = new Set(contract.features.map((f) => f.id));
  for (const a of contract.apis) {
    if (!featureIds.has(a.feature_id)) {
      errors.push({
        code: 'ORPHAN_ELEMENT',
        subject_id: a.id,
        detail: `API ${a.id} (${a.method} ${a.path}) cites feature_id "${a.feature_id}" which does not exist`,
        recoverable: true,
      });
    }
  }

  // Pass 4 — completeness
  if (contract.meta.completeness_score < COMPLETENESS_THRESHOLD) {
    errors.push({
      code: 'UNDERSPECIFIED',
      subject_id: 'meta.completeness_score',
      detail: `completeness_score ${contract.meta.completeness_score} < ${COMPLETENESS_THRESHOLD}`,
      recoverable: true,
    });
  }

  return { valid: errors.length === 0, contract, errors };
}

/** Builds the targeted repair prompt fragment quoting the exact validator errors (PRD §8.2). */
export function repairFeedback(errors) {
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return (
    'The previous output failed validation with these EXACT errors. Fix only these ' +
    'issues; do not otherwise change the structure:\n' +
    lines.join('\n')
  );
}

/** True if the only remaining error is UNDERSPECIFIED (i.e. schema/coverage/orphans all pass). */
export function onlyUnderspecified(errors) {
  return errors.length > 0 && errors.every((e) => e.code === 'UNDERSPECIFIED');
}
