import React, { useState } from 'react';
import { ROLE_ICON, IconFile, IconDiagram, IconServer, IconBrowser, IconTerminal, IconTrace, IconPlus } from './icons.jsx';

// The explorer is the workbench's navigation surface: which chat you're in, and every
// artifact that chat has produced, each one a thing you can OPEN — not a panel that
// unfurls in place. Clicking a row raises a tab, exactly like a file in an editor.

function Section({ title, children, defaultOpen = true, action }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div className="section-head" onClick={() => setOpen((o) => !o)}>
        <span className={`twisty ${open ? 'open' : ''}`}>▶</span>
        <span style={{ flex: 1 }}>{title}</span>
        {action}
      </div>
      {open && children}
    </div>
  );
}

const ARTIFACT_VIEWS = {
  architect: [
    { kind: 'diagram', label: 'Architecture diagram', Icon: IconDiagram },
    { kind: 'artifact', label: 'Contract (JSON)', Icon: IconFile },
  ],
  backend: [
    { kind: 'backend-map', label: 'Service map', Icon: IconServer },
    { kind: 'code', label: 'Source', Icon: IconFile },
    { kind: 'api', label: 'API console', Icon: IconTerminal },
  ],
  frontend: [
    { kind: 'preview', label: 'Live preview', Icon: IconBrowser },
    { kind: 'code', label: 'Source', Icon: IconFile },
  ],
  pm: [{ kind: 'artifact', label: 'Features & personas', Icon: IconFile }],
  uiux: [{ kind: 'artifact', label: 'Screens & flows', Icon: IconBrowser }],
  qa: [{ kind: 'artifact', label: 'Test cases', Icon: IconFile }],
  docs: [{ kind: 'artifact', label: 'Documentation', Icon: IconFile }],
};

export default function Explorer({
  chats,
  projects,
  activeChatId,
  chat,
  roleLabels,
  onSelectChat,
  onNewChat,
  onNewProject,
  onOpenTab,
  activeTabId,
}) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  const unfiled = [];
  for (const c of chats) {
    if (c.projectId && byProject.has(c.projectId)) byProject.get(c.projectId).push(c);
    else unfiled.push(c);
  }

  const produced = Object.keys(chat?.artifacts ?? {});

  return (
    <>
      <div className="sidebar-title">
        <span>Explorer</span>
        <button className="btn small ghost" onClick={onNewChat} title="New chat">
          <IconPlus size={13} />
        </button>
      </div>
      <div className="sidebar-scroll">
        {activeChatId && produced.length > 0 && (
          <Section title="Outputs">
            <div style={{ paddingBottom: 8 }}>
              {produced.map((role) =>
                (ARTIFACT_VIEWS[role] ?? []).map((v) => {
                  const id = `${activeChatId}:${v.kind}:${role}`;
                  return (
                    <button
                      key={id}
                      className={`tree-row nested ${activeTabId === id ? 'active' : ''}`}
                      onClick={() => onOpenTab({ kind: v.kind, role, title: `${roleLabels[role] ?? role} · ${v.label}` })}
                    >
                      <span className="dot-icon"><v.Icon size={13} /></span>
                      <span className="label">{v.label}</span>
                    </button>
                  );
                }),
              )}
              {produced.includes('architect') && (
                <button
                  className={`tree-row nested ${activeTabId === `${activeChatId}:trace:` ? 'active' : ''}`}
                  onClick={() => onOpenTab({ kind: 'trace', title: 'Trace matrix' })}
                >
                  <span className="dot-icon"><IconTrace size={13} /></span>
                  <span className="label">Trace matrix</span>
                </button>
              )}
            </div>
          </Section>
        )}

        <Section
          title="Chats"
          action={
            <button
              className="btn small ghost"
              title="New project"
              onClick={(e) => { e.stopPropagation(); onNewProject?.(); }}
            >
              <IconPlus size={11} />
            </button>
          }
        >
          {projects.map((p) => (
            <div key={p.id}>
              <div className="section-head" style={{ paddingLeft: 20, textTransform: 'none', fontWeight: 400 }}>
                {p.name}
              </div>
              {byProject.get(p.id).map((c) => (
                <button
                  key={c.id}
                  className={`tree-row nested ${c.id === activeChatId ? 'active' : ''}`}
                  onClick={() => onSelectChat(c.id)}
                >
                  <span className="label">{c.title || '(untitled)'}</span>
                </button>
              ))}
            </div>
          ))}
          {unfiled.map((c) => (
            <button
              key={c.id}
              className={`tree-row ${c.id === activeChatId ? 'active' : ''}`}
              onClick={() => onSelectChat(c.id)}
            >
              <span className="label">{c.title || '(untitled)'}</span>
            </button>
          ))}
          {chats.length === 0 && <div className="tree-empty">No chats yet.</div>}
        </Section>
      </div>
    </>
  );
}
