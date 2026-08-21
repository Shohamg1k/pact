// CONN-4 — Slack (PRD §18, P2). A webhook POST with the run summary, trace stats, preview
// URL, and cost — no model call. `opts.fetch` is injectable so the message-building is
// unit-testable without a real SLACK_WEBHOOK_URL (see slack.selftest.mjs).

/** Pure function: run + trace -> the Slack message payload. No I/O. */
export function buildSlackMessage(run, trace, opts = {}) {
  const gapCount = (trace?.gaps ?? []).length;
  const lines = [
    `*PACT run ${run.id}*${run.projectName ? ` — ${run.projectName}` : ''}`,
    `Status: \`${run.status}\``,
    `Trace: ${trace?.rows?.length ?? 0} contract items, ${gapCount} gap${gapCount === 1 ? '' : 's'}`,
    opts.preview ? `Preview: ${opts.preview}` : null,
    opts.contractTests ? `Contract tests: ${opts.contractTests.passed}/${opts.contractTests.total} passed` : null,
    opts.savedTokens != null ? `Saved tokens: ${opts.savedTokens}` : null,
  ].filter(Boolean);
  return { text: lines.join('\n') };
}

/**
 * @param {object} run - run.json's contents
 * @param {object} trace - trace.json's contents
 * @param {{webhookUrl?: string, preview?: string, contractTests?: object, savedTokens?: number, fetch?: Function}} [opts]
 */
export async function exportSlack(run, trace, opts = {}) {
  const webhookUrl = opts.webhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('Slack export needs SLACK_WEBHOOK_URL (env var or opts.webhookUrl) — never written into .pact/ (SEC-3)');
  const fetchImpl = opts.fetch ?? fetch;

  const message = buildSlackMessage(run, trace, opts);
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return { connector: 'slack', posted: true, text: message.text };
}
