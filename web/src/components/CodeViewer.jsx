import React, { useEffect, useState } from 'react';
import { getArtifact, getArtifactJSON } from '../api.js';

// UI-3: generated tree; each file shows its implements:[...] stamp (§8.5 provenance).
// backend.json is written by Agent 2 (server/agents/backend.js) — still a timed stub on
// feat/core-pipeline, so this normalizes defensively and says so plainly when absent.
function normalizeManifest(raw) {
  if (!raw) return null;
  const files = raw.files ?? raw.manifest ?? (Array.isArray(raw) ? raw : null);
  if (!Array.isArray(files)) return null;
  return files.map((f) => ({
    path: f.path ?? f.file ?? f.name ?? '(unnamed)',
    implements: f.implements ?? f.implements_ids ?? [],
  }));
}

export default function CodeViewer({ runId, jumpTo, onJumped }) {
  const [manifest, setManifest] = useState(undefined); // undefined = loading, null = absent
  const [active, setActive] = useState(null);
  const [content, setContent] = useState(null);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getArtifactJSON(runId, 'backend.json').then((raw) => {
      if (cancelled) return;
      setManifest(normalizeManifest(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (jumpTo) {
      setActive(jumpTo);
      onJumped?.();
    }
  }, [jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) {
      setContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    getArtifact(runId, `generated/${active}`).then((text) => {
      if (cancelled) return;
      setContent(text);
      setContentLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [runId, active]);

  if (manifest === undefined) return <div className="empty-state">loading…</div>;

  if (manifest === null) {
    return (
      <div className="gap-notice">
        backend.json not written yet — Agent 2 is currently a timed stub (feat/core-pipeline
        lands the real file manifest + implements[] stamps). This viewer will populate
        automatically once that lands; no UI change needed.
      </div>
    );
  }

  if (manifest.length === 0) {
    return <div className="empty-state">Agent 2 produced an empty manifest.</div>;
  }

  return (
    <div className="code-layout">
      <div className="file-tree">
        {manifest.map((f) => (
          <div
            key={f.path}
            className={`file-row ${active === f.path ? 'selected' : ''}`}
            onClick={() => setActive(f.path)}
          >
            <div>{f.path}</div>
            <div className="implements">
              {f.implements.length === 0 && <span className="chip orphan">implements: [] (orphan)</span>}
              {f.implements.map((id) => (
                <span key={id} className="chip">
                  {id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        {!active && <div className="empty-state">Select a file to view its contents.</div>}
        {active && contentLoading && <div className="empty-state">loading…</div>}
        {active && !contentLoading && content === null && (
          <div className="empty-state">generated/{active} not readable (not written to disk yet).</div>
        )}
        {active && !contentLoading && content !== null && <pre className="code-block">{content}</pre>}
      </div>
    </div>
  );
}
