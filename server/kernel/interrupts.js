// Bounded clarification (PRD §8.4). The round cap lives on the Inbox log, not in model
// memory — it survives restarts and cannot be argued away by a model.
//
// round 0 -> ask allowed -> human answers -> Architect revises -> re-validate
// round 1 -> ask allowed -> human answers -> Architect revises -> re-validate
// round 2 -> REFUSED. Run proceeds, records the assumption, marks elements BLOCKED_ON_UPSTREAM.
import { randomUUID } from 'node:crypto';
import { appendChatLog, readChatLog } from './chats.js';

export const MAX_CLARIFICATION_ROUNDS = 2;

export async function currentRound(chatId) {
  const inbox = await readChatLog(chatId, 'inbox.jsonl');
  return inbox.filter((i) => i.type === 'clarification').length;
}

/** @returns {{asked:boolean, round:number, item?:object, reason?:string}} */
export async function askClarification(chatId, question, context) {
  const round = await currentRound(chatId);
  if (round >= MAX_CLARIFICATION_ROUNDS) {
    return { asked: false, round, reason: 'ROUND_CAP_EXCEEDED' };
  }
  const item = {
    id: randomUUID().slice(0, 8),
    type: 'clarification',
    payload: { question, context },
    status: 'pending',
    round,
    tainted: 0,
    createdAt: new Date().toISOString(),
  };
  await appendChatLog(chatId, 'inbox.jsonl', item);
  return { asked: true, round, item };
}

export async function answerClarification(chatId, itemId, answer) {
  await appendChatLog(chatId, 'inbox.jsonl', {
    id: itemId,
    type: 'clarification_answer',
    answer,
    ts: Date.now(),
  });
}

export async function pendingClarification(chatId) {
  const inbox = await readChatLog(chatId, 'inbox.jsonl');
  const answered = new Set(inbox.filter((i) => i.type === 'clarification_answer').map((i) => i.id));
  return inbox.find((i) => i.type === 'clarification' && !answered.has(i.id)) ?? null;
}

export async function getAnswer(chatId, itemId) {
  const inbox = await readChatLog(chatId, 'inbox.jsonl');
  return inbox.find((i) => i.type === 'clarification_answer' && i.id === itemId)?.answer ?? null;
}
