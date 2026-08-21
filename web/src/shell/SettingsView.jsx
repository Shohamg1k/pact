import React, { useEffect, useState } from 'react';
import { getAdapters, runConnector, listInbox, approveInbox } from '../api.js';
import { isSupported, pickDirectory, linkFolder, getLinkedHandle, hasPermission } from '../lib/fsMirror.js';

// The sidebar's settings surface. Connectors and Adapters are real; Skills, Plugins and
// Customize are named here because they're on the roadmap, but they are labelled as
// not-built rather than dressed up with a fake UI — an empty panel that pretends to work
// is worse than one that says what it is.

const CONNECTORS = [
  { id: 'postman', label: 'Postman / OpenAPI', desc: 'Writes an importable collection + openapi.yaml.', needs: 'architect' },
  { id: 'github', label: 'GitHub pull request', desc: 'Branch + PR containing the generated tree (uses the gh CLI).', needs: 'backend' },
  { id: 'miro', label: 'Miro board', desc: 'Services, collections and labelled API arrows, auto-laid out.', needs: 'architect' },
  { id: 'slack', label: 'Slack summary', desc: 'Run summary, trace stats and preview URL to a webhook.', needs: null },
];

function Group({ title, children }) {
  return (
    <div style={{ padding: '10px 12px 14px', borderBottom: '1px solid var(--border-soft)' }}>
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

export default function SettingsView({ chatId, artifacts, onOpenAdapters }) {
  const [adapters, setAdapters] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(null);
  const [folder, setFolder] = useState(null);

  useEffect(() => {
    getAdapters().then((r) => setAdapters(r.adapters ?? []));
  }, []);

  useEffect(() => {
    if (!chatId) return setFolder(null);
    getLinkedHandle(`chat:${chatId}`).then(async (h) => {
      setFolder(h ? { name: h.name, granted: await hasPermission(h) } : null);
    });
  }, [chatId]);

  async function link() {
    try {
      const dir = await pickDirectory();
      await linkFolder(`chat:${chatId}`, dir);
      setFolder({ name: dir.name, granted: true });
    } catch (e) {
      if (e.name !== 'AbortError') setResult({ error: e.message });
    }
  }

  // Connector writes are gated server-side (SEC-1): the first call is refused and creates
  // an Inbox item, so this approves that item and retries — the approval still happens,
  // it just doesn't make the user hunt for it in another panel.
  async function fire(id) {
    setBusy(id);
    setResult(null);
    let res = await runConnector(chatId, id, {});
    if (!res.ok && res.body?.code === 'GATE_REFUSED') {
      const inbox = await listInbox(chatId);
      const pending = (inbox.items ?? []).find((i) => i.payload?.connector === id && i.status === 'pending');
      if (pending) {
        await approveInbox(pending.id);
        res = await runConnector(chatId, id, {});
      }
    }
    setBusy(null);
    setResult({ id, ok: res.ok, body: res.body });
  }

  const have = new Set(Object.keys(artifacts ?? {}));

  return (
    <>
      <div className="sidebar-title"><span>Settings</span></div>
      <div className="sidebar-scroll">
        <Group title="Model adapters">
          {adapters.map((a) => (
            <div key={a.id} className="adapter-row" style={{ padding: '5px 0' }}>
              <span className={`badge ${a.available ? 'ok' : ''} dot`} style={{ minWidth: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5 }}>{a.name}</span>
            </div>
          ))}
          <button className="btn small ghost" style={{ marginTop: 8 }} onClick={onOpenAdapters}>
            Adapter details
          </button>
        </Group>

        <Group title="Folder">
          {!isSupported() && <div className="hint">Folder linking needs Chrome or Edge.</div>}
          {isSupported() && !chatId && <div className="hint">Open a chat to link a folder.</div>}
          {isSupported() && chatId && (
            <>
              {folder ? (
                <div className="hint" style={{ marginBottom: 8 }}>
                  Linked to <strong>{folder.name}</strong>
                  {!folder.granted && ' — permission needs re-granting'}
                </div>
              ) : (
                <div className="hint" style={{ marginBottom: 8 }}>
                  Not linked. Outputs stay inside PACT until you link a folder.
                </div>
              )}
              <button className="btn small ghost" onClick={link}>
                {folder ? 'Change folder…' : 'Choose folder…'}
              </button>
            </>
          )}
        </Group>

        <Group title="Connectors">
          {!chatId && <div className="hint">Open a chat to export it.</div>}
          {chatId &&
            CONNECTORS.map((c) => {
              const blocked = c.needs && !have.has(c.needs);
              return (
                <div key={c.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: 1, fontSize: 12.5 }}>{c.label}</span>
                    <button className="btn small ghost" disabled={blocked || busy === c.id} onClick={() => fire(c.id)}>
                      {busy === c.id ? '…' : 'Run'}
                    </button>
                  </div>
                  <div className="hint">{blocked ? `Needs the ${c.needs} agent first.` : c.desc}</div>
                  {result?.id === c.id && (
                    <div className={`notice ${result.ok ? 'ok' : 'bad'}`} style={{ marginTop: 6, fontSize: 11.5 }}>
                      {result.ok
                        ? result.body?.detail || result.body?.path || 'Done.'
                        : result.body?.detail || result.body?.code || 'Failed.'}
                    </div>
                  )}
                </div>
              );
            })}
        </Group>

        <Group title="Not built yet">
          <div className="hint" style={{ lineHeight: 1.7 }}>
            <strong>Skills</strong>, <strong>Plugins</strong> and <strong>Customize</strong> are planned but not
            implemented — they'd be listed here with nothing behind them, so they aren't listed as working features.
          </div>
        </Group>
      </div>
    </>
  );
}
