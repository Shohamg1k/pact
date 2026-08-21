import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listChats, listProjects, getChat, createChat, streamChat, getArtifact, getFile,
  generateRoles, getAgentGraph, getAdapters, startPreview, createProject, listInbox,
  deleteChat as apiDeleteChat, deleteProject as apiDeleteProject,
} from '../api.js';
import { parseWorklog } from '../lib/worklog.js';
import { getLinkedHandle, linkFolder, hasPermission, mirrorRole } from '../lib/fsMirror.js';
import NavTree from './NavTree.jsx';
import Conversation from './Conversation.jsx';
import AgentPanel from './AgentPanel.jsx';
import SettingsView from './SettingsView.jsx';
import SaveTargetModal from './SaveTargetModal.jsx';
import FileRail from './FileRail.jsx';
import Splitter from './Splitter.jsx';
import { ROLE_VIEWS } from './roleViews.js';
import { PromptDialog, ConfirmDialog } from './Dialog.jsx';
import AdapterSettings from '../components/AdapterSettings.jsx';
import Inbox from '../components/Inbox.jsx';
import CodeViewer from '../components/CodeViewer.jsx';
import TraceMatrix from '../components/TraceMatrix.jsx';
import ContractTestsViewer from '../components/ContractTestsViewer.jsx';
import PMViewer from '../components/PMViewer.jsx';
import UiuxViewer from '../components/UiuxViewer.jsx';
import QAViewer from '../components/QAViewer.jsx';
import DocsViewer from '../components/DocsViewer.jsx';
import ArchitectureDiagram from '../tabs/ArchitectureDiagram.jsx';
import SchemaDiagram from '../tabs/SchemaDiagram.jsx';
import BackendMap from '../tabs/BackendMap.jsx';
import LivePreview from '../tabs/LivePreview.jsx';
import ApiConsole from '../tabs/ApiConsole.jsx';
import ApiTesterFrame from '../tabs/ApiTesterFrame.jsx';
import ProvenanceTab from '../tabs/ProvenanceTab.jsx';
import PackViewer from '../tabs/PackViewer.jsx';
import FileTab from '../tabs/FileTab.jsx';
import { ROLE_ICON, IconDiagram, IconServer, IconBrowser, IconTerminal, IconTrace, IconFile, IconCheck, IconPanelLeft, IconPanelRight } from './icons.jsx';

