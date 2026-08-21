// Provenance (PRD §8.5), generalized across every role that cites contract ids —
// element_path -> traced_from, so the trace is navigable both directions regardless of
// how many of the 7 roles have run. Pure function — never a model call.

const CITABLE_FIELD_BY_ROLE = { backend: 'modules', frontend: 'modules', uiux: 'screens', qa: 'test_cases' };

/** @param {object} artifacts - { [role]: artifactObject } for whatever roles have run */
export function buildProvenance(artifacts) {
  const entries = [];
  for (const [role, field] of Object.entries(CITABLE_FIELD_BY_ROLE)) {
    const items = artifacts[role]?.[field];
    if (!Array.isArray(items)) continue;
    items.forEach((item, i) => {
      for (const id of item.implements ?? []) {
        entries.push({ element_path: `/${role}/${field}/${i}`, traced_from: id });
      }
    });
  }
  return { artifact: 'multi-role', entries };
}
