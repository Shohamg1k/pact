import React, { useState } from 'react';
import { requestPreview } from '../api.js';

// UI-5: method + path + body → real response from the generated server. KNOWN GAP —
// POST /api/preview/:id/request belongs to feat/runner-connectors and doesn't exist yet.
// This is the shell (method/path/body in, response out); it will 404 until that lands.
// Say so plainly rather than hiding the failure.
export default function PreviewConsole({ runId }) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function send() {
    setBusy(true);
    setResult(null);
    let parsedBody;
    try {
      parsedBody = body.trim() ? JSON.parse(body) : undefined;
    } catch {
      setResult({ error: 'body is not valid JSON' });
      setBusy(false);
      return;
    }
    const res = await requestPreview(runId, { method, path, body: parsedBody });
    setBusy(false);
    setResult(res);
  }

  return (
    <div>
      <div className="gap-notice">
        KNOWN GAP: <code>POST /api/preview/:id/request</code> belongs to
        feat/runner-connectors and isn't wired yet — a request below will return 404 until
        it lands. This console is fully built and will work unmodified once it does.
      </div>
      <div className="preview-row">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/reports/1" />
        <button className="btn primary" onClick={send} disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      <textarea
        className="preview-body-input"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder='request body (JSON), e.g. {"name": "..."}'
      />
      {result && (
        <div>
          {result.status && (
            <div className="hash-row">
              <span className={`badge ${result.status >= 200 && result.status < 300 ? 'ok' : result.status === 403 ? 'warn' : 'bad'}`}>
                HTTP {result.status}
              </span>
              {result.error && <span className="badge bad">{result.error}</span>}
            </div>
          )}
          <pre className="code-block">{JSON.stringify(result.body ?? result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