const TAB_ICON = {
  diagram: IconDiagram, schema: IconDiagram, 'backend-map': IconServer, preview: IconBrowser, api: IconTerminal,
  tester: IconBrowser, contracttests: IconCheck,
  trace: IconTrace, code: IconFile, artifact: IconFile, provenance: IconCheck, pack: IconFile, file: IconFile,
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
  const [showRail, setShowRail] = useState(() => localStorage.getItem('pact.rail') !== '0');
  const [showNav, setShowNav] = useState(() => localStorage.getItem('pact.nav') !== '0');
  // Collapsing the conversation pane hands its width to the output pane (the diagram/
  // code/etc. you're actually looking at) instead of leaving it as dead space.
  const [showCentre, setShowCentre] = useState(() => localStorage.getItem('pact.centre') !== '0');
  // Pane widths are user-owned and persisted; the centre column is the flexible one.
  const [navW, setNavW] = useState(() => Number(localStorage.getItem('pact.navW')) || 280);
  const [railW, setRailW] = useState(() => Number(localStorage.getItem('pact.railW')) || 232);
  // The output pane's default is a FRACTION of the viewport, not a fixed 560px: on a
  // 1280px screen a fixed width left the conversation with ~180px, which is exactly the
  // "important thing doesn't get the space" problem. Centre always keeps >= MIN_CENTRE.
  const [outW, setOutW] = useState(() => {
    const saved = Number(localStorage.getItem('pact.outW'));
    const max = Math.max(320, window.innerWidth - 280 - 232 - 360);
    return Math.min(saved || Math.round(window.innerWidth * 0.34), max);
  });
  const [interactive, setInteractive] = useState(false);
  const [dialog, setDialog] = useState(null); // {kind:'new-project'|'del-chat'|'del-project', target}
  const folderRef = useRef(null);
  const unsubRef = useRef(null);

  useEffect(() => { localStorage.setItem('pact.navW', String(navW)); }, [navW]);
  useEffect(() => { localStorage.setItem('pact.outW', String(outW)); }, [outW]);
  useEffect(() => { localStorage.setItem('pact.railW', String(railW)); }, [railW]);
  useEffect(() => { localStorage.setItem('pact.rail', showRail ? '1' : '0'); }, [showRail]);
  useEffect(() => { localStorage.setItem('pact.nav', showNav ? '1' : '0'); }, [showNav]);
  useEffect(() => { localStorage.setItem('pact.centre', showCentre ? '1' : '0'); }, [showCentre]);

  // Clamp so no drag — and no window resize — can starve the centre pane.
  const MIN_CENTRE = 300;
  // NOTE: when the ceiling falls below the floor (a viewport too small for every
  // minimum at once) the CEILING wins, because overflowing the window is worse than
  // being under a preferred minimum.
  const clamp = (v, lo, hi) => (hi < lo ? hi : Math.max(lo, Math.min(hi, v)));
  const maxOut = useCallback(
    () => Math.max(320, window.innerWidth - (showNav ? navW : 0) - (showRail ? railW : 0) - MIN_CENTRE),
    [navW, railW, showNav, showRail],
  );
  const resizeNav = (dx) => setNavW((w) => clamp(w + dx, 200, 460));
  const resizeOut = (dx) => setOutW((w) => clamp(w - dx, 300, maxOut()));
  const resizeRail = (dx) => setRailW((w) => clamp(w - dx, 170, 400));

  // Track the viewport so the output pane can hold its PROPORTION across a resize:
  // shrinking must give space back to the centre, and growing must give space back to
  // the output pane rather than stranding it at a width computed for a smaller window.
  const lastW = useRef(window.innerWidth);
  useEffect(() => {
    const onResize = () => {
      const prev = lastW.current || window.innerWidth;
      const ratio = window.innerWidth / prev;
      lastW.current = window.innerWidth;
      // Hold the pane's proportion across a resize, then let the render-time clamp above
      // have the final word on what actually fits.
      setOutW((w) => clamp(Math.round(w * ratio), 300, maxOut()));
    };
    window.addEventListener('resize', onResize);
    setOutW((w) => Math.min(w, maxOut()));
    return () => window.removeEventListener('resize', onResize);
  }, [maxOut]);

  const roleLabels = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r.label])), [roles]);
  const activeAdapter = adapters.find((a) => a.available);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'b') { e.preventDefault(); setShowNav((v) => !v); }
      if (e.key === 'j') { e.preventDefault(); setShowRail((v) => !v); }
      if (e.key === 'w') { e.preventDefault(); setActiveTabId((cur) => { if (cur) closeTabById(cur); return cur; }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  const closeTabById = useCallback((id) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur !== id ? cur : next[Math.max(0, idx - 1)]?.id ?? null));
      return next;
    });
  }, []);

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

  /** Clicking an agent run in the tree opens that role's most useful (first) view. */
  const openRole = useCallback((role) => {
    const v = (ROLE_VIEWS[role] ?? [{ kind: 'artifact', label: 'Output' }])[0];
    openTab({ kind: v.kind, role, title: `${roleLabels[role] ?? role} · ${v.label}` });
  }, [openTab, roleLabels]);

  /** Opens a SPECIFIC view for a role — how Backend's Source/API console and Frontend's
   * Source are reached now that a single click only opens the default view. */
  const openView = useCallback((role, v) => {
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
    const res = await generateRoles(activeChatId, [...selected], { mode: interactive ? 'interactive' : 'batch' });
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

  async function confirmDelete() {
    const d = dialog;
    setDialog(null);
    if (d.kind === 'del-chat') {
      await apiDeleteChat(d.target.id);
      // Deleting the chat you're looking at must clear the whole view, not leave tabs
      // and a file tree pointing at something that no longer exists.
      if (d.target.id === activeChatId) {
        setActiveChatId(null);
        setChat(null);
        setArtifacts({});
        setTabs([]);
        setActiveTabId(null);
      }
    } else if (d.kind === 'del-project') {
      await apiDeleteProject(d.target.id);
    }
    await refreshLists();
  }

  const tabstripRef = useRef(null);
  useEffect(() => {
    // The tab strip scrolls once a few tabs are open; without this the tab you just
    // opened can be off-screen, which reads as "the click did nothing".
    tabstripRef.current?.querySelector('.tabx.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  function renderTab(tab) {
    const a = artifacts;
    switch (tab.kind) {
      case 'diagram': return <ArchitectureDiagram contract={a.architect} />;
      case 'schema': return <SchemaDiagram contract={a.architect} />;
      case 'backend-map':
        return <BackendMap manifest={a.backend} contract={a.architect}
          onOpenFile={(p) => { setJumpFile({ role: 'backend', path: p }); openTab({ kind: 'code', role: 'backend', title: 'Backend · Source' }); }} />;
      case 'preview':
        return <LivePreview chatId={tab.chatId} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'api':
        return <ApiConsole chatId={tab.chatId} contract={a.architect} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'tester':
        return <ApiTesterFrame chatId={tab.chatId} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'contracttests':
        return <div className="pad"><ContractTestsViewer chatId={tab.chatId} refreshKey={a.backend ? Object.keys(a).join() : null} /></div>;
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
        if (tab.role === 'pm') return <PMViewer artifact={art} />;
        if (tab.role === 'uiux') return <UiuxViewer artifact={art} contract={a.architect} />;
        if (tab.role === 'qa') return <QAViewer artifact={art} contract={a.architect} />;
        if (tab.role === 'docs') return <DocsViewer artifact={art} />;
        return <div className="pad"><pre className="code-block">{JSON.stringify(art, null, 2)}</pre></div>;
      }
    }
  }

  const activeFilePath = activeTab?.kind === 'file' ? activeTab.entry.path : null;

  // Nothing is open yet -> the output pane and file rail have nothing to say, so the
  // centre takes the whole width instead of framing the composer with empty panes.
  const focus = !activeChatId;
  // The user can also collapse the conversation deliberately (there IS a chat, they
  // just want the output — a diagram, code, the tester — to have the space instead).
  // Meaningless in focus mode (nothing else to give the space to), so it's a no-op then.
  const centreCollapsed = showCentre === false && !focus;
  // Widths are clamped at RENDER, not only on the resize event: a missed or coalesced
  // resize previously left nav+out+rail wider than the window and squeezed the centre
  // pane to 1px. Deriving them here makes the invariant hold unconditionally.
  const navPx = showNav ? Math.min(navW, Math.max(160, window.innerWidth - 360)) : 0;
  const railPx = showRail && !focus ? railW : 0;
  const splitters = (showNav ? 5 : 0) + (focus || centreCollapsed ? 0 : 5) + (railPx ? 5 : 0);
  const outPx = focus
    ? 0
    : Math.max(240, Math.min(outW, window.innerWidth - navPx - railPx - splitters - MIN_CENTRE));

  const cols = [
    `${navPx}px`,
    showNav ? '5px' : '0px',
    centreCollapsed ? '0px' : 'minmax(0, 1fr)',
    focus || centreCollapsed ? '0px' : '5px',
    centreCollapsed ? 'minmax(0, 1fr)' : `${outPx}px`,
    railPx ? '5px' : '0px',
    `${railPx}px`,
  ].join(' ');

  return (
    <div className="shell" style={{ gridTemplateColumns: cols }}>
      {/* display:none is deliberately never used to hide a pane here: it removes the
          element from CSS Grid participation entirely, which shifts every later column's
          auto-placement by one and silently breaks a DIFFERENT pane's width (confirmed
          live — this exact bug made the output pane render 0-wide). A 0px grid-column
          track already renders nothing (overflow:hidden on .pane), so collapse is
          expressed ONLY through the column width in `cols`, never through display. */}
      <div className="pane nav" style={{ visibility: showNav ? 'visible' : 'hidden' }}>
        <NavTree
          chats={chats} projects={projects} jobsByChat={jobsByChat}
          activeChatId={activeChatId} running={running} roleLabels={roleLabels}
          view={view} onView={setView} inboxCount={inboxCount}
          onSelectChat={selectChat}
          onNewChat={() => { setActiveChatId(null); setChat(null); setTabs([]); setActiveTabId(null); }}
          onNewProject={() => setDialog({ kind: 'new-project' })}
          onDeleteChat={(c) => setDialog({ kind: 'del-chat', target: c })}
          onDeleteProject={(p) => setDialog({ kind: 'del-project', target: p })}
          onOpenRole={openRole}
          onOpenView={openView}
          panel={
            <SidePanel
              view={view} roles={roles} existing={existing} running={running} failed={failed}
              selected={selected} roleLabels={roleLabels} busy={busy || !!running} error={genError}
              activeChatId={activeChatId} chat={chat} artifacts={artifacts}
              interactive={interactive} onInteractive={setInteractive}
              onToggle={(id) => setSelected((s2) => { const n = new Set(s2); n.has(id) ? n.delete(id) : n.add(id); return n; })}
              onGenerate={handleGenerate} onOpenAdapters={() => setShowAdapters(true)}
              onAnswered={() => loadChat(activeChatId)} onOpenTab={openTab}
            />
          }
        />
        <div className="nav-foot">
          <span className="hint" style={{ flex: 1 }}>{activeAdapter ? activeAdapter.name : 'no adapter'}</span>
          <button className="icon-btn" title="Adapter details" onClick={() => setShowAdapters(true)}>⚙</button>
        </div>
      </div>

      {/* Always rendered — a hidden splitter still needs to occupy a grid column, or
          CSS Grid auto-placement shifts every column after it by one and every pane
          after it renders at width 0 in the WRONG track (confirmed live: this exact
          bug made the output pane render 0-wide when the conversation pane collapsed).
          A collapsed splitter's own grid track is 0px, so it's naturally invisible. */}
      <Splitter ariaLabel="Resize sidebar" onDrag={resizeNav} onDoubleClick={() => setNavW(288)} />

      <div className="pane centre" style={{ visibility: centreCollapsed ? 'hidden' : 'visible' }}>
        <div className="pane-toggles">
          <button className={`toggle-btn ${showNav ? 'on' : ''}`} title="Sidebar (Ctrl+B)" onClick={() => setShowNav((v) => !v)}>
            <IconPanelLeft size={15} />
          </button>
          {!focus && (
            <button className="toggle-btn" title="Collapse conversation — give this space to the output pane" onClick={() => setShowCentre(false)}>
              <IconPanelRight size={15} />
            </button>
          )}
          {!focus && (
            <button className={`toggle-btn ${showRail ? 'on' : ''}`} title="File tree (Ctrl+J)" onClick={() => setShowRail((v) => !v)}>
              <IconPanelRight size={15} />
            </button>
          )}
          <span style={{ flex: 1 }} />
          {activeChatId && existing.has('backend') && (
            <button
              className="btn small"
              title="Every declared endpoint, tried live — generated from the contract, no extra agent run"
              onClick={() => openTab({ kind: 'tester', title: 'Test with frontend' })}
            >
              Test with frontend
            </button>
          )}
          {chat && <span className="hint">{chat.chat?.title?.slice(0, 46)}</span>}
        </div>
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

      <Splitter ariaLabel="Resize outputs" onDrag={resizeOut} onDoubleClick={() => setOutW(Math.round(window.innerWidth * 0.34))} />

      <div className="pane out" style={{ visibility: focus ? 'hidden' : 'visible' }}>
        {tabs.length > 0 && (
          <div className="tabstrip" ref={tabstripRef}>
            {centreCollapsed && (
              <button className="toggle-btn" title="Show conversation" onClick={() => setShowCentre(true)} style={{ flexShrink: 0 }}>
                <IconPanelLeft size={14} />
              </button>
            )}
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

      <Splitter ariaLabel="Resize file rail" onDrag={resizeRail} onDoubleClick={() => setRailW(232)} />

      <div className="pane rail" style={{ visibility: showRail && !focus ? 'visible' : 'hidden' }}>
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
        <span className="status-item clickable" title="Toggle the sidebar (Ctrl+B)" onClick={() => setShowNav((v) => !v)}>
          {showNav ? '◧ sidebar' : '▫ sidebar'}
        </span>
        <span className="status-item clickable" title="Toggle the file rail (Ctrl+J)" onClick={() => setShowRail((v) => !v)}>
          {showRail ? '◨ files' : '▫ files'}
        </span>
        {!focus && (
          <span className="status-item clickable" title="Toggle the conversation pane" onClick={() => setShowCentre((v) => !v)}>
            {centreCollapsed ? '▫ chat' : '◨ chat'}
          </span>
        )}
      </div>

      {showAdapters && <AdapterSettings onClose={() => setShowAdapters(false)} />}
      {pendingBrief && <SaveTargetModal projects={projects} onCancel={() => setPendingBrief(null)} onConfirm={confirmSaveTarget} />}

      {dialog?.kind === 'new-project' && (
        <PromptDialog
          title="New project"
          sub="A project groups related chats together. You can move a chat into it when you create the chat."
          placeholder="e.g. Internal Tools"
          onCancel={() => setDialog(null)}
          onConfirm={async (name) => { setDialog(null); await createProject(name); await refreshLists(); }}
        />
      )}
      {dialog?.kind === 'del-chat' && (
        <ConfirmDialog
          title="Delete this chat?"
          body={`"${dialog.target.title || 'Untitled'}" and everything it generated — artifacts, packs, generated code — will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete chat"
          onCancel={() => setDialog(null)}
          onConfirm={confirmDelete}
        />
      )}
      {dialog?.kind === 'del-project' && (
        <ConfirmDialog
          title="Delete this project?"
          body={`"${dialog.target.name}" will be removed. Its chats are KEPT and simply become unfiled — nothing you generated is lost.`}
          confirmLabel="Delete project"
          onCancel={() => setDialog(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/** The active nav view's panel. It lives in the LEFT pane, not the output pane: putting
 * it on the right meant Settings or the agent picker permanently occupied ~half the
 * space the actual outputs needed. */
function SidePanel(props) {
  const { view, activeChatId, chat, artifacts, onOpenTab } = props;
  if (view === 'agents') return <AgentPanel {...props} disabled={!activeChatId} />;
  if (view === 'settings') return <SettingsView chatId={activeChatId} artifacts={chat?.artifacts} onOpenAdapters={props.onOpenAdapters} />;
  if (view === 'inbox') {
    return (
      <div style={{ padding: '4px 12px 12px' }}>
        {activeChatId ? <Inbox chatId={activeChatId} onAnswered={props.onAnswered} /> : <div className="hint">No chat selected.</div>}
      </div>
    );
  }
  if (view === 'proof') {
    return (
      <div style={{ padding: '4px 12px 12px' }}>
        <div className="hint" style={{ marginBottom: 9, lineHeight: 1.6 }}>
          Re-derive the handoff claim from the bytes on disk, and read the contract&#8596;code trace both directions.
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn small" disabled={!activeChatId} onClick={() => onOpenTab({ kind: 'provenance', title: 'Provenance & proof' })}>Provenance</button>
          <button className="btn small" disabled={!activeChatId || !artifacts?.architect} onClick={() => onOpenTab({ kind: 'trace', title: 'Trace matrix' })}>Trace matrix</button>
        </div>
      </div>
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
