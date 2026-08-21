import React from 'react';

// Inline stroke icons (VS Code / Codicon idiom). Kept as one small module so nothing
// pulls in an icon package — the app ships no runtime dependency beyond React.
const S = ({ children, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const IconExplorer = (p) => (
  <S {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>
);
export const IconAgents = (p) => (
  <S {...p}><circle cx="12" cy="6" r="2.6" /><circle cx="5.5" cy="17.5" r="2.6" /><circle cx="18.5" cy="17.5" r="2.6" /><path d="M10.4 8.2 7 15.2M13.6 8.2 17 15.2M8.1 17.5h7.8" /></S>
);
export const IconInbox = (p) => (
  <S {...p}><path d="M3 13h5l1.5 2.5h5L16 13h5" /><path d="M4.5 5.5h15L21 13v4.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V13z" /></S>
);
export const IconSettings = (p) => (
  <S {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" /></S>
);
export const IconFile = (p) => (
  <S {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></S>
);
export const IconDiagram = (p) => (
  <S {...p}><rect x="9" y="2.5" width="6" height="4.5" rx="1" /><rect x="2.5" y="17" width="6" height="4.5" rx="1" /><rect x="15.5" y="17" width="6" height="4.5" rx="1" /><path d="M12 7v5M5.5 17v-2.5h13V17" /></S>
);
export const IconServer = (p) => (
  <S {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></S>
);
export const IconBrowser = (p) => (
  <S {...p}><rect x="2.5" y="4" width="19" height="16" rx="2" /><path d="M2.5 9h19" /><path d="M6 6.5h.01M8.5 6.5h.01" /></S>
);
export const IconTerminal = (p) => (
  <S {...p}><rect x="2.5" y="4" width="19" height="16" rx="2" /><path d="M6.5 9.5 10 12.5l-3.5 3M12.5 15.5h5" /></S>
);
export const IconTrace = (p) => (
  <S {...p}><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="1.6" fill="currentColor" /><circle cx="15" cy="12" r="1.6" fill="currentColor" /><circle cx="11" cy="18" r="1.6" fill="currentColor" /></S>
);
export const IconBook = (p) => (
  <S {...p}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M8 3v18" /></S>
);
export const IconCheck = (p) => (
  <S {...p}><path d="M4.5 12.5 9.5 17.5 19.5 6.5" /></S>
);
export const IconPlus = (p) => (
  <S {...p}><path d="M12 5v14M5 12h14" /></S>
);
export const IconRefresh = (p) => (
  <S {...p}><path d="M20 11a8 8 0 1 0-.6 4" /><path d="M20 4.5V11h-6" /></S>
);

/** One icon per artifact role — used in tabs, the explorer tree, and the agent list. */
export const ROLE_ICON = {
  pm: IconBook,
  architect: IconDiagram,
  uiux: IconBrowser,
  backend: IconServer,
  frontend: IconBrowser,
  qa: IconCheck,
  docs: IconBook,
};
