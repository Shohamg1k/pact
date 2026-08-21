import React, { useEffect, useRef, useState } from 'react';
import { requestPreview, bootChat, getBootStatus } from '../api.js';

// UI-5/VER-3: method + path + body → a REAL response from the generated server. Boots
// on first use (write tree → npm install → in-memory Mongo → spawn — server/runner.js)
// and polls status until it's running or fails; the send button stays disabled until then.
export default function PreviewConsole({ chatId }) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [boot, setBoot] = useState(null); // null | {status, port, error}
  const pollRef = useRef(null);

  useEffect(() => {
    getBootStatus(chatId).then(setBoot);
    return () => clearInterval(pollRef.current);
  }, [chatId]);

  function pollUntilSettled() {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const b = await getBootStatus(chatId);
      setBoot(b);
      if (b.status === 'running' || b.status === 'failed' || b.status === 'not_booted') clearInterval(pollRef.current);
    }, 2000);
  }

  async function boot_() {
    setBoot({ status: 'booting', port: null, error: null });
    await bootChat(chatId);
    pollUntilSettled();
  }

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
    const res = await requestPreview(chatId, { method, path, body: parsedBody });
    setBusy(false);
    setResult(res.body ?? res);
  }

  const canSend = boot?.status === 'running';

  return (
    <div>
      {(!boot || boot.status === 'not_booted') && (
        <div className="hash-row">
          <span className="badge">Not running yet.</span>
          <button className="btn small primary" onClick={boot_}>
            Boot this backend
          </button>
        </div>
      )}
      {boot?.status === 'booting' && (
        <div className="hash-row">
          <span className="badge warn dot">booting… (npm install + Mongo + server start, can take ~30-60s)</span>
        </div>
      )}
      {boot?.status === 'running' && (
        <div className="hash-row">
          <span className="badge ok dot">running on port {boot.port}</span>
        </div>
      )}
      {boot?.status === 'failed' && (
        <div className="gap-notice">
          Boot failed: {boot.error}
          <button className="btn small" style={{ marginLeft: 10 }} onClick={boot_}>
            Retry
          </button>
        </div>
      )}

      <div className="preview-row">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/books" />
        <button className="btn primary" onClick={send} disabled={busy || !canSend}>
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
          {typeof result?.status === 'number' && (
            <div className="hash-row">
              <span className={`badge ${result.status >= 200 && result.status < 300 ? 'ok' : result.status === 403 || result.status === 409 ? 'warn' : 'bad'}`}>
                HTTP {result.status}
              </span>
            </div>
          )}
          <pre className="code-block">{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
