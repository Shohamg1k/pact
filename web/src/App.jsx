import React, { useEffect, useMemo, useRef, useState } from 'react';
import { submitRun, getRun, streamRun, getArtifact, listRuns } from './api.js';
import { parseWorklog, chipsByPhase } from './lib/worklog.js';
import BriefForm from './components/BriefForm.jsx';
import PipelineStrip from './components/PipelineStrip.jsx';
import ClarificationPrompt from './components/ClarificationPrompt.jsx';
import SpecViewer from './components/SpecViewer.jsx';
import CodeViewer from './components/CodeViewer.jsx';
import TraceMatrix from './components/TraceMatrix.jsx';
import PreviewConsole from './components/PreviewConsole.jsx';
import CostStrip from './components/CostStrip.jsx';
import Inbox from './components/Inbox.jsx';
import AdapterSettings from './components/AdapterSettings.jsx';
import Panel from './components/Panel.jsx';

const PHASES = ['agent1', 'gateV1', 'agent2', 'gateV2', 'run', 'connectors'];

function blankPhases() {
  return PHASES.map((name) => ({ name, status: 'pending' }));
}

function applyPhaseEvent(phases, evt) {
  return phases.map((p) => (p.name === evt.phase ? { ...p, status: evt.status, ...evt.detail } : p));
}

// The server's final `status: 'done_stub'` patch (orchestrator.js runPipeline) is written
// directly via patchRun, NOT through setPhase()/emit() — so it never reaches the client over
// SSE. Terminal-ness must be derived from the phases array itself (always accurate, since
// every phase transition IS an SSE event), not trusted from run.status which can go stale.
function deriveStatus(run, phases) {
  const anyFailed = phases.some((p) => p.status === 'failed');
  const last = phases[phases.length - 1];
  const isTerminal = anyFailed || last?.status === 'passed';
  if (anyFailed) return { isTerminal: true, label: 'failed' };
  if (isTerminal) return { isTerminal: true, label: run?.status?.startsWith('done') ? run.status : 'done' };
  const active = phases.find((p) => !['pending', 'passed'].includes(p.status));
  return { isTerminal: false, label: active ? `${active.name} · ${active.status}` : run?.status ?? 'pending' };
}

export default function App() {
  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [worklog, setWorklog] = useState([]);
  const [pastRuns, setPastRuns] = useState([]);
  const [jumpToFile, setJumpToFile] = useState(null);
  const [showAdapters, setShowAdapters] = useState(false);
  const unsubRef = useRef(null);

  useEffect(() => {
    listRuns().then((r) => setPastRuns(r.runs ?? [])).catch(() => {});
  }, [runId]);

  // SSE subscription — the pipeline strip is SSE-driven per UI-1, never polled for phase
  // transitions. worklog.jsonl (repair/failover/drift chips) IS polled — orchestrator.js
  // only emits phase transitions over SSE, not those sub-events (see lib/worklog.js).
  useEffect(() => {
    if (!runId) return;
    unsubRef.current?.();
    getRun(runId).then((r) => setRun(r));

    unsubRef.current = streamRun(runId, (evt) => {
      setRun((prev) => {
        const base = prev ?? { id: runId, phases: blankPhases() };
        return { ...base, phases: applyPhaseEvent(base.phases, evt) };
      });
      // The final phase (connectors) reaching a resting state is the only SSE signal that a
      // run is done — refetch once here to pick up the authoritative status string.
      if (evt.phase === 'connectors' && evt.status !== 'running') {
        getRun(runId).then(setRun);
      }
    });

    const worklogTimer = setInterval(async () => {
      const text = await getArtifact(runId, 'worklog.jsonl');
      setWorklog(parseWorklog(text));
    }, 1500);

    return () => {
      unsubRef.current?.();
      clearInterval(worklogTimer);
    };
  }, [runId]);

  async function handleSubmit(brief, projectName, mode) {
    setWorklog([]);
    const { runId: newId } = await submitRun(brief, projectName, mode);
    setRunId(newId);
  }

  const phases = run?.phases ?? blankPhases();
  const chips = useMemo(() => chipsByPhase(worklog), [worklog]);
  const gateV1 = phases.find((p) => p.name === 'gateV1');
  const agent1 = phases.find((p) => p.name === 'agent1');
  const agent2 = phases.find((p) => p.name === 'agent2');
  const { isTerminal, label: statusLabel } = deriveStatus(run, phases);
  const isBusy = !!runId && !isTerminal;

  const activeAdapterId = useMemo(() => {
    const calls = worklog.filter((e) => e.event === 'call' && e.adapter);
    return calls.length ? calls[calls.length - 1].adapter : null;
  }, [worklog]);

  const savedTokens = useMemo(
    () => worklog.reduce((sum, e) => sum + (typeof e.detail?.savedTokens === 'number' ? e.detail.savedTokens : 0), 0),
    [worklog],
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1>PACT</h1>
          <span className="tagline">brief → validated contract → running backend, two agents, no chat</span>
        </div>
        <div className="header-actions">
          {pastRuns.length > 0 && (
            <div className="run-picker">
              runs
              <select value={runId ?? ''} onChange={(e) => setRunId(e.target.value || null)}>
                <option value="">— select —</option>
                {pastRuns
                  .slice()
                  .reverse()
                  .map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <button className="btn small" onClick={() => setShowAdapters(true)}>
            Adapters
          </button>
        </div>
      </header>

      <BriefForm onSubmit={handleSubmit} busy={isBusy} />

      {runId && (
        <>
          <div style={{ margin: '18px 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="badge mono">run {runId}</span>
            {run?.projectName && <span className="badge">{run.projectName}</span>}
            <span className={`badge ${isTerminal ? 'ok' : ''}`}>{statusLabel}</span>
          </div>

          <CostStrip activeAdapterId={activeAdapterId} savedTokens={savedTokens} />

          <PipelineStrip phases={phases} chips={chips} />

          {agent1?.status === 'awaiting_human' && (
            <ClarificationPrompt
              runId={runId}
              itemId={agent1.itemId}
              question={agent1.question}
              onAnswered={() => getRun(runId).then(setRun)}
            />
          )}

          <Panel title="Spec viewer" defaultOpen={gateV1?.status === 'passed'}>
            <SpecViewer runId={runId} contractHash={gateV1?.contractHash} />
          </Panel>

          <Panel title="Code viewer" defaultOpen={agent2?.status === 'passed'}>
            <CodeViewer runId={runId} jumpTo={jumpToFile} onJumped={() => setJumpToFile(null)} />
          </Panel>

          <Panel title="Trace matrix" defaultOpen={agent2?.status === 'passed'}>
            <TraceMatrix runId={runId} onJumpToFile={setJumpToFile} />
          </Panel>

          <Panel title="Preview console" defaultOpen={isTerminal}>
            <PreviewConsole runId={runId} />
          </Panel>

          <Panel title="Inbox" defaultOpen={agent1?.status === 'awaiting_human'}>
            <Inbox runId={runId} onAnswered={() => getRun(runId).then(setRun)} />
          </Panel>
        </>
      )}

      {!runId && <div className="empty-state">Submit a brief above to start a run.</div>}

      {showAdapters && <AdapterSettings onClose={() => setShowAdapters(false)} />}
    </div>
  );
}
