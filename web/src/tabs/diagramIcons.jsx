import React from 'react';

// Technology glyphs for architecture diagrams. Deliberately GENERIC shapes rather than
// vendor logos: real logos are trademarked assets we can neither ship nor license, and a
// wrong-but-familiar logo would misrepresent what was actually specified. These read the
// same way at a glance (a cylinder is a datastore, a shield is auth) while staying
// honest about being category icons.
//
// Each glyph is drawn in a 24x24 box and inherits `currentColor`, so the renderer can
// tint it by category.

const S = ({ d, fill, children, sw = 1.6 }) => (
  <g fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {d && <path d={d} fill={fill ?? 'none'} />}
    {children}
  </g>
);

export const GLYPHS = {
  service: () => <S><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M3.5 9.5h17M7 7.2h.01" /></S>,
  api: () => <S><path d="M8 4.5 4 12l4 7.5M16 4.5 20 12l-4 7.5M13.5 5l-3 14" /></S>,
  gateway: () => <S><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" /></S>,
  database: () => <S><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8" /></S>,
  cache: () => <S><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v12c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6V6" /><path d="M13.5 10 10 14.5h4L10.5 19" /></S>,
  storage: () => <S><rect x="3.5" y="4" width="17" height="7" rx="1.6" /><rect x="3.5" y="13" width="17" height="7" rx="1.6" /><path d="M7 7.5h.01M7 16.5h.01" /></S>,
  queue: () => <S><rect x="2.5" y="8" width="5" height="8" rx="1.2" /><rect x="9.5" y="8" width="5" height="8" rx="1.2" /><rect x="16.5" y="8" width="5" height="8" rx="1.2" /></S>,
  auth: () => <S><path d="M12 3.5 5 6.5v5c0 4.2 2.9 8 7 9.2 4.1-1.2 7-5 7-9.2v-5z" /><path d="M9.4 12.1l1.9 1.9 3.4-3.6" /></S>,
  user: () => <S><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c0-3.4 2.9-5.6 6.5-5.6s6.5 2.2 6.5 5.6" /></S>,
  browser: () => <S><rect x="2.5" y="4" width="19" height="16" rx="2" /><path d="M2.5 9h19M6 6.6h.01M8.6 6.6h.01" /></S>,
  mobile: () => <S><rect x="7" y="2.5" width="10" height="19" rx="2.4" /><path d="M10.8 18.6h2.4" /></S>,
  server: () => <S><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7.5h8M8 12h8M8 16.5h4" /></S>,
  cloud: () => <S><path d="M7 18.5h9.5a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.7-1A4.3 4.3 0 0 0 7 18.5z" /></S>,
  external: () => <S><path d="M13.5 4.5H19.5V10.5" /><path d="M19.5 4.5 11 13" /><path d="M18 14v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h4.5" /></S>,
  worker: () => <S><circle cx="12" cy="12" r="3" /><path d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.4 5.6 16.7 7.3M7.3 16.7l-1.7 1.7M18.4 18.4l-1.7-1.7M7.3 7.3 5.6 5.6" /></S>,
  analytics: () => <S><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></S>,
  ml: () => <S><circle cx="6" cy="8" r="2.2" /><circle cx="6" cy="16" r="2.2" /><circle cx="13" cy="12" r="2.2" /><circle cx="20" cy="12" r="2.2" /><path d="M8.1 9.1 11 11M8.1 14.9 11 13M15.2 12h2.6" /></S>,
  email: () => <S><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.6 6.4 8.4 6 8.4-6" /></S>,
  payment: () => <S><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19M6 14.6h3" /></S>,
  file: () => <S><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></S>,
  lock: () => <S><rect x="4.5" y="10" width="15" height="10.5" rx="2" /><path d="M8 10V7.5a4 4 0 0 1 8 0V10" /></S>,
  network: () => <S><circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /><path d="M10.6 6.8 6.4 17M13.4 6.8 17.6 17M7.2 19h9.6" /></S>,
  cdn: () => <S><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.6 2.4 14.4 0 17M12 3.5c-2.4 2.6-2.4 14.4 0 17" /></S>,
  scheduler: () => <S><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.2l3.4 2" /></S>,
  search: () => <S><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" /></S>,
  admin: () => <S><rect x="3.5" y="4" width="17" height="13" rx="2" /><path d="M8.5 21h7M12 17v4M7.5 8.5h9M7.5 12h5" /></S>,
};

/** Category tint — nodes without an explicit colour inherit their glyph's family. */
export const ICON_COLOR = {
  service: 'var(--blue)', api: 'var(--blue)', gateway: 'var(--blue)',
  database: 'var(--green)', cache: 'var(--green)', storage: 'var(--green)', queue: 'var(--green)',
  auth: 'var(--purple)', lock: 'var(--purple)',
  user: 'var(--accent)', browser: 'var(--accent)', mobile: 'var(--accent)',
  external: 'var(--red)', cloud: 'var(--red)', network: 'var(--red)', cdn: 'var(--red)',
  server: 'var(--blue)', worker: 'var(--yellow)', scheduler: 'var(--yellow)',
  analytics: 'var(--yellow)', ml: 'var(--yellow)', search: 'var(--yellow)',
  email: 'var(--purple)', payment: 'var(--purple)', file: 'var(--text-dim)', admin: 'var(--text-dim)',
};

/** Best-effort glyph for a name the model invented, so an unknown icon still looks
 * deliberate instead of falling back to a generic box. */
export function resolveIcon(name = '') {
  const n = String(name).toLowerCase();
  if (GLYPHS[n]) return n;
  const guess = [
    [/postgres|mysql|mongo|sql|db|datastore|rds/, 'database'],
    [/redis|memcach|cache/, 'cache'],
    [/s3|blob|bucket|object|storage/, 'storage'],
    [/kafka|rabbit|sqs|queue|topic|broker|stream/, 'queue'],
    [/auth|oauth|oidc|saml|identity|iam|login|jwt/, 'auth'],
    [/user|customer|actor|person|client|admin/, 'user'],
    [/web|spa|react|frontend|ui|portal|browser/, 'browser'],
    [/mobile|ios|android|app/, 'mobile'],
    [/gateway|proxy|ingress|load.?balanc|nginx/, 'gateway'],
    [/lambda|function|worker|job|consumer/, 'worker'],
    [/cron|schedul|timer/, 'scheduler'],
    [/mail|email|smtp|notification|sms/, 'email'],
    [/pay|stripe|billing|invoice|checkout/, 'payment'],
    [/analytic|report|metric|dashboard|bi/, 'analytics'],
    [/ml|ai|model|inference|llm|recommend/, 'ml'],
    [/search|elastic|solr|index/, 'search'],
    [/cdn|edge/, 'cdn'],
    [/3rd|third.?party|external|partner|vendor|api/, 'external'],
    [/cloud|saas/, 'cloud'],
    [/server|backend|service|micro/, 'server'],
  ].find(([re]) => re.test(n));
  return guess ? guess[1] : 'service';
}

export default function DiagramIcon({ name, size = 18, color }) {
  const key = resolveIcon(name);
  const Glyph = GLYPHS[key] ?? GLYPHS.service;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ color: color ?? ICON_COLOR[key] ?? 'var(--blue)' }}>
      <Glyph />
    </svg>
  );
}
