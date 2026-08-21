import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getChat,
  streamChat,
  getFile,
  getArtifact,
  generateRoles,
  getAgentGraph,
} from '../api.js';
import { parseWorklog, chipsByPhase } from '../lib/worklog.js';
import { getLinkedHandle, hasPermission, requestPermission, mirrorRole } from '../lib/fsMirror.js';
import AgentSelector from '../components/AgentSelector.jsx';
import PipelineStrip from '../components/PipelineStrip.jsx';
import ClarificationPrompt from '../components/ClarificationPrompt.jsx';
import Panel from '../components/Panel.jsx';
import SpecViewer from '../components/SpecViewer.jsx';
import CodeViewer from '../components/CodeViewer.jsx';
import TraceMatrix from '../components/TraceMatrix.jsx';
import PreviewConsole from '../components/PreviewConsole.jsx';
import CostStrip from '../components/CostStrip.jsx';
import Inbox from '../components/Inbox.jsx';
import PMViewer from '../components/PMViewer.jsx';
import UiuxViewer from '../components/UiuxViewer.jsx';
import QAViewer from '../components/QAViewer.jsx';
import DocsViewer from '../components/DocsViewer.jsx';

const ROLE_ORDER = ['pm', 'architect', 'uiux', 'backend', 'frontend', 'qa', 'docs'];

