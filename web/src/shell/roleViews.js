// Which output views each role offers, most useful first. Single source of truth for
// both the nav tree (which needs to know if a role has more than one view, to offer a
// way to reach the others) and the workbench (which renders them).
export const ROLE_VIEWS = {
  architect: [{ kind: 'diagram', label: 'Architecture' }, { kind: 'schema', label: 'Database schema' }, { kind: 'artifact', label: 'Contract' }],
  backend: [{ kind: 'backend-map', label: 'Service map' }, { kind: 'code', label: 'Source' }, { kind: 'api', label: 'API console' }, { kind: 'contracttests', label: 'Feature tests' }],
  frontend: [{ kind: 'preview', label: 'Live preview' }, { kind: 'code', label: 'Source' }],
  pm: [{ kind: 'artifact', label: 'Features' }],
  uiux: [{ kind: 'artifact', label: 'Screens' }],
  qa: [{ kind: 'artifact', label: 'Tests' }],
  docs: [{ kind: 'artifact', label: 'Docs' }],
};
