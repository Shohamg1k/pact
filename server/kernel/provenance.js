// Provenance (PRD §8.5): every generated file records the contract ids it implements; this
// inverts that into element_path -> traced_from so the trace is navigable both directions.
// Pure function over the backend manifest — never a model call.

/** @param {object} backend - a validated backend/v1 manifest (schemas/backend.js) */
export function buildProvenance(backend) {
  const entries = [];
  backend.modules.forEach((m, i) => {
    for (const id of m.implements ?? []) {
      entries.push({ element_path: `/files/${i}`, traced_from: id });
    }
  });
  return { artifact: 'backend', entries };
}
