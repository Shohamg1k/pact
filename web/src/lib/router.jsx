import React, { createContext, useContext, useEffect, useState } from 'react';

// A minimal pushState router — no new dependency (PRD §5: hand-rolled, no component
// library to fight). The app only has a handful of routes (home, one chat, a few stub
// pages), so a real routing library would be more machinery than the surface needs.
const RouteContext = createContext({ path: '/', navigate: () => {} });

export function navigate(path) {
  if (path !== window.location.pathname) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return <RouteContext.Provider value={{ path, navigate }}>{children}</RouteContext.Provider>;
}

export function useRoute() {
  return useContext(RouteContext);
}

/** Matches "/chat/:id" style patterns against the current path. Returns params or null. */
export function matchRoute(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    else if (patternParts[i] !== pathParts[i]) return null;
  }
  return params;
}
