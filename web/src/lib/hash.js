// Client-side sha256, in the same `sha256:<hex>` shape kernel/store.js writes server-side
// (PRD §7). Used to prove hash equality on stage (UI-2) without trusting a server-computed
// value — the browser recomputes it from the exact bytes it fetched.
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
