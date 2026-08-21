import CodeEditor from './CodeEditor.jsx';
import React, { useEffect, useState } from 'react';
import { getArtifact, saveModule } from '../api.js';

const EDITABLE_ROLES = new Set(['backend', 'frontend']);

// Generalized from backend-only to any role whose artifact has a modules[] array
// (backend, frontend — both share the shape: {path, kind, implements, code}).
function normalizeManifest(raw) {
  if (!raw?.modules || !Array.isArray(raw.modules)) return null;
  return raw.modules.map((m) => ({ path: m.path, kind: m.kind, implements: m.implements ?? [], code: m.code ?? '' }));
}

export default function CodeViewer({ chatId, role, refreshKey, jumpTo, onJumped }) {
  const [manifest, setManifest] = useState(undefined); // undefined = loading, null = absent
  const [active, setActive] = useState(null);
  const [draft, setDraft] = useState(null); // uncommitted edit, keyed off `active`
  const [saveState, setSaveState] = useState(null); // null | 'saving' | 'saved' | 'restarted' | error string

  useEffect(() => {
    let cancelled = false;
    getArtifact(chatId, role).then((raw) => {
      if (cancelled) return;
      setManifest(normalizeManifest(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, role, refreshKey]);

  useEffect(() => {
    setDraft(null);
    setSaveState(null);
  }, [active]);

  async function save(activeModule) {
    setSaveState('saving');
    const res = await saveModule(chatId, role, activeModule.path, draft);
    if (!res.ok) {
      setSaveState(res.body?.detail ?? 'save failed');
      return;
    }
    setManifest((prev) => prev.map((m) => (m.path === activeModule.path ? { ...m, code: draft } : m)));
    setDraft(null);
    setSaveState(res.body.restarted ? 'restarted' : 'saved');
  }

  useEffect(() => {
    if (jumpTo) {
      setActive(jumpTo);
      onJumped?.();
    }
  }, [jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (manifest === undefined) return <div className="empty-state">loading…</div>;
  if (manifest === null) return <div className="empty-state">{role} hasn't run yet.</div>;
  if (manifest.length === 0) return <div className="empty-state">{role} produced an empty manifest.</div>;

  const activeModule = manifest.find((f) => f.path === active);

  return (
    <div className="code-layout">
      <div className="file-tree">
        {manifest.map((f) => (
          <div key={f.path} className={`file-row ${active === f.path ? 'selected' : ''}`} onClick={() => setActive(f.path)}>
            <div>
              {f.path} <span style={{ color: 'var(--text-faint)' }}>· {f.kind}</span>
            </div>
            <div className="implements">
              {f.implements.length === 0 && <span className="chip orphan">implements: [] (orphan)</span>}
              {f.implements.map((id) => (
                <span key={id} className="chip">
                  {id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="file-pane">
        {!activeModule && <div className="empty-state" style={{ padding: 18 }}>Select a file to view its contents.</div>}
        {activeModule && (
          <>
            {EDITABLE_ROLES.has(role) && (
              <div className="toolbar" style={{ padding: '6px 10px', margin: 0, borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
                <span className="hint">
                  {draft !== null ? 'unsaved changes' : saveState === 'restarted' ? 'saved — live preview restarted' : saveState === 'saved' ? 'saved' : ' '}
                </span>
                <span style={{ flex: 1 }} />
                <button className="btn small" disabled={draft === null || saveState === 'saving'} onClick={() => save(activeModule)}>
                  {saveState === 'saving' ? 'Saving…' : 'Save & restart preview'}
                </button>
              </div>
            )}
            <div className="editor-host">
              <CodeEditor
                value={draft ?? activeModule.code}
                path={activeModule.path}
                onChange={EDITABLE_ROLES.has(role) ? (v) => setDraft(v) : undefined}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
