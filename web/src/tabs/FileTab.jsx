import React, { useEffect, useState } from 'react';
import { getFile } from '../api.js';
import { markdownToHtml } from '../lib/markdown.js';

// One file from the generated project, opened from the file rail. Content comes from
// wherever that file actually lives: a module inside an already-loaded manifest, a real
// chat-root file on the server, or a typed artifact — the rail passes which, so this
// never has to guess.
export default function FileTab({ chatId, entry, artifacts }) {
  const [text, setText] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setText(null);
      let t = '';
      if (entry.kind === 'module') {
        const m = (artifacts[entry.role]?.modules ?? []).find((x) => x.path === entry.modulePath);
        t = m?.code ?? '(module not found in the current manifest)';
      } else if (entry.kind === 'inline') {
        t = entry.text;
      } else if (entry.kind === 'artifact') {
        t = JSON.stringify(artifacts[entry.role] ?? {}, null, 2);
      } else {
        t = (await getFile(chatId, entry.name)) ?? '(file not found on the server)';
      }
      if (!cancelled) setText(t);
    })();
    return () => { cancelled = true; };
  }, [chatId, entry, artifacts]);

  if (text === null) return <div className="pad"><div className="empty-state">Loading…</div></div>;

  const isMd = entry.name.endsWith('.md');
  return (
    <div className="pad">
      <div className="toolbar">
        <span className="badge mono">{entry.path}</span>
        <span className="badge">{text.split('\n').length} lines</span>
        {entry.implements?.length > 0 && (
          <span className="implements">
            {entry.implements.map((id) => <span key={id} className="chip">{id}</span>)}
          </span>
        )}
      </div>
      {isMd ? (
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />
      ) : (
        <pre className="code-block">{text}</pre>
      )}
    </div>
  );
}
