import React, { useEffect, useRef, useState } from 'react';

// Small in-app dialogs, replacing window.prompt/confirm. Those are blockable, unstyled,
// and on some setups silently return null — which made "New project" look broken. These
// also let a destructive action say exactly what it will and won't destroy.

function Shell({ title, children, onCancel }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({ title, sub, placeholder, confirmLabel = 'Create', onCancel, onConfirm }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = (e) => {
    e?.preventDefault();
    if (value.trim()) onConfirm(value.trim());
  };
  return (
    <Shell title={title} onCancel={onCancel}>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      <form onSubmit={submit}>
        <input ref={ref} type="text" value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </Shell>
  );
}

export function ConfirmDialog({ title, body, confirmLabel = 'Delete', danger = true, onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <Shell title={title} onCancel={onCancel}>
      <h2>{title}</h2>
      <p className="sub">{body}</p>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button ref={ref} className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Shell>
  );
}
