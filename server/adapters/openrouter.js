// The HTTP rung (PRD §9, §1 "Agent execution: ... OpenRouter HTTP rung"). Fallback when
// no CLI is on PATH or every CLI rung is on cooldown. Key comes from env only (SEC-3) —
// never written into .pact/, never into a pack, never displayed.
export const OPENROUTER_CFG = {
  kind: 'http',
  model: 'anthropic/claude-sonnet-4',
  timeoutMs: 120_000,
};

export async function completeOpenRouter(prompt, cfg = OPENROUTER_CFG) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set — add it to .env');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 200)}`);
    if (res.status === 429) err.isUsageLimitError = true;
    throw err;
  }

  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

export async function probeOpenRouter() {
  return !!process.env.OPENROUTER_API_KEY;
}
