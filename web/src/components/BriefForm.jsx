import React, { useState } from 'react';

// UI-1 entry point: "One textarea (≤4000 chars) + optional project name. No mode picker,
// no agent picker" per CORE-1 — the interactive/batch toggle exists only because CORE-6
// needs a mode, not as a general picker (it never selects WHICH agents run, only whether
// underspecified briefs pause for one question or proceed with flagged assumptions).
export default function BriefForm({ onSubmit, busy }) {
  const [brief, setBrief] = useState('');
  const [projectName, setProjectName] = useState('');
  const [mode, setMode] = useState('batch');

  function submit(e) {
    e.preventDefault();
    if (!brief.trim() || brief.length > 4000 || busy) return;
    onSubmit(brief.trim(), projectName.trim() || undefined, mode);
  }

  return (
    <form className="brief-form" onSubmit={submit}>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        maxLength={4000}
        placeholder="Describe what you want built — one plain-language brief. e.g. “Build a booking system where customers reserve a slot, pay, and download a report after payment clears.”"
        disabled={busy}
      />
      <div className="brief-form-row">
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="project name (optional)"
          disabled={busy}
        />
        <div className="mode-toggle">
          <button type="button" className={mode === 'batch' ? 'active' : ''} onClick={() => setMode('batch')} disabled={busy}>
            batch
          </button>
          <button type="button" className={mode === 'interactive' ? 'active' : ''} onClick={() => setMode('interactive')} disabled={busy}>
            interactive
          </button>
        </div>
        <button className="btn primary" type="submit" disabled={busy || !brief.trim()}>
          {busy ? 'Running…' : 'Run pipeline'}
        </button>
        <span className="char-count">{brief.length}/4000</span>
      </div>
    </form>
  );
}
