import React, { useState } from 'react';

// "Test with frontend" — an iframe onto the deterministic, contract-derived tester page
// (server/preview/tester.js). No bundler, no agent call: it's ready the instant Backend
// commits, which is the whole point — proving every feature works shouldn't wait on two
// more agent runs (UI/UX + the real Frontend agent, each several minutes) just to click
// a button once.
export default function ApiTesterFrame({ chatId, backendLive, onStartBackend, starting }) {
  const [reloadKey, setReloadKey] = useState(0);

  if (!backendLive) {
    return (
      <div className="notice" style={{ margin: 14 }}>
        No backend is running, so there's nothing to test yet.{' '}
        {onStartBackend && (
          <button className="btn small" style={{ marginLeft: 8 }} disabled={starting} onClick={onStartBackend}>
            {starting ? 'Starting…' : 'Start backend'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="toolbar" style={{ padding: '6px 10px', margin: 0, borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <span className="hint">Every declared endpoint, generated from the contract — no extra agent run.</span>
        <span style={{ flex: 1 }} />
        <button className="btn small ghost" onClick={() => setReloadKey((k) => k + 1)}>Reload</button>
      </div>
      <iframe
        key={reloadKey}
        title="API tester"
        src={`/api/chats/${chatId}/api-tester`}
        style={{ flex: 1, border: 'none', background: '#171514' }}
      />
    </div>
  );
}
