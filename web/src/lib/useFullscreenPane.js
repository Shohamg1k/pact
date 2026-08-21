import { useEffect, useState } from 'react';

// A CSS-only "fullscreen" (fixed overlay covering the viewport), not the browser
// Fullscreen API — the diagrams live inside an iframe-free but still deeply nested pane
// stack, and requestFullscreen()'s permission/user-gesture quirks (and the fact that it
// exits itself on unrelated DOM changes in some browsers) make a plain overlay far more
// predictable for something you want to toggle mid-demo without surprises.
export function useFullscreenPane() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  return [fullscreen, setFullscreen];
}
