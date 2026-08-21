import React, { useEffect, useState } from 'react';
import { getFile, approveInboxItem, ackInboxItem, answerClarification } from '../api.js';
import { parseWorklog as parseJsonl } from '../lib/worklog.js';

// UI-8: the single decision queue — clarifications, connector-write approvals, reviews.
// GET /api/inbox?status=pending (global, cross-run) isn't wired server-side yet, so this
// reads the real per-run inbox.jsonl via the existing artifact route and reconstructs
// pending items the same way kernel/interrupts.js does. Approve/ack buttons call the P1/P2
// routes from PRD §11 — built now, will 404 until server/index.js adds them (same honest-gap
// treatment as UI-5).
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
    const res = await approveInboxItem(item.id);
    setBusyId(null);
    setNotice((n) => ({ ...n, [item.id]: res.ok ? 'approved' : `${res.status}: not wired yet (P1 gap)` }));
  }

  async function ack(item) {
    setBusyId(item.id);
    const res = await ackInboxItem(item.id);
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
            <div className="type-tag">{item.type}{item.tainted ? ' · tainted' : ''}</div>
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
            ) : (
              <div>{JSON.stringify(item.payload ?? item)}</div>
            )}
            <div className="meta">
              round {item.round ?? 0} · {item.createdAt ?? ''}
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
