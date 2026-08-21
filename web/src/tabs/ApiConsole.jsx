import React, { useState } from 'react';
import { requestPreview } from '../api.js';

// Fire a real HTTP request at the running generated backend. The contract's declared
// endpoints are listed as one-click presets, so the business rules worth demonstrating
// (a 409 on a double-booking, a 403 before payment) are reachable without typing.
export default function ApiConsole({ chatId, contract, backendLive, onStartBackend, starting }) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [elapsed, setElapsed] = useState(null);

  const apis = contract?.apis ?? [];

  function pick(api) {
    setMethod(api.method);
    setPath(api.path);
    if (api.request && Object.keys(api.request).length && api.method !== 'GET') {
      // Seed the body with the declared request shape so the field names are right.
      setBody(JSON.stringify(api.request, null, 2));
    } else {
      setBody('');
    }
    setResult(null);
  }

  async function send() {
    setBusy(true);
    setResult(null);
    let parsed;
    try {
      parsed = body.trim() ? JSON.parse(body) : undefined;
    } catch {
      setResult({ error: 'Request body is not valid JSON.' });
      setBusy(false);
      return;
    }
    const t0 = performance.now();
    const res = await requestPreview(chatId, { method, path, body: parsed });
    setElapsed(Math.round(performance.now() - t0));
    setBusy(false);
    setResult(res.body ?? res);
  }

  const status = typeof result?.status === 'number' ? result.status : null;
  const statusClass = status === null ? '' : status < 300 ? 'ok' : status < 500 ? 'warn' : 'bad';

  return (
    <div className="editor-pad">
      {!backendLive && (
        <div className="notice">
          No backend is running, so requests return <span className="mono">NO_PREVIEW</span>.{' '}
          {onStartBackend
            ? 'One was already generated for this chat — previews only live as long as the daemon, so start it again:'
            : 'Run the Backend agent first; it boots automatically once it commits.'}
          {onStartBackend && (
            <button className="btn small" style={{ marginLeft: 8 }} disabled={starting} onClick={onStartBackend}>
              {starting ? 'Starting…' : 'Start backend'}
            </button>
          )}
        </div>
      )}

      {apis.length > 0 && (
        <>
          <div className="section-title">Declared endpoints</div>
          <div className="endpoint-list">
            {apis.map((a) => (
              <button key={a.id} className="endpoint" onClick={() => pick(a)}>
                <span className={`verb ${a.method}`}>{a.method}</span>
                <span style={{ flex: 1 }}>{a.path}</span>
                {(a.errors ?? []).length > 0 && (
                  <span style={{ color: 'var(--text-faint)' }}>{a.errors.join(' · ')}</span>
                )}
                <span className="chip">{a.id}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Request</div>
      <div className="req-row">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/books" />
        <button className="btn primary" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      <textarea
        className="body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder='Request body (JSON) — e.g. {"title": "…"}'
      />

      {result && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>Response</div>
          <div className="hash-row">
            {status !== null && <span className={`badge ${statusClass}`}>HTTP {status}</span>}
            {elapsed !== null && <span className="badge mono">{elapsed} ms</span>}
            {result.error && <span className="badge bad">{result.error}</span>}
          </div>
          <pre className="code-block">{JSON.stringify(result.body ?? result, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
