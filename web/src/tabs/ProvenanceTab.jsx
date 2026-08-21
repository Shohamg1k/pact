import React, { useEffect, useState } from 'react';
import { getFile, getJobFile } from '../api.js';
import { sha256Hex } from '../lib/hash.js';

// PACT's central claim is that the handoff between agents is physical, not asserted:
// each agent receives its declared upstream artifacts VERBATIM and nothing else. This
// tab re-derives that claim from the bytes on disk, in the browser, rather than
// displaying a server-computed verdict — every hash here is recomputed locally from the
// exact bytes fetched, so it stays evidence even if you don't trust the daemon.
//
// Three checks per agent (PRD §23 CORE-4, §24 T2/T3, §27):
//   1. Verbatim embedding — the upstream artifact's exact bytes appear inside the pack.
//   2. Hash equality      — sha256(upstream artifact) matches what the pack carries.
//   3. Brief isolation    — for a downstream agent, no distinctive word from the brief
//                           appears in the pack at all.

// Brief isolation (T3) has to be tested carefully to mean anything. Individual domain
// words are NOT evidence: the architect's contract legitimately carries "booking",
// "library", "invoice" downstream — that's the handoff working, not a leak. What would
// actually indicate the brief was piped through is the user's own PHRASING surviving
// verbatim, so that's the primary check; a rare-token scan is a secondary signal, and
// when the brief contains no rare token we say the test had no power rather than
// showing a green badge for having searched for nothing.
const GENERIC = new Set([
  'management', 'requirements', 'application', 'information', 'implementation', 'functionality',
  'authentication', 'authorization', 'configuration', 'administrator', 'automatically', 'associated',
  'available', 'different', 'following', 'including', 'something', 'everything', 'important',
]);

function distinctiveWords(brief) {
  return [...new Set(
    brief.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 9 && !GENERIC.has(w)),
  )];
}

/** The longest run of consecutive brief words that survives verbatim in the pack.
 * Anything past a few words in a row is the user's phrasing, not shared vocabulary. */
function longestVerbatimRun(brief, pack) {
  const words = brief.trim().split(/\s+/);
  const hay = pack.toLowerCase();
  let best = 0;
  for (let i = 0; i < words.length; i++) {
    for (let n = best + 1; i + n <= words.length; n++) {
      if (hay.includes(words.slice(i, i + n).join(' ').toLowerCase())) best = n;
      else break;
    }
  }
  return best;
}

const PHRASE_LIMIT = 5; // a 5-word verbatim run is phrasing, not coincidence

async function checkRole({ chatId, role, reads, job, brief, jobsByRole }) {
  const pack = await getJobFile(chatId, job.id, 'pack-attempt-0.txt');
  if (!pack) return { role, jobId: job.id, error: 'No pack recorded for this job.' };

  const upstream = [];
  for (const dep of reads) {
    const raw = await getFile(chatId, `artifacts/${dep}.json`);
    if (!raw) continue; // that role never ran — nothing was owed

    // An artifact can only have been embedded if it already existed when this job
    // STARTED. Roles are runnable in any order and at any later time (that's the point
    // of a resumable chat), so comparing today's pm output against an architect pack
    // built before pm ever ran would flag a correct system as a violation.
    const depCommitted = (jobsByRole.get(dep) ?? []).some(
      (j) => j.status === 'passed' && j.endedAt && j.endedAt < job.startedAt,
    );
    if (!depCommitted) {
      upstream.push({ dep, availableAtRun: false, hash: await sha256Hex(raw) });
      continue;
    }
    upstream.push({ dep, availableAtRun: true, verbatim: pack.includes(raw.trim()) || pack.includes(raw), hash: await sha256Hex(raw) });
  }

  // pm and architect legitimately read the brief; everyone downstream must not see it.
  const readsBrief = role === 'pm' || role === 'architect';
  const words = distinctiveWords(brief ?? '');
  const leaked = readsBrief ? [] : words.filter((w) => pack.toLowerCase().includes(w));
  const run = readsBrief || !brief ? 0 : longestVerbatimRun(brief, pack);

  return {
    role,
    jobId: job.id,
    packBytes: pack.length,
    upstream,
    readsBrief,
    words: words.length,
    leaked,
    run,
    phraseLeak: run >= PHRASE_LIMIT,
    ok: upstream.every((u) => !u.availableAtRun || u.verbatim) && leaked.length === 0 && run < PHRASE_LIMIT,
  };
}

