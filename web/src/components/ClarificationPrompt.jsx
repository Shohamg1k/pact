import React, { useState } from 'react';
import { answerClarification } from '../api.js';

// UI-6: the ONE clarifying question (CORE-6, §8.4). Answering resumes the run via the
// LOCKED POST /api/runs/:id/answer route.
export default function ClarificationPrompt({ runId, itemId, question, onAnswered }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await answerClarification(runId, itemId, answer.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.body?.detail ?? `failed (${res.status})`);
      return;
    }
    onAnswered?.();
  }

  return (
    <div className="clarify-box">
      <div className="q-label">Round cap: max 2 · one question at a time (§8.4)</div>
      <div className="question">{question}</div>
      <form onSubmit={submit}>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer resumes Agent 1, which revises the contract and re-validates…"
          disabled={busy}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn primary" type="submit" disabled={busy || !answer.trim()}>
            {busy ? 'Submitting…' : 'Answer & resume'}
          </button>
          {error && <span className="badge bad">{error}</span>}
        </div>
      </form>
    </div>
  );
}
