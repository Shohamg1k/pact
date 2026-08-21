import React, { useEffect, useState } from 'react';
import { createChat, createProject, listProjects } from '../api.js';
import { navigate } from '../lib/router.jsx';
import { pickDirectory, linkFolder, isSupported } from '../lib/fsMirror.js';

// "Type something, press Enter" (per the product brief) creates the chat's TEXT
// immediately in local state, then asks where to save it — the chat itself isn't
// created server-side until that choice resolves, so it's born with the right
// projectId rather than needing a separate reassignment call.
export default function HomePage({ onChatCreated }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingText, setPendingText] = useState(null);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    listProjects().then((r) => setProjects(r.projects ?? []));
  }, []);

  function submit(e) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setPendingText(text.trim());
  }

  async function finish(projectId, folderHandle, folderKey) {
    setBusy(true);
    const chat = await createChat(pendingText, { projectId: projectId ?? undefined });
    if (folderHandle) await linkFolder(folderKey ?? chat.id, folderHandle);
    setBusy(false);
    setPendingText(null);
    setText('');
    onChatCreated?.();
    navigate(`/chat/${chat.id}`);
  }

  return (
    <div className="home-page">
      <h1>What are we building?</h1>
      <p className="tagline">One brief. Any combination of Product Manager, Solution Architect, UI/UX, Backend, Frontend, QA, and Documentation agents — pick two, a few, or all seven.</p>
      <form className="composer" onSubmit={submit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          placeholder="Describe what you want built…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <button className="btn primary" type="submit" disabled={!text.trim()}>
          Start
        </button>
      </form>

      {pendingText && (
        <SaveLocationModal
          projects={projects}
          busy={busy}
          onChooseProject={(projectId) => finish(projectId, null)}
          onChooseNewProject={async (name, withFolder) => {
            const project = await createProject(name);
            setProjects((p) => [...p, project]);
            let handle = null;
            if (withFolder && isSupported()) {
              try {
                handle = await pickDirectory();
              } catch {
                /* user cancelled the picker — project still created, just unlinked */
              }
            }
            finish(project.id, handle, project.id);
          }}
          onChooseFolderOnly={async () => {
            let handle = null;
            if (isSupported()) {
              try {
                handle = await pickDirectory();
              } catch {
                /* cancelled */
              }
            }
            finish(null, handle);
          }}
          onSkip={() => finish(null, null)}
          onCancel={() => setPendingText(null)}
        />
      )}
    </div>
  );
}

function SaveLocationModal({ projects, busy, onChooseProject, onChooseNewProject, onChooseFolderOnly, onSkip, onCancel }) {
  const [mode, setMode] = useState(projects.length ? 'existing' : 'new');
  const [newName, setNewName] = useState('');
  const [newWithFolder, setNewWithFolder] = useState(true);
  const [existingId, setExistingId] = useState(projects[0]?.id ?? '');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Save this chat to…</h2>
        {!isSupported() && (
          <p className="gap-notice">This browser can't grant real folder access (Chrome/Edge only) — you can still organize by project, just without a linked OS folder.</p>
        )}

        <div className="tab-row">
          {projects.length > 0 && (
            <button className={mode === 'existing' ? 'active' : ''} onClick={() => setMode('existing')}>
              Existing project
            </button>
          )}
          <button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>
            New project
          </button>
          <button className={mode === 'folder' ? 'active' : ''} onClick={() => setMode('folder')}>
            Just a folder
          </button>
        </div>

        {mode === 'existing' && (
          <div className="modal-row">
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={busy || !existingId} onClick={() => onChooseProject(existingId)}>
              Save
            </button>
          </div>
        )}

        {mode === 'new' && (
          <div className="modal-row">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="project name" />
            <label className="checkbox-row">
              <input type="checkbox" checked={newWithFolder} onChange={(e) => setNewWithFolder(e.target.checked)} disabled={!isSupported()} />
              also pick a folder
            </label>
            <button className="btn primary" disabled={busy || !newName.trim()} onClick={() => onChooseNewProject(newName.trim(), newWithFolder)}>
              Create & save
            </button>
          </div>
        )}

        {mode === 'folder' && (
          <div className="modal-row">
            <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>No project grouping — just link an OS folder to this one chat.</span>
            <button className="btn primary" disabled={busy || !isSupported()} onClick={onChooseFolderOnly}>
              Choose folder
            </button>
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
          <button className="btn small" onClick={onSkip} disabled={busy}>
            Skip — no project, no folder
          </button>
          <button className="btn small" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