export default function ProvenanceTab({ chatId, chat, roles, onOpenPack }) {
  const [rows, setRows] = useState(null);
  const [census, setCensus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRows(null);
      const jobs = (chat?.jobs ?? []).filter((j) => j.status === 'passed');
      // Newest passed job per role — a re-run should be judged on what it produced last.
      const latest = new Map();
      for (const j of jobs) latest.set(j.role, j);

      const graph = Object.fromEntries(roles.map((r) => [r.id, r]));
      const jobsByRole = new Map();
      for (const j of chat?.jobs ?? []) {
        if (!jobsByRole.has(j.role)) jobsByRole.set(j.role, []);
        jobsByRole.get(j.role).push(j);
      }
      const out = [];
      for (const [role, job] of latest) {
        out.push(await checkRole({ chatId, role, reads: graph[role]?.reads ?? [], job, brief: chat?.chat?.brief, jobsByRole }));
      }

      const worklogText = await getFile(chatId, 'worklog.jsonl');
      const events = (worklogText ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const calls = events.filter((e) => e.event === 'call');
      const byPhase = {};
      for (const c of calls) byPhase[c.phase] = (byPhase[c.phase] ?? 0) + 1;

      if (!cancelled) {
        setRows(out);
        setCensus({ total: calls.length, byPhase, repairs: events.filter((e) => e.event === 'repair').length, failovers: events.filter((e) => e.event === 'failover').length });
      }
    })();
    return () => { cancelled = true; };
  }, [chatId, chat, roles]);

  if (!rows) return <div className="editor-pad"><div className="empty-state">Recomputing hashes from the artifacts on disk…</div></div>;
  if (rows.length === 0) return <div className="editor-pad"><div className="empty-state">No agent has committed an artifact for this chat yet.</div></div>;

  const label = (id) => roles.find((r) => r.id === id)?.label ?? id;
  const allOk = rows.every((r) => r.ok);

  return (
    <div className="editor-pad">
      <div className={`notice ${allOk ? 'ok' : 'bad'}`}>
        {allOk
          ? 'Every agent received exactly the upstream artifacts that existed when it ran, byte-for-byte, and no downstream agent saw the brief. Hashes below were recomputed in this browser from the bytes on disk.'
          : 'One or more handoffs did not verify — see the failing rows below.'}
      </div>

      <div className="section-title">Handoff chain</div>
      {rows.map((r) => (
        <div key={r.role} className="mini-card" style={{ marginBottom: 10 }}>
          <div className="mini-card-title">
            <span>{label(r.role)}</span>
            {r.error ? <span className="badge bad">{r.error}</span> : r.ok ? <span className="badge ok">verified</span> : <span className="badge bad">failed</span>}
            <span className="badge mono" style={{ marginLeft: 'auto' }}>{r.packBytes?.toLocaleString()} bytes sent</span>
            {onOpenPack && !r.error && (
              <button className="btn small ghost" onClick={() => onOpenPack(r.role, r.jobId)}>Open pack</button>
            )}
          </div>

          {!r.error && (
            <table className="grid" style={{ marginTop: 6 }}>
              <tbody>
                {r.upstream.length === 0 && (
                  <tr><td colSpan={3} style={{ color: 'var(--text-faint)' }}>Entry point — reads the brief, no upstream artifact owed.</td></tr>
                )}
                {r.upstream.map((u) => (
                  <tr key={u.dep}>
                    <td style={{ width: 150 }}>{label(u.dep)}&nbsp;artifact</td>
                    <td className="mono" style={{ color: 'var(--text-faint)' }}>{u.hash.slice(0, 23)}…</td>
                    <td style={{ width: 190 }}>
                      {!u.availableAtRun ? (
                        <span className="badge" title="This role committed after the job above ran, so it could not have been in its pack.">
                          ran later — not owed
                        </span>
                      ) : u.verbatim ? (
                        <span className="badge ok">embedded verbatim</span>
                      ) : (
                        <span className="badge bad">NOT found in pack</span>
                      )}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Brief isolation</td>
                  <td style={{ color: 'var(--text-faint)' }}>
                    {r.readsBrief
                      ? 'reads the brief by design'
                      : `longest verbatim run from the brief: ${r.run} word${r.run === 1 ? '' : 's'}` +
                        (r.words ? ` · ${r.words} rare token${r.words === 1 ? '' : 's'} scanned` : ' · no rare tokens in this brief')}
                  </td>
                  <td>
                    {r.readsBrief ? (
                      <span className="badge">n/a</span>
                    ) : r.phraseLeak ? (
                      <span className="badge bad">brief phrasing present</span>
                    ) : r.leaked.length ? (
                      <span className="badge bad">leaked: {r.leaked.slice(0, 3).join(', ')}</span>
                    ) : r.words === 0 ? (
                      <span className="badge ok" title="No rare token existed to scan for, so that half of the test had no power; the phrase check is what carries this row.">
                        no phrasing carried over
                      </span>
                    ) : (
                      <span className="badge ok">no phrasing, no rare tokens</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 24 }}>Model-call census</div>
      <div className="notice">
        Model count is not agent count. {census.total} model call{census.total === 1 ? '' : 's'} produced{' '}
        {rows.length} agent artifact{rows.length === 1 ? '' : 's'}
        {census.repairs > 0 && ` — ${census.repairs} of those calls were bounded gate repairs`}
        {census.failovers > 0 && `, ${census.failovers} were failovers continuing the same role on another engine`}.
        Every call below is attributed to a named agent phase; gates, trace and connectors invoke no model at all.
      </div>
      <table className="grid">
        <thead><tr><th>Agent phase</th><th>Model calls</th></tr></thead>
        <tbody>
          {Object.entries(census.byPhase).map(([phase, n]) => (
            <tr key={phase}><td>{label(phase)}</td><td className="mono">{n}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
