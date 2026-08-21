// worklog.jsonl carries repair/failover/drift/gate events that the orchestrator's SSE
// stream does NOT emit directly (only phase transitions are emitted — PRD §10, §11). The
// pipeline strip (UI-1) polls this artifact to render repair/failover/drift chips live.
export function parseWorklog(text) {
  if (!text) return [];
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Group worklog entries into per-phase chip lists: repair / failover / drift / other events.
 * The real pipeline can log the same logical event twice in a row (e.g. architect.js logs
 * 'awaiting_human' once itself, and once again via orchestrator.js's setPhase) — collapse
 * immediately-adjacent duplicates (same phase+event+itemId) into one chip. This only affects
 * display; nothing is hidden from worklog.jsonl itself.
 */
export function chipsByPhase(entries) {
  const byPhase = {};
  for (const e of entries) {
    if (!e.phase) continue;
    if (!['repair', 'failover', 'drift', 'awaiting_human', 'exhausted'].includes(e.event)) continue;
    const list = (byPhase[e.phase] ??= []);
    const prev = list[list.length - 1];
    const dupe = prev && prev.event === e.event && prev.detail?.itemId === e.detail?.itemId && prev.detail?.attempt === e.detail?.attempt;
    if (dupe) {
      list[list.length - 1] = e; // keep the richer (later) copy, still one chip
    } else {
      list.push(e);
    }
  }
  return byPhase;
}
