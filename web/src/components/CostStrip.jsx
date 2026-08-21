import React, { useEffect, useState } from 'react';
import { getAdapters, getUsage } from '../api.js';

// UI-7: active rung, per-provider calls/tokens, savedTokens, cooldown resets — makes
// failover visible when it fires (PRD §14, §15 CTX-4).
export default function CostStrip({ activeAdapterId, savedTokens }) {
  const [adapters, setAdapters] = useState([]);
  const [usage, setUsage] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const [a, u] = await Promise.all([getAdapters(), getUsage()]);
      if (cancelled) return;
      setAdapters(a.adapters ?? []);
      setUsage(u.providers ?? []);
    }
    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

  return (
    <div className="cost-strip">
      {usage.map((u) => {
        const a = byId[u.id];
        return (
          <div key={u.id} className={`provider ${u.id === activeAdapterId ? 'active' : ''}`}>
            <span className={`badge dot ${a?.available ? 'ok' : 'bad'}`}>{a?.name ?? u.id}</span>
            <span className="metric">{u.callsToday} calls today</span>
            {u.cooldownSecondsLeft > 0 && <span className="badge warn">cooldown {u.cooldownSecondsLeft}s</span>}
          </div>
        );
      })}
      <span className="saved">savedTokens: {savedTokens ?? 0}</span>
    </div>
  );
}
