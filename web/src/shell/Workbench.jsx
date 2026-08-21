import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listChats, listProjects, getChat, createChat, streamChat, getArtifact, getFile,
  generateRoles, getAgentGraph, getAdapters, startPreview,
} from '../api.js';
import { parseWorklog } from '../lib/worklog.js';
import Explorer from './Explorer.jsx';
import AgentPanel from './AgentPanel.jsx';
import AdapterSettings from '../components/AdapterSettings.jsx';
import ClarificationPrompt from '../components/ClarificationPrompt.jsx';
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
import { IconExplorer, IconAgents, IconInbox, IconSettings, ROLE_ICON, IconDiagram, IconServer, IconBrowser, IconTerminal, IconTrace, IconFile } from './icons.jsx';

const TAB_ICON = { diagram: IconDiagram, 'backend-map': IconServer, preview: IconBrowser, api: IconTerminal, trace: IconTrace, code: IconFile, artifact: IconFile };

export default function Workbench() {
  const [view, setView] = useState('explorer'); // explorer | agents | inbox
  const [chats, setChats] = useState([]);
  const [projects, setProjects] = useState([]);
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
  const [adapterCount, setAdapterCount] = useState(0);
  const [jumpFile, setJumpFile] = useState(null);
  const unsubRef = useRef(null);

  const roleLabels = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r.label])), [roles]);

  useEffect(() => {
    getAgentGraph().then((r) => setRoles(r.roles ?? []));
    getAdapters().then((r) => setAdapterCount((r.adapters ?? []).filter((a) => a.available).length));
  }, []);

  const refreshLists = useCallback(async () => {
    const [c, p] = await Promise.all([listChats(), listProjects()]);
    setChats(c.chats ?? []);
    setProjects(p.projects ?? []);
  }, []);

  useEffect(() => {
    refreshLists();
    const id = setInterval(refreshLists, 6000);
    return () => clearInterval(id);
  }, [refreshLists]);

  // Load a chat + its artifacts, and subscribe to its agent stream.
  const loadChat = useCallback(async (chatId) => {
    const c = await getChat(chatId);
    setChat(c);
    const roleIds = Object.keys(c.artifacts ?? {});
    const loaded = {};
    await Promise.all(roleIds.map(async (r) => { loaded[r] = await getArtifact(chatId, r); }));
    setArtifacts(loaded);
    return c;
  }, []);

  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    setSelected(new Set());
    setFailed(new Set());
    setRunning(null);
    setGenError(null);
    loadChat(activeChatId);

    unsubRef.current?.();
    unsubRef.current = streamChat(activeChatId, (evt) => {
      if (cancelled) return;
      if (evt.status === 'running') setRunning(evt.role);
      if (evt.status === 'failed') {
        setFailed((f) => new Set([...f, evt.role]));
        setRunning(null);
      }
      if (evt.status === 'passed') {
        setRunning(null);
        loadChat(activeChatId);
      }
      if (evt.status === 'awaiting_human') {
        setRunning(null);
        loadChat(activeChatId);
      }
    });

    const t = setInterval(async () => {
      const text = await getFile(activeChatId, 'worklog.jsonl');
      if (!cancelled) setWorklog(parseWorklog(text));
    }, 2000);

    return () => {
      cancelled = true;
      unsubRef.current?.();
      clearInterval(t);
    };
  }, [activeChatId, loadChat]);

  // ---- tabs ----
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

  async function selectChat(id) {
    setActiveChatId(id);
    setTabs([]);
    setActiveTabId(null);
  }

  async function startChat(text) {
    const created = await createChat(text);
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
      const details = res.body?.details?.map((d) => d.detail).join(' · ');
      setGenError(details || res.body?.code || 'Could not start that selection.');
      return;
    }
    setRunning(res.body.order[0]);
    setSelected(new Set());
  }

  const existing = useMemo(() => new Set(Object.keys(chat?.artifacts ?? {})), [chat]);
  const backendLive = !!chat?.preview?.live;
  const [startingBackend, setStartingBackend] = useState(false);

  const startBackend = useCallback(async () => {
    setStartingBackend(true);
    await startPreview(activeChatId);
    await loadChat(activeChatId);
    setStartingBackend(false);
  }, [activeChatId, loadChat]);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const pendingClarify = useMemo(
    () => worklog.filter((e) => e.event === 'awaiting_human').slice(-1)[0],
    [worklog],
  );

  function renderTab(tab) {
    const a = artifacts;
    switch (tab.kind) {
      case 'diagram':
        return <ArchitectureDiagram contract={a.architect} />;
      case 'backend-map':
        return (
          <BackendMap
            manifest={a.backend}
            contract={a.architect}
            onOpenFile={(p) => { setJumpFile({ role: 'backend', path: p }); openTab({ kind: 'code', role: 'backend', title: 'Backend · Source' }); }}
          />
        );
      case 'preview':
        return <LivePreview chatId={tab.chatId} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'api':
        return <ApiConsole chatId={tab.chatId} contract={a.architect} backendLive={backendLive} onStartBackend={existing.has('backend') ? startBackend : null} starting={startingBackend} />;
      case 'trace':
        return <div className="editor-pad"><TraceMatrix chatId={tab.chatId} refreshKey={Object.keys(a).join()} onJumpToFile={(role, path) => { setJumpFile({ role, path }); openTab({ kind: 'code', role, title: `${roleLabels[role]} · Source` }); }} /></div>;
      case 'code':
        return (
          <CodeViewer
            chatId={tab.chatId}
            role={tab.role}
            refreshKey={tab.role}
            jumpTo={jumpFile?.role === tab.role ? jumpFile.path : null}
            onJumped={() => setJumpFile(null)}
          />
        );
      case 'artifact':
      default: {
        const art = a[tab.role];
        if (tab.role === 'pm') return <div className="editor-pad"><PMViewer artifact={art} /></div>;
        if (tab.role === 'uiux') return <div className="editor-pad"><UiuxViewer artifact={art} /></div>;
        if (tab.role === 'qa') return <div className="editor-pad"><QAViewer artifact={art} /></div>;
        if (tab.role === 'docs') return <div className="editor-pad"><DocsViewer artifact={art} /></div>;
        return <pre className="code-block" style={{ margin: 18, height: 'calc(100% - 36px)' }}>{JSON.stringify(art, null, 2)}</pre>;
      }
    }
  }

  return (
    <div className={`workbench ${view === null ? 'no-sidebar' : ''}`}>
      <div className="activitybar">
        {[
          { id: 'explorer', Icon: IconExplorer, label: 'Explorer' },
          { id: 'agents', Icon: IconAgents, label: 'Agents' },
          { id: 'inbox', Icon: IconInbox, label: 'Inbox' },
        ].map(({ id, Icon, label }) => (
          <button
            key={id}
            className={`activity-item ${view === id ? 'active' : ''}`}
            title={label}
            onClick={() => setView((v) => (v === id ? null : id))}
          >
            <Icon />
            {id === 'agents' && running && <span className="activity-badge">•</span>}
          </button>
        ))}
        <div className="activity-spacer" />
        <button className="activity-item" title="Adapters" onClick={() => setShowAdapters(true)}>
          <IconSettings />
        </button>
      </div>

      <div className="sidebar">
        {view === 'explorer' && (
          <Explorer
            chats={chats}
            projects={projects}
            activeChatId={activeChatId}
            chat={chat}
            roleLabels={roleLabels}
            onSelectChat={selectChat}
            onNewChat={() => { setActiveChatId(null); setChat(null); setTabs([]); setActiveTabId(null); }}
            onOpenTab={openTab}
            activeTabId={activeTabId}
          />
        )}
        {view === 'agents' && (
          <AgentPanel
            roles={roles}
            existing={existing}
            running={running}
            failed={failed}
            selected={selected}
            roleLabels={roleLabels}
            disabled={!activeChatId}
            busy={busy || !!running}
            error={genError}
            onToggle={(id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
            onGenerate={handleGenerate}
          />
        )}
        {view === 'inbox' && (
          <>
            <div className="sidebar-title"><span>Inbox</span></div>
            <div className="sidebar-scroll" style={{ padding: '0 12px' }}>
              {activeChatId ? <Inbox chatId={activeChatId} onAnswered={() => loadChat(activeChatId)} /> : <div className="tree-empty">No chat selected.</div>}
            </div>
          </>
        )}
      </div>

      <div className="editor-region">
        {tabs.length > 0 && (
          <div className="tabbar">
            {tabs.map((t) => {
              const Icon = TAB_ICON[t.kind] ?? ROLE_ICON[t.role] ?? IconFile;
              return (
                <div key={t.id} className={`tab ${t.id === activeTabId ? 'active' : ''}`} onClick={() => setActiveTabId(t.id)}>
                  <span className="tab-icon"><Icon size={14} /></span>
                  <span className="tab-label">{t.title}</span>
                  <button className="tab-close" onClick={(e) => closeTab(t.id, e)} title="Close">×</button>
                </div>
              );
            })}
          </div>
        )}

        <div className="editor-body">
          {!activeChatId && <Welcome onStart={startChat} />}
          {activeChatId && pendingClarify && (
            <div style={{ padding: '14px 18px 0' }}>
              <ClarificationPrompt
                chatId={activeChatId}
                itemId={pendingClarify.detail?.itemId}
                question={pendingClarify.detail?.question ?? 'The Architect needs one clarification to proceed.'}
                onAnswered={() => loadChat(activeChatId)}
              />
            </div>
          )}
          {activeChatId && !activeTab && <EmptyEditor chat={chat} running={running} roleLabels={roleLabels} />}
          {activeChatId && activeTab && renderTab(activeTab)}
        </div>
      </div>

      <div className={`statusbar ${running ? '' : 'idle'}`}>
        <span className="status-item">{running ? `Running ${roleLabels[running] ?? running}…` : chat ? 'Ready' : 'PACT'}</span>
        {chat && <span className="status-item">{Object.keys(chat.artifacts ?? {}).length}/7 agents</span>}
        {chat && backendLive && <span className="status-item">● backend live</span>}
        {chat && !backendLive && existing.has('backend') && (
          <span className="status-item clickable" onClick={startingBackend ? undefined : startBackend}>
            {startingBackend ? '◐ starting backend…' : '○ backend stopped — click to start'}
          </span>
        )}
        <span className="status-spacer" />
        <span className="status-item clickable" onClick={() => setShowAdapters(true)}>{adapterCount} adapter{adapterCount === 1 ? '' : 's'}</span>
      </div>

      {showAdapters && <AdapterSettings onClose={() => setShowAdapters(false)} />}
    </div>
  );
}

function Welcome({ onStart }) {
  const [text, setText] = useState('');
  function submit(e) {
    e?.preventDefault();
    if (text.trim()) onStart(text.trim());
  }
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>PACT</h1>
        <p className="sub">
          Describe what you want built. Seven specialist agents are available — Product Manager, Solution Architect,
          UI/UX, Backend, Frontend, QA, Documentation — and you choose which ones run, in any combination with a valid
          handoff. Every output is a typed artifact you can open, diff, and run.
        </p>
        <form className="composer" onSubmit={submit}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder="e.g. Build a booking system where customers reserve a slot, pay, and download a report after payment clears."
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }}
          />
          <div className="composer-foot">
            <span className="hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> to start</span>
            <button className="btn primary" type="submit" disabled={!text.trim()}>Create chat</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyEditor({ chat, running, roleLabels }) {
  const produced = Object.keys(chat?.artifacts ?? {}).length;
  return (
    <div className="empty-editor">
      <div>
        <div style={{ fontSize: 15, color: 'var(--text-dim)', marginBottom: 6 }}>
          {chat?.chat?.title ?? 'Chat'}
        </div>
        <div style={{ maxWidth: 460, lineHeight: 1.7 }}>
          {running
            ? `${roleLabels[running] ?? running} is running — its output will appear in the Explorer when it commits.`
            : produced === 0
              ? 'No agents have run yet. Open the Agents panel to choose which ones to run.'
              : 'Select an output from the Explorer to open it in a tab.'}
        </div>
      </div>
    </div>
  );
}
