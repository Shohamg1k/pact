import React, { useEffect, useState } from 'react';
import { getArtifact, getFile, getJobFile } from '../api.js';
import { sha256Hex } from '../lib/hash.js';

// The architect's contract + its derived files, with a sha256 badge and a "diff against
// Backend's pack" button that proves byte-identity on stage (CORE-4).
const FILES = [
  { key: 'architecture.json', label: 'architecture.json' },
  { key: 'openapi.yaml', label: 'openapi.yaml' },
  { key: 'schema.mongo.json', label: 'schema.mongo.json' },
  { key: 'decisions.md', label: 'decisions.md' },
];

export default function SpecViewer({ chatId, refreshKey, contractHash, backendJobId }) {
  const [active, setActive] = useState('architecture.json');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [localHash, setLocalHash] = useState(null);
  const [diff, setDiff] = useState(null); // null | 'checking' | {status, detail, briefLeak}

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    const load = active === 'architecture.json' ? getArtifact(chatId, 'architect').then((o) => (o ? JSON.stringify(o, null, 2) : null)) : getFile(chatId, active);
    load.then(async (text) => {
      if (cancelled) return;
      setContent(text);
      setLoading(false);
      if (active === 'architecture.json' && text) setLocalHash(await sha256Hex(text));
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, active, refreshKey]);

  async function runDiff() {
    setDiff('checking');
    const archObj = await getArtifact(chatId, 'architect');
    const archText = archObj ? JSON.stringify(archObj, null, 2) : null;

    if (!archText) {
      setDiff({ status: 'unknown', detail: "architect hasn't produced a contract yet." });
      return;
    }
    if (!backendJobId) {
      setDiff({ status: 'unknown', detail: "Backend hasn't run for this chat yet." });
      return;
    }
    const packText = await getJobFile(chatId, backendJobId, 'pack-attempt-0.txt');
    if (!packText) {
      setDiff({ status: 'unknown', detail: "Backend's pack isn't on disk (unexpected)." });
      return;
    }
    const chat = await (await fetch(`/api/chats/${chatId}`)).json();
    const briefText = chat?.chat?.brief ?? '';

    const byteIdentical = packText.includes(archText.trim()) || packText.includes(archText);
    const archHash = await sha256Hex(archText);

    let briefLeak = null;
    if (briefText) {
      const words = briefText.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 9);
      briefLeak = words.some((w) => packText.toLowerCase().includes(w.toLowerCase()));
    }

    setDiff({
      status: byteIdentical ? 'match' : 'mismatch',
      detail: byteIdentical
        ? `architect's contract (${archHash}) appears byte-identical inside Backend's pack.`
        : `architect's contract (${archHash}) was NOT found verbatim inside Backend's pack — investigate drift.`,
      briefLeak,
    });
  }

  return (
    <div>
      <div className="hash-row">
        <span className="badge mono">contractHash: {contractHash ?? 'not yet'}</span>
        {active === 'architecture.json' && localHash && (
          <span className={`badge ${localHash === contractHash ? 'ok' : 'bad'}`}>
            browser-computed: {localHash} {localHash === contractHash ? '✓ matches' : '✗ mismatch'}
          </span>
        )}
      </div>
      <div className="tab-row">
        {FILES.map((f) => (
          <button key={f.key} className={active === f.key ? 'active' : ''} onClick={() => setActive(f.key)}>
            {f.label}
          </button>
        ))}
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={runDiff}>
          Diff against Backend's pack
        </button>
      </div>
      {diff && diff !== 'checking' && (
        <div className={`diff-result ${diff.status}`}>
          {diff.status === 'match' ? '✓ ' : diff.status === 'mismatch' ? '✗ ' : '— '}
          {diff.detail}
          {diff.briefLeak === false && <div>✓ no long word from the brief appears in the pack (brief isolation, T3).</div>}
          {diff.briefLeak === true && <div>⚠ a long word from the brief appears in the pack — check for leakage.</div>}
        </div>
      )}
      {diff === 'checking' && <div className="diff-result unknown">checking…</div>}
      <div style={{ marginTop: 10 }}>
        {loading && <div className="empty-state">loading…</div>}
        {!loading && content === null && <div className="empty-state">{active} not written yet.</div>}
        {!loading && content !== null && <pre className="code-block">{content}</pre>}
      </div>
    </div>
  );
}
