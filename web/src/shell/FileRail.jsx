import React, { useMemo, useState } from 'react';
import { IconFile, IconRefresh } from './icons.jsx';

// The generated project as a file tree — the same view you'd get opening the output
// folder in an editor, assembled from whatever roles have run: backend and frontend
// modules under their own roots, the Architect's deterministic derivatives and the
// Documentation agent's markdown at top level, and the raw typed artifacts under
// specs/. Clicking a file opens it as a tab in the outputs pane.
//
// This is a VIEW of artifacts already in memory, not a second source of truth — it
// never fetches a directory listing, so it cannot drift from what the chat actually
// produced.

const EXT_COLOR = {
  js: 'var(--yellow)', jsx: 'var(--blue)', json: 'var(--text-dim)',
  md: 'var(--text-dim)', yaml: 'var(--purple)', yml: 'var(--purple)', css: 'var(--blue)',
};

function FileGlyph({ name }) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return (
    <span className="rail-glyph" style={{ color: EXT_COLOR[ext] ?? 'var(--text-faint)' }}>
      <IconFile size={13} />
    </span>
  );
}

/** Insert `path` into a nested {dirs, files} tree. */
function insert(root, path, payload) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let node = root;
  for (const p of parts) {
    node.dirs[p] = node.dirs[p] ?? { dirs: {}, files: [] };
    node = node.dirs[p];
  }
  node.files.push({ name, path, ...payload });
}

function buildTree(artifacts) {
  const root = { dirs: {}, files: [] };

  for (const [role, prefix] of [['backend', 'backend'], ['frontend', 'frontend']]) {
    for (const m of artifacts[role]?.modules ?? []) {
      insert(root, `${prefix}/${m.path}`, { kind: 'module', role, modulePath: m.path, implements: m.implements });
    }
    if (artifacts[role]?.package_json) {
      insert(root, `${prefix}/package.json`, { kind: 'inline', text: JSON.stringify(artifacts[role].package_json, null, 2) });
    }
  }

  // Architect's deterministic derivatives + the docs agent's markdown — real chat-root
  // files on the server, fetched by name.
  if (artifacts.architect) {
    for (const f of ['openapi.yaml', 'schema.mongo.json', 'decisions.md']) insert(root, f, { kind: 'chatfile', name: f });
  }
  if (artifacts.docs) {
    for (const f of ['technical-spec.md', 'user-guide.md']) insert(root, f, { kind: 'chatfile', name: f });
  }

  for (const role of Object.keys(artifacts)) {
    insert(root, `specs/${role}.json`, { kind: 'artifact', role });
  }
  return root;
}

function Dir({ name, node, depth, onOpen, activePath, filter }) {
  const [open, setOpen] = useState(depth < 1);
  const dirNames = Object.keys(node.dirs).sort();
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  const visible = filter
    ? files.filter((f) => f.path.toLowerCase().includes(filter)) : files;
  const childHas = (n) =>
    !filter ||
    n.files.some((f) => f.path.toLowerCase().includes(filter)) ||
    Object.values(n.dirs).some(childHas);

  const shown = dirNames.filter((d) => childHas(node.dirs[d]));
  if (filter && visible.length === 0 && shown.length === 0) return null;

  return (
    <>
      {name && (
        <button className="rail-row dir" style={{ paddingLeft: 8 + depth * 11 }} onClick={() => setOpen((o) => !o)}>
          <span className={`twisty ${open || filter ? 'open' : ''}`}>▶</span>
          <span className="rail-name">{name}</span>
        </button>
      )}
      {(open || filter) && (
        <>
          {shown.map((d) => (
            <Dir key={d} name={d} node={node.dirs[d]} depth={depth + 1} onOpen={onOpen} activePath={activePath} filter={filter} />
          ))}
          {visible.map((f) => (
            <button
              key={f.path}
              className={`rail-row ${activePath === f.path ? 'active' : ''}`}
              style={{ paddingLeft: 8 + (depth + (name ? 1 : 0)) * 11 }}
              onClick={() => onOpen(f)}
              title={f.implements?.length ? `implements ${f.implements.join(', ')}` : f.path}
            >
              <FileGlyph name={f.name} />
              <span className="rail-name">{f.name}</span>
            </button>
          ))}
        </>
      )}
    </>
  );
}

export default function FileRail({ chatTitle, artifacts, onOpenFile, activePath, onRefresh }) {
  const [q, setQ] = useState('');
  const tree = useMemo(() => buildTree(artifacts ?? {}), [artifacts]);
  const count = useMemo(() => {
    let n = 0;
    const walk = (t) => { n += t.files.length; Object.values(t.dirs).forEach(walk); };
    walk(tree);
    return n;
  }, [tree]);

  return (
    <>
      <div className="rail-head">
        <span className="rail-title">{chatTitle ? chatTitle.slice(0, 26) : 'No chat'}</span>
        <button className="icon-btn" title="Reload artifacts" onClick={onRefresh}><IconRefresh size={13} /></button>
      </div>
      <div className="rail-search">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter files…" />
      </div>
      <div className="rail-scroll">
        {count === 0 ? (
          <div className="hint" style={{ padding: '10px 12px', lineHeight: 1.6 }}>
            Nothing generated yet. Files appear here as agents commit.
          </div>
        ) : (
          <Dir name={null} node={tree} depth={0} onOpen={onOpenFile} activePath={activePath} filter={q.trim().toLowerCase()} />
        )}
      </div>
      <div className="rail-foot">{count} file{count === 1 ? '' : 's'}</div>
    </>
  );
}
