import React, { useEffect, useRef, useState } from 'react';
import { getFrontendPreviewStatus, frontendPreviewUrl } from '../api.js';

// The generated frontend, actually running — server/preview/frontend.js bundles the
// manifest with esbuild and serves it; this frames it with browser chrome so it reads
// as "your app", and offers the usual viewport widths. A bundle failure is surfaced as
// text here rather than as a silently blank frame.
const VIEWPORTS = [
  { id: 'desktop', label: 'Desktop', width: '100%' },
  { id: 'tablet', label: 'Tablet', width: '820px' },
  { id: 'mobile', label: 'Mobile', width: '390px' },
];

export default function LivePreview({ chatId, backendLive, onStartBackend, starting }) {
  const [status, setStatus] = useState(null);
  const [viewport, setViewport] = useState('desktop');
  const [nonce, setNonce] = useState(0);
  const [runtimeError, setRuntimeError] = useState(null);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    getFrontendPreviewStatus(chatId).then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, [chatId, nonce]);

  // The injected shim forwards uncaught errors out of the frame so a crashed render
  // shows a cause instead of a white rectangle.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.data && e.data.__pactPreview === 'error') setRuntimeError(e.data.message);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function reload() {
    setRuntimeError(null);
    setNonce((n) => n + 1);
  }

  const vp = VIEWPORTS.find((v) => v.id === viewport);

  return (
    <div className="preview-shell">
      <div className="browser-chrome">
        <div className="traffic">
          <i style={{ background: '#ff5f57' }} />
          <i style={{ background: '#febc2e' }} />
          <i style={{ background: '#28c840' }} />
        </div>
        <div className="urlbar">http://localhost/ — generated frontend</div>
        <div className="viewport-toggle">
          {VIEWPORTS.map((v) => (
            <button key={v.id} className={viewport === v.id ? 'active' : ''} onClick={() => setViewport(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <button className="btn small ghost" onClick={reload}>Reload</button>
      </div>

      {!backendLive && (
        <div className="notice" style={{ margin: '10px 14px 0' }}>
          No backend is running, so this app's data calls will return 503.{' '}
          {onStartBackend
            ? 'A backend was already generated for this chat — previews only live as long as the daemon, so start it again:'
            : 'Run the Backend agent to give this frontend something to talk to.'}
          {onStartBackend && (
            <button className="btn small" style={{ marginLeft: 8 }} disabled={starting} onClick={onStartBackend}>
              {starting ? 'Starting…' : 'Start backend'}
            </button>
          )}
        </div>
      )}
      {status && status.error && (
        <div className="notice bad" style={{ margin: '10px 14px 0', whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
          {status.error}
        </div>
      )}
      {runtimeError && (
        <div className="notice bad" style={{ margin: '10px 14px 0' }}>
          Runtime error inside the preview: <span style={{ fontFamily: 'var(--mono)' }}>{runtimeError}</span>
        </div>
      )}

      <div className="preview-stage">
        <iframe
          ref={frameRef}
          key={nonce}
          className="preview-frame"
          title="Generated frontend preview"
          src={`${frontendPreviewUrl(chatId)}?v=${nonce}`}
          style={{ width: vp.width, height: '100%', minHeight: 420 }}
        />
      </div>
    </div>
  );
}
