// Ladder · ledger · cooldown · loss-free failover (PRD §9, §14). This is the module that
// makes ROUTE-2 true: a failover carries the IDENTICAL pack + worklog + partial output and
// continues — never restarts, never truncates. That guarantee must survive every refactor.
import { adapters as allAdapters } from './adapters/index.js';
import { appendChatLog } from './kernel/chats.js';

export class PactError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Does this error message look like an exhausted usage/rate limit (vs. a real failure)? */
export function isUsageLimitError(msg) {
  return /rate.?limit|usage limit|quota|429|too many requests|exhausted|resource.?exhausted|limit reached|out of.*(credits|usage)/i.test(
    msg ?? '',
  );
}

export function startCooldown(a, ms) {
  a.cooldownUntil = Date.now() + ms;
}

export function onCooldown(a) {
  return !!a.cooldownUntil && a.cooldownUntil > Date.now();
}

// --- quota ledger (ROUTE-4/ROUTE-5) — sliding-window request counts, in memory ---
const ledger = new Map(); // adapterId -> { minute: [ts...], day: [ts...] }

function windowFor(adapterId) {
  if (!ledger.has(adapterId)) ledger.set(adapterId, { minute: [], day: [] });
  return ledger.get(adapterId);
}

export function hasQuota(adapterId, limits) {
  if (!limits) return true;
  const now = Date.now();
  const w = windowFor(adapterId);
  w.minute = w.minute.filter((t) => now - t < 60_000);
  w.day = w.day.filter((t) => now - t < 86_400_000);
  if (limits.rpm && w.minute.length >= limits.rpm) return false;
  if (limits.rpd && w.day.length >= limits.rpd) return false;
  return true;
}

export function recordCall(adapterId) {
  const w = windowFor(adapterId);
  const now = Date.now();
  w.minute.push(now);
  w.day.push(now);
}

export function usageSnapshot() {
  const now = Date.now();
  return allAdapters.map((a) => {
    const w = windowFor(a.id);
    return {
      id: a.id,
      available: a.available,
      cooldownUntil: a.cooldownUntil ?? null,
      cooldownSecondsLeft: a.cooldownUntil ? Math.max(0, Math.round((a.cooldownUntil - now) / 1000)) : 0,
      callsLastMinute: w.minute.filter((t) => now - t < 60_000).length,
      callsToday: w.day.filter((t) => now - t < 86_400_000).length,
    };
  });
}

/** Escalation ladder: available, not cooling down, cheapest tier first. A human pin (ROUTE-8)
 * always wins — but only while it's actually usable; a pin on cooldown falls back to the
 * laddered order rather than forcing a call that's guaranteed to fail. */
export function ladder(pinnedAdapterId) {
  if (pinnedAdapterId) {
    const pinned = allAdapters.find((a) => a.id === pinnedAdapterId && a.available && !onCooldown(a));
    if (pinned) return [pinned];
  }
  return allAdapters.filter((a) => a.available && !onCooldown(a)).sort((a, b) => a.tier - b.tier);
}

/**
 * completeWithLadder — the loss-free failover implementation (PRD §9). On a rung's
 * failure the NEXT rung receives the same prompt plus the worklog plus the partial
 * output, with an explicit continuation instruction. No truncation, no summarization,
 * no restart.
 *
 * @param {string} prompt - the full context pack (already assembled by pack.js)
 * @param {Array} rungs - ladder(pinnedId)
 * @param {{chatId: string, phase: string, cwd: string}} ctx
 */
export async function completeWithLadder(prompt, rungs, ctx) {
  let currentPrompt = prompt;
  const triedIds = [];

  for (const a of rungs) {
    if (!hasQuota(a.id, a.limits)) continue;
    triedIds.push(a.id);
    try {
      recordCall(a.id);
      const out = await a.complete(currentPrompt, ctx);
      await appendChatLog(ctx.chatId, 'worklog.jsonl', {
        ts: Date.now(),
        phase: ctx.phase,
        adapter: a.id,
        event: 'call',
        detail: { ok: true },
      });
      return { text: out, adapterId: a.id };
    } catch (e) {
      if (isUsageLimitError(e.message) || e.isUsageLimitError) startCooldown(a, 15 * 60_000);
      await appendChatLog(ctx.chatId, 'worklog.jsonl', {
        ts: Date.now(),
        phase: ctx.phase,
        adapter: a.id,
        event: 'failover',
        detail: e.message,
        partial: e.partial ?? null,
      });
      if (e.partial) {
        // The critical rule: next rung gets the SAME pack + the partial output + an
        // explicit instruction to continue, not restart. Nothing is summarized here.
        currentPrompt =
          currentPrompt +
          '\n\n--- PARTIAL OUTPUT FROM A PREVIOUS ATTEMPT (different model, same task) ---\n' +
          e.partial +
          '\n--- END PARTIAL OUTPUT ---\n\n' +
          'Continue seamlessly from the furthest good state above — same goals, same ' +
          'structure, same conventions. Do NOT restart unless the partial work is ' +
          'unusable, and say so explicitly if you do.';
      }
      continue;
    }
  }
  throw new PactError('NO_CAPACITY', { tried: triedIds });
}
