import React, { useMemo, useRef, useState } from 'react';
import { markdownToHtml } from '../lib/markdown.js';
import { Metric, EmptyAgent } from './Inspector.jsx';

// Documentation rendered as a document: a contents rail built from the headings, a
// readable measure, and word counts — rather than one unbroken wall of markdown. A spec
// nobody can navigate doesn't get read.

function headings(md = '') {
  return md
    .split(/\r?\n/)
    .map((line, i) => {
      const m = line.match(/^(#{1,3})\s+(.*)$/);
      return m ? { level: m[1].length, text: m[2].trim(), key: `h-${i}` } : null;
    })
    .filter(Boolean);
}

/** Give each heading a stable id so the contents rail can scroll to it. */
function withAnchors(html, hs) {
  let i = 0;
  return html.replace(/<h([123])>/g, (full, lvl) => {
    const h = hs[i];
    i += 1;
    return h ? `<h${lvl} id="${h.key}">` : full;
  });
}

const DOCS = [
  { id: 'technical_spec', label: 'Technical specification', audience: 'For an engineer joining the project' },
  { id: 'user_guide', label: 'User guide', audience: 'For the person using the product' },
];

export default function DocsViewer({ artifact }) {
  const [tab, setTab] = useState('technical_spec');
  const bodyRef = useRef(null);

  const doc = useMemo(() => {
    if (!artifact) return null;
    const md = artifact[tab] ?? '';
    const hs = headings(md);
    return {
      md,
      hs,
      html: withAnchors(markdownToHtml(md), hs),
      words: md.trim() ? md.trim().split(/\s+/).length : 0,
    };
  }, [artifact, tab]);

  if (!artifact) return <EmptyAgent role="Documentation" />;

  const meta = DOCS.find((d) => d.id === tab);

  return (
    <div className="insp">
      <div className="insp-toolbar">
        <div className="tab-row" style={{ margin: 0 }}>
          {DOCS.map((d) => (
            <button key={d.id} className={tab === d.id ? 'active' : ''} onClick={() => setTab(d.id)}>{d.label}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <Metric value={doc.words.toLocaleString()} label="words" />
        <Metric value={doc.hs.length} label="sections" />
      </div>

      <div className="insp-body">
        <div className="insp-main doc-scroll" ref={bodyRef}>
          <div className="doc-page">
            <div className="doc-audience">{meta?.audience}</div>
            {doc.words === 0 ? (
              <div className="empty-state">This document is empty.</div>
            ) : (
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: doc.html }} />
            )}
          </div>
        </div>

        {doc.hs.length > 1 && (
          <aside className="insp-detail doc-toc">
            <div className="section-title" style={{ marginTop: 0 }}>Contents</div>
            {doc.hs.map((h) => (
              <button
                key={h.key}
                className={`toc-item lvl-${h.level}`}
                onClick={() => bodyRef.current?.querySelector(`#${h.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                {h.text}
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
