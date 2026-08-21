import React, { useState } from 'react';
import { isSupported, pickDirectory } from '../lib/fsMirror.js';

// Where should this chat's output land? Asked once, right after the brief is written —
// a project groups related chats, and an optional real OS folder receives every artifact
// as it commits. The folder is a mirror, never the source of truth: `.pact/` on the
// server stays canonical (P3), so declining here costs nothing but convenience.
export default function SaveTargetModal({ projects, onCancel, onConfirm }) {
  const [projectId, setProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [handle, setHandle] = useState(null);
  const [folderName, setFolderName] = useState(null);
  const [error, setError] = useState(null);
  const supported = isSupported();

  async function chooseFolder() {
    setError(null);
    try {
      const dir = await pickDirectory();
      setHandle(dir);
      setFolderName(dir.name);
    } catch (e) {
      // An AbortError just means the user closed the picker — not worth shouting about.
      if (e.name !== 'AbortError') setError(e.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Where should this go?</h2>
        <p className="sub">
          Everything is saved on this machine either way. A project groups related chats; linking a folder also writes
          each agent's output there as real files you can open in an editor.
        </p>

        <div className="section-title" style={{ marginTop: 4 }}>Project</div>
        <div className="modal-row">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project — standalone chat</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            <option value="__new">+ New project…</option>
          </select>
        </div>
        {projectId === '__new' && (
          <div className="modal-row">
            <input
              type="text"
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
            />
          </div>
        )}

        <div className="section-title" style={{ marginTop: 16 }}>Folder (optional)</div>
        {supported ? (
          <div className="modal-row">
            <button className="btn ghost" onClick={chooseFolder}>
              {folderName ? `Linked: ${folderName}` : 'Choose folder…'}
            </button>
            {folderName && (
              <button className="btn small" onClick={() => { setHandle(null); setFolderName(null); }}>
                Unlink
              </button>
            )}
          </div>
        ) : (
          <div className="notice" style={{ marginTop: 0 }}>
            This browser can't grant folder access — that API is Chrome/Edge only. Everything still works; outputs just
            stay inside PACT until you export them.
          </div>
        )}
        {error && <div className="notice bad" style={{ marginTop: 10 }}>{error}</div>}

        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn primary"
            disabled={projectId === '__new' && !newProjectName.trim()}
            onClick={() => onConfirm({ projectId: projectId === '__new' ? null : projectId || null, newProjectName: projectId === '__new' ? newProjectName.trim() : null, handle })}
          >
            Create chat
          </button>
        </div>
      </div>
    </div>
  );
}
