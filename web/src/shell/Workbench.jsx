import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listChats, listProjects, getChat, createChat, streamChat, getArtifact, getFile,
  generateRoles, getAgentGraph, getAdapters, startPreview, createProject, listInbox,
} from '../api.js';
import { parseWorklog } from '../lib/worklog.js';
import { getLinkedHandle, linkFolder, hasPermission, mirrorRole } from '../lib/fsMirror.js';
import NavTree from './NavTree.jsx';
import Conversation from './Conversation.jsx';
import AgentPanel from './AgentPanel.jsx';
import SettingsView from './SettingsView.jsx';
import SaveTargetModal from './SaveTargetModal.jsx';
import FileRail from './FileRail.jsx';
import AdapterSettings from '../components/AdapterSettings.jsx';
import Inbox from '../components/Inbox.jsx';
import CodeViewer from '../components/CodeViewer.jsx';
import TraceMatrix from '../components/TraceMatrix.jsx';
import PMViewer from '../components/PMViewer.jsx';
import UiuxViewer from '../components/UiuxViewer.jsx';
import QAViewer from '../components/QAViewer.jsx';
import DocsViewer from '../components/DocsViewer.jsx';
import ArchitectureDiagram from '../tabs/ArchitectureDiagram.jsx';
import BackendMap from '../tabs/BackendMap.jsx';
import LivePreview from '../tabs/LivePreview.jsx';
import ApiConsole from '../tabs/ApiConsole.jsx';
import ProvenanceTab from '../tabs/ProvenanceTab.jsx';
import PackViewer from '../tabs/PackViewer.jsx';
import FileTab from '../tabs/FileTab.jsx';
import { ROLE_ICON, IconDiagram, IconServer, IconBrowser, IconTerminal, IconTrace, IconFile, IconCheck } from './icons.jsx';

const TAB_ICON = {
  diagram: IconDiagram, 'backend-map': IconServer, preview: IconBrowser, api: IconTerminal,
  trace: IconTrace, code: IconFile, artifact: IconFile, provenance: IconCheck, pack: IconFile, file: IconFile,
};

// Which output views each role offers, most useful first — clicking a run in the tree
// opens the first entry.
const ROLE_VIEWS = {
  architect: [{ kind: 'diagram', label: 'Architecture' }, { kind: 'artifact', label: 'Contract' }],
  backend: [{ kind: 'backend-map', label: 'Service map' }, { kind: 'code', label: 'Source' }, { kind: 'api', label: 'API console' }],
  frontend: [{ kind: 'preview', label: 'Live preview' }, { kind: 'code', label: 'Source' }],
  pm: [{ kind: 'artifact', label: 'Features' }],
  uiux: [{ kind: 'artifact', label: 'Screens' }],
  qa: [{ kind: 'artifact', label: 'Tests' }],
  docs: [{ kind: 'artifact', label: 'Docs' }],
};

