import React, { useEffect, useState } from 'react';
import { listChats, listProjects, createProject } from '../api.js';
import { useRoute, navigate, matchRoute } from '../lib/router.jsx';
import { pickDirectory, linkFolder, isSupported } from '../lib/fsMirror.js';

const NAV_ITEMS = [
  { path: '/settings', label: 'Settings' },
  { path: '/connectors', label: 'Connectors' },
  { path: '/skills', label: 'Skills' },
  { path: '/plugins', label: 'Plugins' },
  { path: '/customize', label: 'Customize' },
];

export default function Sidebar() {
  const { path } = useRoute();
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const activeChatId = matchRoute('/chat/:id', path)?.id;

  useEffect(() => {
    async function poll() {
      const [c, p] = await Promise.all([listChats(), listProjects()]);
      setChats(c.chats ?? []);
      setProjects(p.projects ?? []);
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  const byProject = new Map(projects.map((p) => [p.id, { project: p, chats: [] }]));
  const unfiled = [];
  for (const c of chats) {
    if (c.projectId && byProject.has(c.projectId)) byProject.get(c.projectId).chats.push(c);
    else unfiled.push(c);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">PACT</div>

      <button className="btn primary sidebar-new" onClick={() => navigate('/')}>
        + New chat
      </button>
      <button className="btn sidebar-new-secondary" onClick={() => setShowNewProject(true)}>
        + New project
      </button>

      <div className="sidebar-chats">
        {[...byProject.values()].map(({ project, chats: pchats }) => (
          <div key={project.id} className="sidebar-project">
            <div className="sidebar-project-name">{project.name}</div>
            {pchats.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === activeChatId} />
            ))}
          </div>
        ))}
        {unfiled.length > 0 && (
          <div className="sidebar-project">
            {projects.length > 0 && <div className="sidebar-project-name faint">No project</div>}
            {unfiled.map((c) => (
              <ChatRow key={c.id} chat={c} active={c.id === activeChatId} />
            ))}
          </div>
        )}
        {chats.length === 0 && <div className="sidebar-empty">No chats yet.</div>}
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button key={item.path} className={`sidebar-nav-item ${path === item.path ? 'active' : ''}`} onClick={() => navigate(item.path)}>
            {item.label}
          </button>
        ))}
      </nav>

      {showNewProject && <NewProjectModal onClose={() => setShowNewProject(false)} onCreated={(p) => setProjects((prev) => [...prev, p])} />}
    </aside>
  );
}

function ChatRow({ chat, active }) {
  return (
    <button className={`sidebar-chat-row ${active ? 'active' : ''}`} onClick={() => navigate(`/chat/${chat.id}`)}>
      {chat.title || '(untitled)'}
    </button>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const project = await createProject(name.trim());
    if (isSupported()) {
      try {
        const handle = await pickDirectory();
        await linkFolder(project.id, handle);
      } catch {
        /* user cancelled the picker — project still created, just unlinked */
      }
    }
    setBusy(false);
    onCreated(project);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New project</h2>
        <div className="modal-row">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="project name" autoFocus />
        </div>
        {!isSupported() && <p className="gap-notice">This browser can't grant real folder access (Chrome/Edge only) — the project is created without a linked folder.</p>}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn small" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn small primary" onClick={create} disabled={busy || !name.trim()}>
            {isSupported() ? 'Choose folder & create' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
