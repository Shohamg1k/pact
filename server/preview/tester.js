// "Test with frontend" — a deterministic, auto-generated API tester built straight from
// the architect's contract, no model call and no UI/UX+Frontend agent pair required.
// Frontend (the AGENT) is a real generated app built from wireframes; this is a
// different, complementary thing — a zero-latency way to exercise every declared
// endpoint the moment Backend commits, so "test all the features" doesn't have to wait
// on two more agent runs (each several minutes) just to click a button.
//
// Self-contained HTML + inline JS (no bundler): every request goes through the SAME
// POST /api/chats/:id/preview/request route the API Console uses, same-origin, so no
// CORS setup and no separate proxy path to maintain.

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Best-effort JSON body skeleton from the contract's free-text `request` shape hints —
 * same spirit as ApiConsole.jsx's pick(), just rendered server-side into the page. */
function bodySkeleton(api) {
  if (!api.request || api.method === 'GET' || api.method === 'DELETE') return '';
  const pathParamNames = new Set((api.path.match(/:([a-zA-Z_]+)/g) ?? []).map((p) => p.slice(1)));
  const fields = Object.entries(api.request).filter(([k]) => !pathParamNames.has(k) && k !== 'limit' && k !== 'cursor');
  if (fields.length === 0) return '';
  return JSON.stringify(Object.fromEntries(fields.map(([k]) => [k, ''])), null, 2);
}

