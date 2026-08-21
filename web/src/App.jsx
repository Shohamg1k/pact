import React, { useState } from 'react';
import { submitRun, streamRun } from './api.js';

// Placeholder shell — feat/ui-theatre replaces this with the real Run Theatre (PRD §17).
export default function App() {
  const [brief, setBrief] = useState('');
  const [events, setEvents] = useState([]);
  const [runId, setRunId] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    const { runId } = await submitRun(brief);
    setRunId(runId);
    setEvents([]);
    streamRun(runId, (evt) => setEvents((prev) => [...prev, evt]));
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720, margin: '40px auto' }}>
      <h1>PACT</h1>
      <form onSubmit={onSubmit}>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} style={{ width: '100%' }} />
        <button type="submit">Submit brief</button>
      </form>
      {runId && <p>run: {runId}</p>}
      <ul>
        {events.map((e, i) => (
          <li key={i}>{e.phase} — {e.status}</li>
        ))}
      </ul>
    </div>
  );
}
