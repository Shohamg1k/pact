import React, { useEffect, useState } from 'react';
import { getAdapters } from '../api.js';

// UI-9: availability badges + the real launch command per adapter, derived from the
// registry (ROUTE-3, ROUTE-6) — display cannot drift from behaviour because the server
// builds launchCommand from the same config object spawn.js uses.
export default function AdapterSettings({ onClose }) {
  const [adapters, setAdapters] = useState([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const { adapters } = await getAdapters();
      if (!cancelled) setAdapters(adapters);
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Adapter settings</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginTop: -6 }}>
          Ladder order (tier ascending) · re-probed every 30s, no restart needed (ROUTE-6).
        </p>
        {adapters
          .slice()
          .sort((a, b) => a.tier - b.tier)
          .map((a) => (
            <div key={a.id} className="adapter-row">
              <span className={`badge dot ${a.available ? 'ok' : 'bad'}`}>tier {a.tier}</span>
              <span className="name">{a.name}</span>
              <span className="detail">
                {a.detail}
                {a.cooldownUntil && a.cooldownUntil > Date.now() ? ` · cooldown until ${new Date(a.cooldownUntil).toLocaleTimeString()}` : ''}
              </span>
              {a.launchCommand && <span className="launch-cmd">{a.launchCommand}</span>}
            </div>
          ))}
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