export default function ChatPage({ chatId }) {
  const [chat, setChat] = useState(null);
  const [roles, setRoles] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [batchNodes, setBatchNodes] = useState([]); // this session's active/last batch
  const [worklog, setWorklog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState(null);
  const [jump, setJump] = useState(null); // {role, path}
  const [folder, setFolder] = useState({ handle: null, granted: false, checked: false });
  const folderRef = useRef(folder); // the SSE handler below is created once per chatId and
  // must never read stale `folder` state from that render — always read the latest via this ref.
  folderRef.current = folder;
  const unsubRef = useRef(null);

  useEffect(() => {
    getAgentGraph().then((r) => setRoles(r.roles ?? []));
  }, []);

  useEffect(() => {
    setSelected(new Set());
    setBatchNodes([]);
    setGenError(null);
    let cancelled = false;

    getChat(chatId).then((c) => !cancelled && setChat(c));

    unsubRef.current?.();
    unsubRef.current = streamChat(chatId, (evt) => {
      setBatchNodes((nodes) => nodes.map((n) => (n.role === evt.role ? { ...n, status: evt.status, ...evt.detail } : n)));
      if (evt.status === 'passed') {
        getChat(chatId).then((c) => !cancelled && setChat(c));
        mirrorIfLinked(evt.role);
      }
      if (evt.status === 'awaiting_human') {
        getChat(chatId).then((c) => !cancelled && setChat(c));
      }
    });

    const worklogTimer = setInterval(async () => {
      const text = await getFile(chatId, 'worklog.jsonl');
      setWorklog(parseWorklog(text));
    }, 1500);

    // Resolve the linked folder (project's, if this chat belongs to one, else the chat's own).
    getChat(chatId).then(async (c) => {
      if (cancelled) return;
      const key = c?.chat?.projectId ?? chatId;
      const handle = await getLinkedHandle(key);
      const granted = handle ? await hasPermission(handle) : false;
      if (!cancelled) setFolder({ handle, granted, checked: true, key });
    });

    return () => {
      unsubRef.current?.();
      clearInterval(worklogTimer);
      cancelled = true;
    };
  }, [chatId]);

  async function mirrorIfLinked(role) {
    const f = folderRef.current;
    if (!f.handle || !f.granted) return;
    const artifact = await getArtifact(chatId, role);
    if (artifact) mirrorRole(f.handle, role, artifact).catch(() => {});
  }

  async function reconnectFolder() {
    if (!folder.handle) return;
    const granted = await requestPermission(folder.handle);
    setFolder((f) => ({ ...f, granted }));
  }

  const existingRoles = useMemo(() => new Set(Object.keys(chat?.artifacts ?? {})), [chat]);
  const chips = useMemo(() => chipsByPhase(worklog), [worklog]);
  const chatBusy = busy || (chat?.jobs ?? []).some((j) => j.status === 'running');

  async function handleGenerate() {
    setBusy(true);
    setGenError(null);
    const res = await generateRoles(chatId, [...selected]);
    setBusy(false);
    if (!res.ok) {
      setGenError({ message: res.body?.code, details: res.body?.details });
      return;
    }
    const roleLabel = Object.fromEntries(roles.map((r) => [r.id, r.label]));
    setBatchNodes(res.body.order.map((role, i) => ({ role, label: roleLabel[role] ?? role, status: i === 0 ? 'running' : 'pending' })));
    setSelected(new Set());
  }

  function jumpToFile(role, path) {
    setJump({ role, path });
  }

  const activeAdapterId = useMemo(() => {
    const calls = worklog.filter((e) => e.event === 'call' && e.adapter);
    return calls.length ? calls[calls.length - 1].adapter : null;
  }, [worklog]);
  const savedTokens = useMemo(
    () => worklog.reduce((sum, e) => sum + (typeof e.detail?.savedTokens === 'number' ? e.detail.savedTokens : 0), 0),
    [worklog],
  );

  const awaitingNode = batchNodes.find((n) => n.status === 'awaiting_human');
  const jobFor = (role) => (chat?.jobs ?? []).slice().reverse().find((j) => j.role === role && j.status === 'passed');

  if (!chat) return <div className="empty-state">loading…</div>;
  if (!chat.chat) return <div className="empty-state">Chat not found — it may belong to a different PACT instance.</div>;

  return (
    <div className="chat-page">
      <div className="chat-bubble brief">
        <div className="chat-bubble-meta">brief</div>
        {chat.chat.brief}
      </div>

      {folder.checked && folder.handle && !folder.granted && (
        <div className="gap-notice">
          A folder was linked to this chat but the browser needs permission re-granted.
          <button className="btn small" style={{ marginLeft: 10 }} onClick={reconnectFolder}>
            Reconnect folder
          </button>
        </div>
      )}
      {folder.checked && folder.handle && folder.granted && (
        <div className="badge ok small" style={{ marginBottom: 10 }}>synced to local folder</div>
      )}

      <CostStrip activeAdapterId={activeAdapterId} savedTokens={savedTokens} />

      {roles.length > 0 && (
        <AgentSelector
          roles={roles}
          existing={existingRoles}
          selected={selected}
          onChange={setSelected}
          onSubmit={handleGenerate}
          busy={chatBusy}
          error={genError}
        />
      )}

      {chatBusy && !busy && batchNodes.length === 0 && (
        <div className="gap-notice">A batch is already running for this chat — wait for it to finish before starting another.</div>
      )}

      <PipelineStrip nodes={batchNodes} chips={chips} />

      {awaitingNode && (
        <ClarificationPrompt
          chatId={chatId}
          itemId={awaitingNode.itemId}
          question={awaitingNode.question}
          onAnswered={() => getChat(chatId).then(setChat)}
        />
      )}

      {ROLE_ORDER.filter((r) => existingRoles.has(r)).map((role) => (
        <Panel key={role} title={roleTitle(role)} defaultOpen={role === 'architect' || role === 'backend'}>
          {renderViewer(role, chatId, jump, setJump, jobFor)}
        </Panel>
      ))}

      {existingRoles.has('architect') && (
        <>
          <Panel title="Trace matrix" defaultOpen={existingRoles.has('backend')}>
            <TraceMatrix chatId={chatId} refreshKey={JSON.stringify(existingRoles)} onJumpToFile={jumpToFile} />
          </Panel>
          <Panel title="Preview console">
            <PreviewConsole chatId={chatId} />
          </Panel>
        </>
      )}

      <Panel title="Inbox" defaultOpen={!!awaitingNode}>
        <Inbox chatId={chatId} onAnswered={() => getChat(chatId).then(setChat)} />
      </Panel>
    </div>
  );
}

function roleTitle(role) {
  return { pm: 'Product Manager', architect: 'Solution Architect', uiux: 'UI/UX', backend: 'Backend', frontend: 'Frontend', qa: 'QA', docs: 'Documentation' }[role];
}

function renderViewer(role, chatId, jump, setJump, jobFor) {
  switch (role) {
    case 'architect':
      return (
        <SpecViewer
          chatId={chatId}
          refreshKey={jobFor('architect')?.id}
          contractHash={jobFor('architect')?.hash}
          backendJobId={jobFor('backend')?.id}
        />
      );
    case 'backend':
    case 'frontend':
      return (
        <CodeViewer
          chatId={chatId}
          role={role}
          refreshKey={jobFor(role)?.id}
          jumpTo={jump?.role === role ? jump.path : null}
          onJumped={() => setJump(null)}
        />
      );
    default:
      return <RoleJsonViewer chatId={chatId} role={role} refreshKey={jobFor(role)?.id} />;
  }
}

function RoleJsonViewer({ chatId, role, refreshKey }) {
  const [artifact, setArtifact] = React.useState(undefined);
  React.useEffect(() => {
    let cancelled = false;
    getArtifact(chatId, role).then((a) => !cancelled && setArtifact(a));
    return () => {
      cancelled = true;
    };
  }, [chatId, role, refreshKey]);
  if (artifact === undefined) return <div className="empty-state">loading…</div>;
  if (role === 'pm') return <PMViewer artifact={artifact} />;
  if (role === 'uiux') return <UiuxViewer artifact={artifact} />;
  if (role === 'qa') return <QAViewer artifact={artifact} />;
  if (role === 'docs') return <DocsViewer artifact={artifact} />;
  return <pre className="code-block">{JSON.stringify(artifact, null, 2)}</pre>;
}
