import React, { useEffect, useState } from 'react';
import { getFile, approveInbox, ackInbox, answerClarification } from '../api.js';
import { parseWorklog as parseJsonl } from '../lib/worklog.js';

// UI-8: the single decision queue — clarifications, connector-write approvals, reviews.
// GET /api/inbox?status=pending (global, cross-run) isn't wired server-side yet, so this
// reads the real per-run inbox.jsonl via the existing artifact route and reconstructs
// pending items the same way kernel/interrupts.js does. Approve/ack buttons call the P1/P2
// routes from PRD §11 — built now, will 404 until server/index.js adds them (same honest-gap
// treatment as UI-5).
const TYPE_LABEL = {
  clarification: 'Question for you',
  connector_write: 'Export approval',
  review: 'Review',
};
const CONNECTOR_LABEL = { postman: 'Postman / OpenAPI', github: 'a GitHub pull request', miro: 'a Miro board', slack: 'Slack' };

/** An ISO timestamp is not information a human wants to parse. */
function relTime(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export default function Inbox({ chatId, onAnswered }) {
  const [items, setItems] = useState(null);
  const [answerDraft, setAnswerDraft] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState({});

  async function load() {
    const text = await getFile(chatId, 'inbox.jsonl');
    const entries = parseJsonl(text);
    const answeredIds = new Set(entries.filter((e) => e.type === 'clarification_answer').map((e) => e.id));
    const pending = entries.filter((e) => e.type === 'clarification' && !answeredIds.has(e.id) && e.status !== 'rejected');
    // Future item types (connector_write, review) will already carry status:'pending' —
    // include anything not explicitly resolved so no rewrite is needed when they land.
    const others = entries.filter(
      (e) => e.type && e.type !== 'clarification' && e.type !== 'clarification_answer' && e.status === 'pending',
    );
    setItems([...pending, ...others]);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitClarification(item) {
    const answer = (answerDraft[item.id] ?? '').trim();
    if (!answer) return;
    setBusyId(item.id);
    const res = await answerClarification(chatId, item.id, answer);
    setBusyId(null);
    if (res.ok) {
      onAnswered?.();
      load();
    } else {
      setNotice((n) => ({ ...n, [item.id]: res.body?.detail ?? `failed (${res.status})` }));
    }
  }

  async function approve(item) {
    setBusyId(item.id);
    const res = await approveInbox(item.id);
    setBusyId(null);
    setNotice((n) => ({ ...n, [item.id]: res.ok ? 'approved' : `${res.status}: not wired yet (P1 gap)` }));
  }

  async function ack(item) {
    setBusyId(item.id);
    const res = await ackInbox(item.id);
    setBusyId(null);
    setNotice((n) => ({ ...n, [item.id]: res.ok ? 'acknowledged' : `${res.status}: not wired yet (P2 gap)` }));
  }

  if (items === null) return <div className="empty-state">loading…</div>;
  if (items.length === 0) return <div className="empty-state">Inbox empty — nothing owed by a human right now.</div>;

  return (
    <div>
      {items.map((item) => (
        <div key={item.id} className="inbox-item">
          <div style={{ flex: 1 }}>
            <div className="type-tag">{TYPE_LABEL[item.type] ?? item.type}{item.tainted ? ' · tainted' : ''}</div>
            {item.type === 'clarification' ? (
              <>
                <div>{item.payload?.question}</div>
                <textarea
                  className="preview-body-input"
                  style={{ minHeight: 44, marginTop: 6 }}
                  value={answerDraft[item.id] ?? ''}
                  onChange={(e) => setAnswerDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                  placeholder="answer…"
                />
              </>
            ) : item.type === 'connector_write' ? (
              <div>
                Export to <strong>{CONNECTOR_LABEL[item.payload?.connector] ?? item.payload?.connector}</strong> is waiting
                for approval. Nothing is sent anywhere until you approve it (SEC-1).
              </div>
            ) : (
              // Unknown future item types still have to render as something a human can
              // read, so fall back to labelled fields rather than a JSON blob.
              <div>
                {Object.entries(item.payload ?? {}).map(([k, v]) => (
                  <div key={k} className="kv">
                    <span className="kv-k">{k}</span>
                    <span className="kv-v">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="meta">
              {item.type === 'clarification' && `round ${(item.round ?? 0) + 1} of 2 · `}
              {relTime(item.createdAt)}
            </div>
            {notice[item.id] && <div className="meta">{notice[item.id]}</div>}
          </div>
          <div className="actions">
            {item.type === 'clarification' ? (
              <button className="btn small primary" disabled={busyId === item.id} onClick={() => submitClarification(item)}>
                Answer
              </button>
            ) : (
              <>
                <button className="btn small primary" disabled={busyId === item.id} onClick={() => approve(item)}>
                  Approve
                </button>
                {item.tainted ? (
                  <button className="btn small" disabled={busyId === item.id} onClick={() => ack(item)}>
                    Ack
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