export default function Workbench() {
  const [view, setView] = useState('agents');
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
  const [jobsByChat, setJobsByChat] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);
  const [chat, setChat] = useState(null);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [running, setRunning] = useState(null);
  const [failed, setFailed] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [worklog, setWorklog] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [artifacts, setArtifacts] = useState({});
  const [showAdapters, setShowAdapters] = useState(false);
  const [adapters, setAdapters] = useState([]);
  const [jumpFile, setJumpFile] = useState(null);
  const [pendingBrief, setPendingBrief] = useState(null);
  const [startingBackend, setStartingBackend] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [showRail, setShowRail] = useState(true);
  const folderRef = useRef(null);
  const unsubRef = useRef(null);

  const roleLabels = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r.label])), [roles]);
  const activeAdapter = adapters.find((a) => a.available);

  useEffect(() => {
    getAgentGraph().then((r) => setRoles(r.roles ?? []));
    getAdapters().then((r) => setAdapters(r.adapters ?? []));
  }, []);

  const refreshLists = useCallback(async () => {
    const [c, p] = await Promise.all([listChats(), listProjects()]);
    setChats(c.chats ?? []);
    setProjects(p.projects ?? []);
    listInbox().then((r) => setInboxCount((r.items ?? []).filter((i) => i.status === 'pending').length)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshLists();
    const id = setInterval(refreshLists, 8000);
    return () => clearInterval(id);
  }, [refreshLists]);

  const loadChat = useCallback(async (chatId) => {
    const c = await getChat(chatId);
    setChat(c);
    setJobsByChat((m) => ({ ...m, [chatId]: c.jobs ?? [] }));
    const roleIds = Object.keys(c.artifacts ?? {});
    const loaded = {};
    await Promise.all(roleIds.map(async (r) => { loaded[r] = await getArtifact(chatId, r); }));
    setArtifacts(loaded);
    return c;
  }, []);

  // Mirror one committed role into the linked OS folder. Best-effort: `.pact/` stays
  // canonical, so a failed write must never fail an otherwise-successful run.
  const mirror = useCallback(async (chatId, role) => {
    const handle = folderRef.current;
    if (!handle || !role) return;
    try {
      const artifact = await getArtifact(chatId, role);
      if (artifact) await mirrorRole(handle, role, artifact);
    } catch (e) {
      console.warn('[pact] folder mirror failed for', role, e);
    }
  }, []);

  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    setSelected(new Set());
    setFailed(new Set());
    setRunning(null);
    setGenError(null);
    loadChat(activeChatId);

    getLinkedHandle(`chat:${activeChatId}`).then(async (h) => {
      folderRef.current = h && (await hasPermission(h)) ? h : null;
    });

    unsubRef.current?.();
    unsubRef.current = streamChat(activeChatId, (evt) => {
      if (cancelled) return;
      if (evt.role === 'preview') return; // preview lifecycle belongs on the status bar, not the agent list
      if (evt.status === 'running') setRunning(evt.role);
      if (evt.status === 'failed') { setFailed((f) => new Set([...f, evt.role])); setRunning(null); }
      if (evt.status === 'passed') { setRunning(null); loadChat(activeChatId).then(() => mirror(activeChatId, evt.role)); }
      if (evt.status === 'awaiting_human') { setRunning(null); loadChat(activeChatId); }
    });

    const t = setInterval(async () => {
      const text = await getFile(activeChatId, 'worklog.jsonl');
      if (!cancelled) setWorklog(parseWorklog(text));
    }, 2000);

    return () => { cancelled = true; unsubRef.current?.(); clearInterval(t); };
  }, [activeChatId, loadChat, mirror]);

  const openTab = useCallback((spec) => {
    const id = `${activeChatId}:${spec.kind}:${spec.role ?? ''}`;
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { ...spec, id, chatId: activeChatId }]));
    setActiveTabId(id);
  }, [activeChatId]);

  const closeTab = useCallback((id, e) => {
    e?.stopPropagation();
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur !== id ? cur : next[Math.max(0, idx - 1)]?.id ?? null));
      return next;
    });
  }, []);

  const openRailFile = useCallback((entry) => {
    const id = `${activeChatId}:file:${entry.path}`;
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { kind: 'file', entry, id, chatId: activeChatId, title: entry.name }]));
    setActiveTabId(id);
  }, [activeChatId]);

  /** Clicking an agent run in the tree opens that role's most useful view. */
  const openRole = useCallback((role) => {
    const v = (ROLE_VIEWS[role] ?? [{ kind: 'artifact', label: 'Output' }])[0];
    openTab({ kind: v.kind, role, title: `${roleLabels[role] ?? role} · ${v.label}` });
  }, [openTab, roleLabels]);

  function selectChat(id) {
    setActiveChatId(id);
    setTabs([]);
    setActiveTabId(null);
  }

  async function confirmSaveTarget({ projectId, newProjectName, handle }) {
    const brief = pendingBrief;
    setPendingBrief(null);
    let pid = projectId;
    if (newProjectName) pid = (await createProject(newProjectName)).id;
    const created = await createChat(brief, { projectId: pid });
    if (handle) await linkFolder(`chat:${created.id}`, handle);
    folderRef.current = handle ?? null;
    await refreshLists();
    setTabs([]);
    setActiveTabId(null);
    setActiveChatId(created.id);
    setView('agents');
  }

  async function handleGenerate() {
    setBusy(true);
    setGenError(null);
    const res = await generateRoles(activeChatId, [...selected]);
    setBusy(false);
    if (!res.ok) {
      setGenError(res.body?.details?.map((d) => d.detail).join(' · ') || res.body?.code || 'Could not start that selection.');
      return;
    }
    setRunning(res.body.order[0]);
    setSelected(new Set());
  }

  const existing = useMemo(() => new Set(Object.keys(chat?.artifacts ?? {})), [chat]);
  const backendLive = !!chat?.preview?.live;

  const startBackend = useCallback(async () => {
    setStartingBackend(true);
    await startPreview(activeChatId);
    await loadChat(activeChatId);
    setStartingBackend(false);
  }, [activeChatId, loadChat]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  function renderTab(tab) {
    const a = artifacts;
    switch (tab.kind) {
      case 'diagram': return <ArchitectureDiagram contract={a.architect} />;
      case 'backend-map':
        return <BackendMap manifest={a.backend} contract={a.architect}
          onOpenFile={(p) => { setJumpFile({ role: 'backend', path: p }); openTab({ kind: 'code', role: 'backend', title: 'Backend · Source' }); }} />;
      case 'preview':
        return <LivePreview chatId={tab.chatId} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'api':
        return <ApiConsole chatId={tab.chatId} contract={a.architect} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'provenance':
        return <ProvenanceTab chatId={tab.chatId} chat={chat} roles={roles}
          onOpenPack={(role, jobId) => openTab({ kind: 'pack', role, jobId, title: `${roleLabels[role] ?? role} · Pack` })} />;
      case 'file': return <FileTab chatId={tab.chatId} entry={tab.entry} artifacts={artifacts} />;
      case 'pack': return <PackViewer chatId={tab.chatId} jobId={tab.jobId} roleLabel={roleLabels[tab.role] ?? tab.role} />;
      case 'trace':
        return <div className="pad"><TraceMatrix chatId={tab.chatId} refreshKey={Object.keys(a).join()}
          onJumpToFile={(role, path) => { setJumpFile({ role, path }); openTab({ kind: 'code', role, title: `${roleLabels[role]} · Source` }); }} /></div>;
      case 'code':
        return <CodeViewer chatId={tab.chatId} role={tab.role} refreshKey={tab.role}
          jumpTo={jumpFile?.role === tab.role ? jumpFile.path : null} onJumped={() => setJumpFile(null)} />;
      case 'artifact':
      default: {
        const art = a[tab.role];
        if (tab.role === 'pm') return <div className="pad"><PMViewer artifact={art} /></div>;
        if (tab.role === 'uiux') return <div className="pad"><UiuxViewer artifact={art} /></div>;
        if (tab.role === 'qa') return <div className="pad"><QAViewer artifact={art} /></div>;
        if (tab.role === 'docs') return <div className="pad"><DocsViewer artifact={art} /></div>;
        return <div className="pad"><pre className="code-block">{JSON.stringify(art, null, 2)}</pre></div>;
      }
    }
  }

  const activeFilePath = activeTab?.kind === 'file' ? activeTab.entry.path : null;

  return (
    <div className={`shell ${showRail ? '' : 'no-rail'}`}>
      <div className="pane nav">
        <NavTree
          chats={chats} projects={projects} jobsByChat={jobsByChat}
          activeChatId={activeChatId} running={running} roleLabels={roleLabels}
          view={view} onView={setView} inboxCount={inboxCount}
          onSelectChat={selectChat}
          onNewChat={() => { setActiveChatId(null); setChat(null); setTabs([]); setActiveTabId(null); }}
          onNewProject={async () => {
            const name = window.prompt('Project name');
            if (name && name.trim()) { await createProject(name.trim()); await refreshLists(); }
          }}
          onOpenRole={openRole}
        />
        <div className="nav-foot">
          <span className="hint" style={{ flex: 1 }}>{activeAdapter ? activeAdapter.name : 'no adapter'}</span>
          <button className="icon-btn" title="Adapter details" onClick={() => setShowAdapters(true)}>⚙</button>
        </div>
      </div>

      <div className="pane centre">
        {!activeChatId ? (
          <Welcome onStart={setPendingBrief} />
        ) : (
          <div className="pane-body">
            <Conversation
              chat={chat} worklog={worklog} roleLabels={roleLabels} running={running}
              chatId={activeChatId} adapterName={activeAdapter?.name}
              onAnswered={() => loadChat(activeChatId)}
            />
          </div>
        )}
      </div>

      <div className="pane out">
        <SidePanel
          view={view} roles={roles} existing={existing} running={running} failed={failed}
          selected={selected} roleLabels={roleLabels} busy={busy || !!running} error={genError}
          activeChatId={activeChatId} chat={chat} artifacts={artifacts}
          onToggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
          onGenerate={handleGenerate} onOpenAdapters={() => setShowAdapters(true)}
          onAnswered={() => loadChat(activeChatId)} onOpenTab={openTab}
        />
        {tabs.length > 0 && (
          <div className="tabstrip">
            {tabs.map((t) => {
              const Icon = TAB_ICON[t.kind] ?? ROLE_ICON[t.role] ?? IconFile;
              return (
                <div key={t.id} className={`tabx ${t.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTabId(t.id)}>
                  <Icon size={13} />
                  <span className="tl">{t.title}</span>
                  <button className="tx" onClick={(e) => closeTab(t.id, e)}>×</button>
                </div>
              );
            })}
          </div>
        )}
        <div className="pane-body">
          {activeTab ? renderTab(activeTab) : (
            <div className="empty-pane">
              <div>
                <div className="big">Outputs open here</div>
                <div>Run agents, then click a run in the sidebar to open what it produced.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="pane rail">
        <FileRail
          chatTitle={chat?.chat?.title}
          artifacts={artifacts}
          activePath={activeFilePath}
          onOpenFile={openRailFile}
          onRefresh={() => activeChatId && loadChat(activeChatId)}
        />
      </div>

      <div className="statusbar">
        <span className={`status-item ${running ? 'busy' : ''}`}>{running ? `● ${roleLabels[running] ?? running}` : chat ? '○ idle' : 'PACT'}</span>
        {chat && <span className="status-item">{existing.size}/7 agents</span>}
        {chat && backendLive && <span className="status-item live">● backend live</span>}
        {chat && !backendLive && existing.has('backend') && (
          <span className="status-item clickable" onClick={startingBackend ? undefined : startBackend}>
            {startingBackend ? '◐ starting backend…' : '○ backend stopped — start'}
          </span>
        )}
        <span className="status-spacer" />
        {chat && (
          <span className="status-item clickable" onClick={() => openTab({ kind: 'provenance', title: 'Provenance & proof' })}>
            verify handoffs
          </span>
        )}
        <span className="status-item">{activeAdapter?.name ?? 'no adapter'}</span>
        <span className="status-item clickable" title="Toggle the file rail" onClick={() => setShowRail((v) => !v)}>
          {showRail ? '▐ files' : '▌ files'}
        </span>
      </div>

      {showAdapters && <AdapterSettings onClose={() => setShowAdapters(false)} />}
      {pendingBrief && <SaveTargetModal projects={projects} onCancel={() => setPendingBrief(null)} onConfirm={confirmSaveTarget} />}
    </div>
  );
}

/** The right pane's upper section: whichever nav view is active. Capped in height so the
 * output tabs below it always stay visible. */
function SidePanel(props) {
  const { view, activeChatId, chat, artifacts, onOpenTab } = props;
  const wrap = (children, pad) => (
    <div style={{ borderBottom: '1px solid var(--border-soft)', maxHeight: '50%', overflowY: 'auto', flexShrink: 0, padding: pad }}>
      {children}
    </div>
  );

  if (view === 'agents') return wrap(<AgentPanel {...props} disabled={!activeChatId} />);
  if (view === 'settings') return wrap(<SettingsView chatId={activeChatId} artifacts={chat?.artifacts} onOpenAdapters={props.onOpenAdapters} />);
  if (view === 'inbox') {
    return wrap(
      <>
        <div className="section-title">Inbox</div>
        {activeChatId ? <Inbox chatId={activeChatId} onAnswered={props.onAnswered} /> : <div className="hint">No chat selected.</div>}
      </>,
      '12px 14px',
    );
  }
  if (view === 'proof') {
    return wrap(
      <>
        <div className="section-title">Verification</div>
        <div className="hint" style={{ marginBottom: 9, lineHeight: 1.6 }}>
          Re-derive the handoff claim from the bytes on disk, and read the contract↔code trace both directions.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn small" disabled={!activeChatId} onClick={() => onOpenTab({ kind: 'provenance', title: 'Provenance & proof' })}>Provenance</button>
          <button className="btn small" disabled={!activeChatId || !artifacts?.architect} onClick={() => onOpenTab({ kind: 'trace', title: 'Trace matrix' })}>Trace matrix</button>
        </div>
      </>,
      '12px 14px',
    );
  }
  return null;
}

function Welcome({ onStart }) {
  const [text, setText] = useState('');
  const submit = (e) => { e?.preventDefault(); if (text.trim()) onStart(text.trim()); };
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>What are we building?</h1>
        <p className="sub">
          Describe it once. Seven specialist agents are available — Product Manager, Solution Architect, UI/UX,
          Backend, Frontend, QA, Documentation — and you choose which run, in any combination with a valid handoff.
          Every output is a typed artifact you can open, verify and run.
        </p>
        <form className="composer2" onSubmit={submit}>
          <span className="caret">›</span>
          <textarea
            rows={3}
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Build a booking system where customers reserve a slot, pay, and download a report after payment clears."
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
          />
          <button className="btn primary" type="submit" disabled={!text.trim()}>Start</button>
        </form>
        <div className="hint" style={{ marginTop: 9 }}>
          <kbd>Enter</kbd> to start · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </div>
      </div>
    </div>
  );
}
