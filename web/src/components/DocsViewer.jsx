import React, { useState } from 'react';
import { markdownToHtml } from '../lib/markdown.js';

export default function DocsViewer({ artifact }) {
  const [tab, setTab] = useState('technical_spec');
  if (!artifact) return <div className="empty-state">docs hasn't run yet.</div>;
  const html = markdownToHtml(tab === 'technical_spec' ? artifact.technical_spec : artifact.user_guide);
  return (
    <div>
      <div className="tab-row">
        <button className={tab === 'technical_spec' ? 'active' : ''} onClick={() => setTab('technical_spec')}>
          Technical spec
        </button>
        <button className={tab === 'user_guide' ? 'active' : ''} onClick={() => setTab('user_guide')}>
          User guide
        </button>
      </div>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      {artifact.gaps?.length > 0 && <div className="gap-banner">{artifact.gaps.join(' · ')}</div>}
    </div>
  );
}
