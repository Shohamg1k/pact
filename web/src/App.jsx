import React from 'react';
import { RouterProvider } from './lib/router.jsx';
import AppShell from './shell/AppShell.jsx';

export default function App() {
  return (
    <RouterProvider>
      <AppShell />
    </RouterProvider>
  );
}
