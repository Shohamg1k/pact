import assert from 'node:assert';
import { buildSlackMessage, exportSlack } from './slack.js';

const run = { id: 'r1', projectName: 'Acme Bookings', status: 'done_stub' };
const trace = { rows: [{ contractItem: 'API-01', status: 'OK' }, { contractItem: 'API-02', status: 'GAP' }], gaps: ['API-02 has no implementing module'] };

const message = buildSlackMessage(run, trace, { preview: 'http://127.0.0.1:57564', contractTests: { passed: 6, total: 6 }, savedTokens: 42 });
assert.ok(message.text.includes('Acme Bookings'));
assert.ok(message.text.includes('done_stub'));
assert.ok(message.text.includes('2 contract items, 1 gap'));
assert.ok(message.text.includes('http://127.0.0.1:57564'));
assert.ok(message.text.includes('6/6 passed'));
assert.ok(message.text.includes('42'));
console.log('slack.selftest.mjs — buildSlackMessage checks passed');

// --- webhook POST, mocked fetch (no real SLACK_WEBHOOK_URL used) ---------------------------
{
  let posted = null;
  const fetchMock = async (url, options) => {
    posted = { url, body: JSON.parse(options.body) };
    return { ok: true };
  };
  const result = await exportSlack(run, trace, { webhookUrl: 'https://hooks.slack.example/not-real', fetch: fetchMock });
  assert.strictEqual(result.connector, 'slack');
  assert.strictEqual(result.posted, true);
  assert.strictEqual(posted.url, 'https://hooks.slack.example/not-real');
  assert.ok(posted.body.text.includes('Acme Bookings'));
  console.log('slack.selftest.mjs — exportSlack webhook POST (mocked) passed');
}

// --- a non-ok response should throw, not silently report success ---------------------------
{
  const fetchMock = async () => ({ ok: false, status: 500, text: async () => 'server error' });
  await assert.rejects(() => exportSlack(run, trace, { webhookUrl: 'https://hooks.slack.example/not-real', fetch: fetchMock }), /HTTP 500/);
  console.log('slack.selftest.mjs — failed webhook POST correctly throws');
}

// --- missing webhook URL should fail loudly ------------------------------------------------
{
  const originalEnv = process.env.SLACK_WEBHOOK_URL;
  delete process.env.SLACK_WEBHOOK_URL;
  try {
    await assert.rejects(() => exportSlack(run, trace, {}), /SLACK_WEBHOOK_URL/);
    console.log('slack.selftest.mjs — missing-webhook guard passed');
  } finally {
    if (originalEnv !== undefined) process.env.SLACK_WEBHOOK_URL = originalEnv;
  }
}

console.log('slack.selftest.mjs — all checks passed (no real Slack webhook was ever called)');
