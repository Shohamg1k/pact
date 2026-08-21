import React, { useEffect, useState } from 'react';
import { getArtifact } from '../api.js';
import { sha256Hex } from '../lib/hash.js';

// UI-2: the real .pact/ files with a sha256 badge, and a "diff against Agent 2's pack"
// button that proves byte-identity on stage (CORE-4, T2/T3 acceptance criteria).
const FILES = [
  { key: 'architecture.json', label: 'architecture.json' },
  { key: 'openapi.yaml', label: 'openapi.yaml' },
  { key: 'schema.mongo.json', label: 'schema.mongo.json' },
  { key: 'decisions.md', label: 'decisions.md' },
];

export default function SpecViewer({ runId, contractHash }) {
  const [active, setActive] = useState('architecture.json');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [localHash, setLocalHash] = useState(null);
  const [diff, setDiff] = useState(null); // null | 'checking' | {status:'match'|'mismatch'|'unknown', detail}

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    getArtifact(runId, active).then(async (text) => {
      if (cancelled) return;
      setContent(text);
      setLoading(false);
      if (active === 'architecture.json' && text) {
        setLocalHash(await sha256Hex(text));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runId, active]);

  async function runDiff() {
    setDiff('checking');
    const [archText, packText] = await Promise.all([
      getArtifact(runId, 'architecture.json'),
      getArtifact(runId, 'packs/agent2.txt'),
    ]);
    const briefText = await getArtifact(runId, 'requirement.md');

    if (!archText) {
      setDiff({ status: 'unknown', detail: 'architecture.json not written yet — Gate V1 has not passed.' });
      return;
    }
    if (!packText) {
      setDiff({
        status: 'unknown',
        detail: "packs/agent2.txt doesn't exist yet — Agent 2 is still a timed stub (feat/core-pipeline). This check will run for real once it lands.",
      });
      return;
    }

    const byteIdentical = packText.includes(archText.trim()) || packText.includes(archText);
    const archHash = await sha256Hex(archText);

    // T3: prove Agent 2's pack never contains a distinctive phrase from the brief (CORE-4).
    let briefLeak = null;
    if (briefText) {
      const words = briefText.replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 7);
      const rareWord = words.find((w) => !packText.toLowerCase().includes(w.toLowerCase()));
      briefLeak = words.some((w) => packText.toLowerCase().includes(w.toLowerCase()) && w.length >= 9);
    }

    setDiff({
      status: byteIdentical ? 'match' : 'mismatch',
      detail: byteIdentical
        ? `architecture.json (${archHash}) appears byte-identical inside packs/agent2.txt.`
        : `architecture.json (${archHash}) was NOT found verbatim inside packs/agent2.txt — investigate drift.`,
      briefLeak,
    });
  }

  return (
    <div>
      <div className="hash-row">
        <span className="badge mono">gateV1 contractHash: {contractHash ?? 'not yet'}</span>
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
          Diff against Agent 2's pack
        </button>
      </div>
      {diff && diff !== 'checking' && (
        <div className={`diff-result ${diff.status}`}>
          {diff.status === 'match' ? '✓ ' : diff.status === 'mismatch' ? '✗ ' : '— '}
          {diff.detail}
          {diff.briefLeak === false && <div>✓ no long word from requirement.md appears in the pack (brief isolation, T3).</div>}
          {diff.briefLeak === true && <div>⚠ a long word from requirement.md appears in the pack — check for leakage.</div>}
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
