// Budgeted, stable-first context packs (PRD §15 CTX-1/CTX-2/CTX-3). Stable sections
// (role, schema, few-shot, project memory) come first so the prefix is byte-identical
// across calls and provider caches hit; volatile sections (brief, worklog) come last.
// Truncation is logged, never silent (P4-adjacent: no silent data loss).

const CHARS_PER_TOKEN = 4; // matches the estimate used by router.js call accounting

function estimateTokens(text) {
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

/**
 * @param {string} text
 * @param {number} maxTokens
 * @param {'head'|'tail'|'middle'|'drop'} policy
 */
function truncate(text, maxTokens, policy) {
  const raw = estimateTokens(text);
  if (raw <= maxTokens) return { text, truncated: false, rawTokens: raw, packedTokens: raw };
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (policy === 'drop') {
    return { text: '', truncated: true, rawTokens: raw, packedTokens: 0 };
  }
  if (policy === 'tail') {
    // latest matters most — keep the END (worklogs: recent attempts > old ones)
    const kept = text.slice(-maxChars);
    return { text: kept, truncated: true, rawTokens: raw, packedTokens: estimateTokens(kept) };
  }
  if (policy === 'middle') {
    const half = Math.floor(maxChars / 2);
    const kept = text.slice(0, half) + '\n...[truncated]...\n' + text.slice(-half);
    return { text: kept, truncated: true, rawTokens: raw, packedTokens: estimateTokens(kept) };
  }
  // 'head' (default) — keep the beginning
  const kept = text.slice(0, maxChars);
  return { text: kept, truncated: true, rawTokens: raw, packedTokens: estimateTokens(kept) };
}

/**
 * @param {Array<{name:string, content:string, budget?:number, policy?:'head'|'tail'|'middle'|'drop'}>} sections
 * @returns {{text:string, report:{sections:Array<object>, rawTokens:number, packedTokens:number, savedTokens:number}}}
 */
export function buildPack(sections) {
  const report = { sections: [], rawTokens: 0, packedTokens: 0, savedTokens: 0 };
  const parts = [];

  for (const s of sections) {
    if (!s.content) continue;
    const result = s.budget
      ? truncate(s.content, s.budget, s.policy ?? 'head')
      : { text: s.content, truncated: false, rawTokens: estimateTokens(s.content), packedTokens: estimateTokens(s.content) };

    parts.push(result.text);
    report.sections.push({ name: s.name, ...result });
    report.rawTokens += result.rawTokens;
    report.packedTokens += result.packedTokens;
  }
  report.savedTokens = report.rawTokens - report.packedTokens;

  return { text: parts.filter(Boolean).join('\n\n'), report };
}
