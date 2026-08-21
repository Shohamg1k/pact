import React from 'react';

// A real nav entry with a real page, just no invented backend behind it yet — honest
// about what exists rather than faking functionality (matches the rest of the app's
// "never hide a gap" convention, e.g. PreviewConsole's KNOWN GAP notice).
export default function StubPage({ title, description }) {
  return (
    <div className="stub-page">
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="gap-notice">Coming soon — not built yet.</div>
    </div>
  );
}
