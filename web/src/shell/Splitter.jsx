import React, { useCallback, useEffect, useRef } from 'react';

// A draggable divider between two panes. Reports a delta in pixels; the parent owns the
// widths so it can clamp them and persist them. Pointer capture means a fast drag that
// leaves the 5px hit area still tracks, and the body-wide cursor/no-select classes stop
// the drag from selecting text across the app.
export default function Splitter({ onDrag, onDoubleClick, ariaLabel }) {
  const startX = useRef(null);

  const move = useCallback(
    (e) => {
      if (startX.current === null) return;
      const dx = e.clientX - startX.current;
      startX.current = e.clientX;
      onDrag(dx);
    },
    [onDrag],
  );

  const end = useCallback(() => {
    startX.current = null;
    document.body.classList.remove('resizing');
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
  }, [move, end]);

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="Drag to resize · double-click to reset"
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        startX.current = e.clientX;
        document.body.classList.add('resizing');
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onKeyDown={(e) => {
        // Keyboard-resizable too — a divider you can only reach with a mouse is a
        // divider some users simply cannot move.
        if (e.key === 'ArrowLeft') onDrag(-16);
        if (e.key === 'ArrowRight') onDrag(16);
      }}
      tabIndex={0}
    />
  );
}
