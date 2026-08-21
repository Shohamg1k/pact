import React, { useEffect, useMemo, useRef } from 'react';
import ClarificationPrompt from '../components/ClarificationPrompt.jsx';

// The centre pane: what this chat is, and what the agents have actually been doing.
// PACT isn't a free-form chat agent — the "message" is the brief (CORE-1, stored
// byte-verbatim), and everything after it is a real activity log read from
// worklog.jsonl. Nothing here is narrated by a model; every line is an event the
// deterministic kernel recorded.

const EVENT_STYLE = {
  call: { bullet: '·', label: (e, l) => `${l(e.phase)} called ${e.adapter}` },
  committed: { bullet: '·', cls: 'ok', label: (e, l) => `${l(e.phase)} committed its artifact` },
  repair: { bullet: '·', cls: '', label: (e, l) => `${l(e.phase)} failed a gate — bounded repair attempt ${(e.detail?.attempt ?? 0) + 1}` },
  failover: { bullet: '·', cls: '', label: (e, l) => `${l(e.phase)} failed over to another engine, continuing from partial output` },
  exhausted: { bullet: '·', cls: 'err', label: (e, l) => `${l(e.phase)} exhausted its repair budget` },
  awaiting_human: { bullet: '·', cls: '', label: (e, l) => `${l(e.phase)} raised one clarifying question` },
  clarification_answered: { bullet: '·', cls: 'ok', label: (e) => `You answered: "${(e.detail?.answer ?? '').slice(0, 90)}${(e.detail?.answer ?? '').length > 90 ? '…' : ''}"` },
  contract_tests: { bullet: '·', cls: 'ok', label: (e) => `Contract tests: ${e.detail?.passed ?? 0}/${e.detail?.total ?? 0} passing` },
};

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Conversation({ chat, worklog, roleLabels, running, chatId, onAnswered, adapterName }) {
  const endRef = useRef(null);
  const label = (id) => roleLabels[id] ?? id;

  const lines = useMemo(() => {
    const out = [];
    for (const e of worklog) {
      if (e.event === 'created') continue;
      const style = EVENT_STYLE[e.event];
      if (!style) continue;
      out.push({ ...e, ...style, text: style.label(e, label) });
    }
    return out;
  }, [worklog, roleLabels]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [lines.length]);

  // The question is settled once its answer is on the worklog. (An earlier version
  // looked for a 'running' event, which the orchestrator only ever emits over SSE and
  // never writes to disk — so the prompt could never clear.)
  const pendingClarify = [...worklog].reverse().find((e) => e.event === 'awaiting_human');
  const answered =
    !!pendingClarify &&
    worklog.some((e) => e.event === 'clarification_answered' && e.detail?.itemId === pendingClarify.detail?.itemId);
  const gaps = Object.entries(chat?.artifacts ?? {}).flatMap(([role, a]) => (a.gaps ?? []).map((g) => ({ role, g })));

  return (
    <div className="convo">
      <div className="session-card">
        <div className="session-avatar">◈</div>
        <div className="session-meta">
          <div className="l1">PACT · {Object.keys(chat?.artifacts ?? {}).length} of 7 agents run</div>
          <div className="l2">{adapterName ?? 'no adapter available'} · deterministic kernel</div>
          <div className="l3">chat/{chat?.chat?.id}</div>
        </div>
      </div>

      <div className="msg-user">
        <span className="caret">›</span>
        <span>{chat?.chat?.brief}</span>
      </div>

      {pendingClarify && !answered && (
        <ClarificationPrompt
          chatId={chatId}
          itemId={pendingClarify.detail?.itemId}
          question={pendingClarify.detail?.question ?? 'The agent needs one clarification to proceed.'}
          onAnswered={onAnswered}
        />
      )}

      <div className="feed">
        {lines.length === 0 && (
          <div className="feed-line">
            <span className="bullet">·</span>
            <span>No agents have run yet. Pick agents from the sidebar to start.</span>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`feed-line ${l.cls ?? ''}`}>
            <span className="bullet">{l.bullet}</span>
            <span style={{ flex: 1 }}>{l.text}</span>
            <span className="mono" style={{ color: 'var(--text-faint)' }}>{fmtTime(l.ts)}</span>
          </div>
        ))}
        {running && (
          <div className="feed-line head">
            <span className="bullet">›</span>
            <span>{label(running)} is working…</span>
          </div>
        )}
      </div>

      {gaps.length > 0 && (
        <div className="feed-card" style={{ marginTop: 16 }}>
          <div className="fc-head">Recorded gaps — nothing was silently dropped</div>
          {gaps.slice(0, 8).map((g, i) => (
            <div key={i} className="fc-sub">
              <span className="chip">{label(g.role)}</span> {g.g}
            </div>
          ))}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
