import React, { useEffect, useState } from 'react';
import { getJobFile } from '../api.js';

// The exact bytes sent to a model (CTX-3), openable so the provenance claim can be
// checked by reading rather than trusted. Includes an in-page search, because the
// on-stage move is "grep this pack for a word from the brief" — that should be doable
// here, not only in a terminal.
export default function PackViewer({ chatId, jobId, roleLabel }) {
  const [text, setText] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [attempts, setAttempts] = useState([0]);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Probe forward for repair attempts; each gate repair writes another pack.
      const found = [];
      for (let i = 0; i < 6; i++) {
        const t = await getJobFile(chatId, jobId, `pack-attempt-${i}.txt`);
        if (!t) break;
        found.push(i);
      }
      if (!cancelled) setAttempts(found.length ? found : [0]);
    })();
    return () => { cancelled = true; };
  }, [chatId, jobId]);

  useEffect(() => {
    let cancelled = false;
    getJobFile(chatId, jobId, `pack-attempt-${attempt}.txt`).then((t) => !cancelled && setText(t));
    return () => { cancelled = true; };
  }, [chatId, jobId, attempt]);

  if (text === null) return <div className="editor-pad"><div className="empty-state">Loading pack…</div></div>;

  const needle = q.trim().toLowerCase();
  const hits = needle ? text.toLowerCase().split(needle).length - 1 : null;

  return (
    <div className="editor-pad">
      <div className="toolbar">
        <span className="badge mono">{text.length.toLocaleString()} bytes</span>
        <span className="badge">{roleLabel}</span>
        {attempts.length > 1 && (
          <select value={attempt} onChange={(e) => setAttempt(Number(e.target.value))}>
            {attempts.map((i) => (
              <option key={i} value={i}>{i === 0 ? 'original pack' : `repair attempt ${i}`}</option>
            ))}
          </select>
        )}
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these bytes…" style={{ minWidth: 220 }} />
        {needle && (
          <span className={`badge ${hits ? 'warn' : 'ok'}`}>
            {hits} hit{hits === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
    </div>
  );
}
