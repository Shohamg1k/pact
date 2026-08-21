import assert from 'node:assert';
import { rm } from 'node:fs/promises';
import { chatDir } from './chats.js';
import { requestConnectorWrite, listInboxItems, getInboxItem, findApprovedConnectorWrite, approveInboxItem, rejectInboxItem, ackInboxItem } from './inbox.js';

const chatId = `inbox-selftest-${Date.now()}`;

try {
  // Nothing requested yet -> no approval.
  assert.strictEqual(await findApprovedConnectorWrite(chatId, 'postman'), null);

  const item = await requestConnectorWrite(chatId, 'postman', { note: 'export openapi + collection' });
  assert.strictEqual(item.status, 'pending');
  assert.strictEqual(item.payload.connector, 'postman');

  // Requested but not yet approved -> findApprovedConnectorWrite reports it, but not approved.
  const pending = await findApprovedConnectorWrite(chatId, 'postman');
  assert.strictEqual(pending.id, item.id);
  assert.strictEqual(pending.status, 'pending');

  const listed = await listInboxItems(chatId, { types: ['connector_write'] });
  assert.strictEqual(listed.length, 1);
  assert.strictEqual(listed[0].status, 'pending');

  await approveInboxItem(chatId, item.id);
  const approved = await findApprovedConnectorWrite(chatId, 'postman');
  assert.strictEqual(approved.status, 'approved');
  console.log('inbox.selftest.mjs — request -> pending -> approve round trip passed');

  // A second, later request for the SAME connector should supersede the first — an old
  // approval must not authorize a brand-new write.
  const item2 = await requestConnectorWrite(chatId, 'postman', { note: 'export again after a manifest change' });
  const latest = await findApprovedConnectorWrite(chatId, 'postman');
  assert.strictEqual(latest.id, item2.id);
  assert.strictEqual(latest.status, 'pending', 'the newer request should not inherit the old approval');
  console.log('inbox.selftest.mjs — newer request supersedes an old approval, correctly unapproved');

  await rejectInboxItem(chatId, item2.id);
  const rejected = await getInboxItem(chatId, item2.id);
  assert.strictEqual(rejected.status, 'rejected');
  console.log('inbox.selftest.mjs — reject round trip passed');

  const item3 = await requestConnectorWrite(chatId, 'github', { note: 'open a PR' }, { tainted: true });
  await approveInboxItem(chatId, item3.id);
  let stillTainted = await getInboxItem(chatId, item3.id);
  assert.strictEqual(stillTainted.tainted, 1, 'approval alone should not clear taint');
  await ackInboxItem(chatId, item3.id);
  const acked = await getInboxItem(chatId, item3.id);
  assert.strictEqual(acked.tainted, 0, 'ack should clear taint');
  assert.strictEqual(acked.status, 'approved', 'ack should not change an already-approved status');
  console.log('inbox.selftest.mjs — tainted item requires a separate ack to clear, approval alone is not enough');
} finally {
  await rm(chatDir(chatId), { recursive: true, force: true }).catch(() => {});
}

console.log('inbox.selftest.mjs — all checks passed');