export function buildTesterDocument(contract, opts = {}) {
  if (!contract) {
    return `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;padding:24px;color:#888}</style>
    <p>The Solution Architect hasn't produced a contract yet — nothing to test.</p>`;
  }
  const apis = contract.apis ?? [];
  const byFeature = new Map();
  for (const api of apis) {
    const key = api.feature_id ?? '—';
    if (!byFeature.has(key)) byFeature.set(key, []);
    byFeature.get(key).push(api);
  }
  const featureName = (id) => (contract.features ?? []).find((f) => f.id === id)?.name ?? id;

  const cards = [...byFeature.entries()]
    .map(
      ([featId, list], gi) => `
    <section class="feature">
      <h2>${esc(featureName(featId))} <span class="fid">${esc(featId)}</span></h2>
      ${list
        .map((api, i) => {
          const cardId = `c${gi}_${i}`;
          const pathParams = [...api.path.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]);
          return `
        <div class="card">
          <div class="card-head">
            <span class="verb v-${api.method}">${api.method}</span>
            <span class="path">${esc(api.path)}</span>
            <span class="apiid">${esc(api.id)}</span>
          </div>
          ${pathParams.length ? `<div class="row">${pathParams
            .map((p) => `<label>${esc(p)} <input data-pparam="${esc(p)}" data-card="${cardId}" placeholder="${esc(p)}" /></label>`)
            .join('')}</div>` : ''}
          ${api.method !== 'GET' && api.method !== 'DELETE'
            ? `<textarea data-body data-card="${cardId}" placeholder="Request body (JSON)">${esc(bodySkeleton(api))}</textarea>`
            : ''}
          ${(api.rules ?? []).length ? `<details class="rules"><summary>${api.rules.length} business rule${api.rules.length === 1 ? '' : 's'}</summary>${api.rules
            .map((r) => `<div class="rule">${esc(r)}</div>`)
            .join('')}</details>` : ''}
          <div class="row">
            <button data-send data-card="${cardId}" data-method="${esc(api.method)}" data-path="${esc(api.path)}">Send</button>
            <span data-status data-card="${cardId}" class="status"></span>
            <span data-elapsed data-card="${cardId}" class="elapsed"></span>
          </div>
          <pre data-response data-card="${cardId}" class="response" hidden></pre>
        </div>`;
        })
        .join('')}
    </section>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(contract.meta?.id ?? 'API tester')}</title>
<style>
  :root { --bg:#171514; --raised:#221f1e; --border:#33302d; --text:#ddd8d3; --faint:#8a837c; --accent:#6ba3d6; --green:#7fb069; --red:#d9635f; --yellow:#d9b45f; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; padding:20px 24px 60px; }
  h1 { font-size:15px; margin:0 0 4px; }
  .sub { color:var(--faint); font-size:12px; margin-bottom:18px; }
  .authbar { display:flex; gap:8px; align-items:center; background:var(--raised); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:20px; }
  .authbar input { flex:1; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:6px 9px; font:12px ui-monospace,monospace; }
  .authbar label { font-size:11px; color:var(--faint); white-space:nowrap; }
  .feature { margin-bottom:22px; }
  .feature h2 { font-size:12.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--faint); margin:0 0 10px; font-weight:600; }
  .fid { font-weight:400; opacity:.6; margin-left:6px; }
  .card { background:var(--raised); border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin-bottom:10px; }
  .card-head { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .verb { font:700 10.5px ui-monospace,monospace; padding:2px 7px; border-radius:4px; }
  .v-GET{background:rgba(107,163,214,.18);color:var(--accent)} .v-POST{background:rgba(127,176,105,.18);color:var(--green)}
  .v-PUT,.v-PATCH{background:rgba(217,180,95,.18);color:var(--yellow)} .v-DELETE{background:rgba(217,99,95,.18);color:var(--red)}
  .path { font:12.5px ui-monospace,monospace; flex:1; }
  .apiid { font-size:10.5px; color:var(--faint); }
  .row { display:flex; gap:8px; align-items:center; margin:8px 0; flex-wrap:wrap; }
  .row label { font-size:11px; color:var(--faint); display:flex; gap:4px; align-items:center; }
  .row input { background:var(--bg); border:1px solid var(--border); border-radius:5px; color:var(--text); padding:4px 7px; font:12px ui-monospace,monospace; width:130px; }
  textarea[data-body] { width:100%; min-height:64px; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--text); padding:8px; font:12px ui-monospace,monospace; margin:6px 0; resize:vertical; }
  .rules { margin:6px 0; font-size:11px; color:var(--faint); }
  .rules summary { cursor:pointer; }
  .rule { padding:4px 0 4px 12px; border-left:2px solid var(--border); margin-top:4px; }
  button[data-send] { background:var(--accent); color:#0d1117; border:none; border-radius:6px; padding:6px 14px; font:600 12px inherit; cursor:pointer; }
  button[data-send]:disabled { opacity:.5; cursor:default; }
  .status { font:700 11px ui-monospace,monospace; padding:2px 7px; border-radius:10px; }
  .status.ok { background:rgba(127,176,105,.18); color:var(--green); }
  .status.warn { background:rgba(217,180,95,.18); color:var(--yellow); }
  .status.bad { background:rgba(217,99,95,.18); color:var(--red); }
  .elapsed { font-size:11px; color:var(--faint); }
  .response { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; margin:8px 0 0; white-space:pre-wrap; word-break:break-word; font:11.5px ui-monospace,monospace; max-height:260px; overflow:auto; }
  .empty { color:var(--faint); padding:30px 0; text-align:center; }
</style>
</head><body>
  <h1>${esc(contract.meta?.id ?? 'Generated API')} — feature tester</h1>
  <div class="sub">Auto-generated from the contract, no extra agent run — every declared endpoint, live against the running backend.</div>
  <div class="authbar">
    <label>Authorization</label>
    <input id="token" placeholder="Bearer token (paste a JWT if the contract requires one)" />
  </div>
  ${apis.length ? cards : '<div class="empty">This contract declares no APIs.</div>'}
<script>
(function () {
  const chatId = ${JSON.stringify(opts.chatId ?? '')};
  const tokenInput = document.getElementById('token');
  const stored = localStorage.getItem('pact:apiToken:' + chatId);
  if (stored) tokenInput.value = stored;
  tokenInput.addEventListener('input', () => {
    if (tokenInput.value.trim()) localStorage.setItem('pact:apiToken:' + chatId, tokenInput.value.trim());
    else localStorage.removeItem('pact:apiToken:' + chatId);
  });

  document.querySelectorAll('[data-send]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.dataset.card;
      let path = btn.dataset.path;
      document.querySelectorAll(\`[data-pparam][data-card="\${card}"]\`).forEach((inp) => {
        if (inp.value.trim()) path = path.replace(':' + inp.dataset.pparam, encodeURIComponent(inp.value.trim()));
      });
      const bodyEl = document.querySelector(\`[data-body][data-card="\${card}"]\`);
      let body;
      if (bodyEl && bodyEl.value.trim()) {
        try { body = JSON.parse(bodyEl.value); }
        catch { alert('Request body is not valid JSON'); return; }
      }
      const statusEl = document.querySelector(\`[data-status][data-card="\${card}"]\`);
      const elapsedEl = document.querySelector(\`[data-elapsed][data-card="\${card}"]\`);
      const respEl = document.querySelector(\`[data-response][data-card="\${card}"]\`);
      btn.disabled = true;
      statusEl.textContent = '…'; statusEl.className = 'status';
      const t0 = performance.now();
      const token = tokenInput.value.trim();
      try {
        const res = await fetch('/api/chats/' + chatId + '/preview/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: btn.dataset.method, path, body,
            headers: token ? { Authorization: token.startsWith('Bearer ') ? token : 'Bearer ' + token } : undefined,
          }),
        });
        const data = await res.json();
        const elapsed = Math.round(performance.now() - t0);
        elapsedEl.textContent = elapsed + ' ms';
        const status = data.status ?? (data.code ? 'error' : '');
        statusEl.textContent = status;
        statusEl.className = 'status ' + (typeof status === 'number' ? (status < 300 ? 'ok' : status < 500 ? 'warn' : 'bad') : 'bad');
        respEl.hidden = false;
        respEl.textContent = JSON.stringify(data.body ?? data, null, 2);
      } catch (e) {
        statusEl.textContent = 'error'; statusEl.className = 'status bad';
        respEl.hidden = false; respEl.textContent = String(e.message || e);
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
</script>
</body></html>`;
}
