import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Monaco, bundled from the local package rather than fetched from a CDN —
// @monaco-editor/react loads from jsDelivr by default, and PACT is meant to run offline
// except for model calls.
//
// Workers are NOT optional: returning null from getWorker makes Monaco call .postMessage
// on null during construction, which throws and leaves a 5x5 stub with no content. They
// are constructed with Vite's native `new Worker(new URL(...))` form rather than the
// `?worker` suffix, because the suffix import is rewritten by dependency pre-bundling and
// loses its default export.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    const url =
      label === 'json'
        ? new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url)
        : label === 'typescript' || label === 'javascript'
          ? new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url)
          : new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url);
    return new Worker(url, { type: 'module' });
  },
};
loader.config({ monaco });

const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', java: 'java', json: 'json', jsonl: 'json', md: 'markdown',
  yaml: 'yaml', yml: 'yaml', css: 'css', html: 'html', xml: 'xml',
  sql: 'sql', sh: 'shell', txt: 'plaintext',
};

export function languageForPath(p = '') {
  return EXT_LANG[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'plaintext';
}

function defineTheme(m) {
  m.editor.defineTheme('pact', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6d6660', fontStyle: 'italic' },
      { token: 'string', foreground: 'c9a26d' },
      { token: 'keyword', foreground: 'c58fbe' },
      { token: 'number', foreground: '7fb069' },
      { token: 'type', foreground: '6ba3d6' },
    ],
    colors: {
      'editor.background': '#171514',
      'editor.foreground': '#ddd8d3',
      'editorLineNumber.foreground': '#4e4844',
      'editorLineNumber.activeForeground': '#9a938c',
      'editor.selectionBackground': '#3a3431',
      'editor.lineHighlightBackground': '#1e1c1a',
      'editorGutter.background': '#171514',
      'editorWidget.background': '#221f1e',
      'editorIndentGuide.background1': '#2a2725',

    },
  });
}

/**
 * Read-only by default: these are generated artifacts, and an edit that silently
 * diverged from what the gates verified would undermine the provenance story. Pass
 * onChange to make it editable.
 */
export default function CodeEditor({ value, path, language, onChange, readOnly = !onChange }) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  // Monaco pins itself to 5x5 when it measures an unsized container at construction, and
  // neither automaticLayout nor a post-mount layout() call recovered it here. Measuring
  // the host ourselves and handing Monaco a concrete pixel height sidesteps the race
  // entirely, and the observer keeps it correct while panes are dragged.
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const r = host.getBoundingClientRect();
      setSize((prev) => (Math.abs(prev.h - r.height) < 1 && Math.abs(prev.w - r.width) < 1 ? prev : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (editorRef.current && size.h > 0) editorRef.current.layout({ width: size.w, height: size.h });
  }, [size]);

  const onMount = useCallback((editor) => {
    editorRef.current = editor;
    const r = hostRef.current?.getBoundingClientRect();
    if (r?.height) editor.layout({ width: r.width, height: r.height });
  }, []);

  return (
    <div ref={hostRef} style={{ height: '100%', width: '100%', minHeight: 0, overflow: 'hidden' }}>
      {size.h > 0 && (
        <Editor
          onMount={onMount}
          height={size.h}
          width={size.w}
          theme="pact"
          language={language ?? languageForPath(path)}
          value={value ?? ''}
          onChange={onChange}
          beforeMount={defineTheme}
          loading={<div className="empty-state" style={{ padding: 18 }}>Loading editor…</div>}
          options={{
            readOnly,
            domReadOnly: readOnly,
            fontSize: 12,
            lineHeight: 19,
            fontFamily: "'JetBrains Mono','SF Mono',Consolas,monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            smoothScrolling: true,
            padding: { top: 10, bottom: 10 },
            tabSize: 2,
            wordWrap: 'off',
            scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
            overviewRulerLanes: 0,
            stickyScroll: { enabled: false },
          }}
        />
      )}
    </div>
  );
}
