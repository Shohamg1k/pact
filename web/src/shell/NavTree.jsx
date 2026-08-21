import React, { useState } from 'react';
import { ROLE_ICON, IconAgents, IconInbox, IconSettings, IconPlus, IconCheck } from './icons.jsx';

// Projects → chats → agent runs, as one nested tree. A selected chat highlights as a
// rounded BLOCK enclosing its own runs, so the hierarchy reads as a unit rather than a
// stripe across the pane.

function age(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function StatusRing({ status }) {
  const color = status === 'passed' ? 'var(--green)' : status === 'failed' ? 'var(--red)' : 'var(--accent)';
  return (
    <span className="status-ring">
      <svg viewBox="0 0 14 14" width="13" height="13">
        <circle cx="7" cy="7" r="5.4" fill="none" stroke={color} strokeWidth="1.5" opacity={status === 'running' ? 0.5 : 1} />
        {status === 'passed' && <path d="M4.4 7.1 6.2 8.9 9.7 5.4" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
        {status === 'failed' && <path d="M5 5l4 4M9 5l-4 4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />}
      </svg>
    </span>
  );
}

function ChatBlock({ chat, selected, jobs, running, roleLabels, onSelect, onOpenRole }) {
  const [open, setOpen] = useState(true);
  const mine = jobs.filter((j) => j.role);
  return (
    <div className={`chat-block ${selected ? 'selected' : ''}`}>
      <button className="chat-row" onClick={() => onSelect(chat.id)}>
        <span className={`chat-dot ${running ? 'running' : ''}`} />
        <span className="chat-meta">
          <div className="chat-title">{chat.title || '(untitled)'}</div>
          <div className="chat-sub">{age(chat.updatedAt)} · {mine.length} agent{mine.length === 1 ? '' : 's'}</div>
        </span>
      </button>

      {selected && mine.length > 0 && (
        <>
          <button className="jobs-head" onClick={() => setOpen((o) => !o)}>
            <span className={`twisty ${open ? 'open' : ''}`}>▶</span>
            {mine.length} agent{mine.length === 1 ? '' : 's'}
          </button>
          {open &&
            mine.map((j) => {
              const Icon = ROLE_ICON[j.role];
              return (
                <button key={j.id} className="job-row" onClick={() => onOpenRole(j.role)} title={`${roleLabels[j.role] ?? j.role} — ${j.status}`}>
                  <StatusRing status={j.status} />
                  {Icon && <Icon size={12} />}
                  <span className="jname">{roleLabels[j.role] ?? j.role}</span>
                  <span className="jage">{age(j.endedAt ?? j.startedAt)}</span>
                </button>
              );
            })}
        </>
      )}
    </div>
  );
}

export default function NavTree({
  chats, projects, jobsByChat, activeChatId, running, roleLabels,
  view, onView, onSelectChat, onNewChat, onNewProject, onOpenRole, inboxCount,
}) {
  const byProject = new Map(projects.map((p) => [p.id, []]));
  const unfiled = [];
  for (const c of chats) {
    if (c.projectId && byProject.has(c.projectId)) byProject.get(c.projectId).push(c);
    else unfiled.push(c);
  }

  const block = (c) => (
    <ChatBlock
      key={c.id}
      chat={c}
      selected={c.id === activeChatId}
      jobs={jobsByChat[c.id] ?? []}
      running={c.id === activeChatId && !!running}
      roleLabels={roleLabels}
      onSelect={onSelectChat}
      onOpenRole={onOpenRole}
    />
  );

  return (
    <>
      <div className="brand">
        <span className="brand-mark">P</span>
        <span className="brand-name">PACT</span>
        <button className="icon-btn" title="New chat" onClick={onNewChat}><IconPlus size={14} /></button>
      </div>

      <button className={`nav-item ${view === 'agents' ? 'active' : ''}`} onClick={() => onView('agents')}>
        <IconAgents size={15} /> Agents
      </button>
      <button className={`nav-item ${view === 'inbox' ? 'active' : ''}`} onClick={() => onView('inbox')}>
        <IconInbox size={15} /> Inbox
        {inboxCount > 0 && <span className="count">{inboxCount}</span>}
      </button>
      <button className={`nav-item ${view === 'proof' ? 'active' : ''}`} onClick={() => onView('proof')}>
        <IconCheck size={15} /> Verification
      </button>
      <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => onView('settings')}>
        <IconSettings size={15} /> Settings
      </button>

      <div className="nav-scroll">
        <div className="group-head">
          Projects
          <span className="actions">
            <button className="icon-btn" title="New project" onClick={onNewProject}><IconPlus size={13} /></button>
          </span>
        </div>

        {projects.map((p) => (
          <div className="proj" key={p.id}>
            <div className="proj-row">
              <span className="proj-glyph">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--accent)" strokeWidth="1.5">
                  <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.6h4.5A1.5 1.5 0 0 1 14 6.1v6.4A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5z" />
                </svg>
              </span>
              {p.name}
              <span className="count">{byProject.get(p.id).length}</span>
            </div>
            {byProject.get(p.id).map(block)}
          </div>
        ))}

        {unfiled.length > 0 && (
          <div className="proj">
            {projects.length > 0 && (
              <div className="proj-row" style={{ color: 'var(--text-faint)' }}>
                <span className="proj-glyph">
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="5.5" />
                  </svg>
                </span>
                No project
                <span className="count">{unfiled.length}</span>
              </div>
            )}
            {unfiled.map(block)}
          </div>
        )}

        {chats.length === 0 && <div className="hint" style={{ padding: '6px 16px' }}>No chats yet.</div>}
      </div>
    </>
  );
}
