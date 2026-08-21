import React, { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import AdapterSettings from '../components/AdapterSettings.jsx';
import { useRoute, matchRoute } from '../lib/router.jsx';
import HomePage from '../pages/HomePage.jsx';
import ChatPage from '../pages/ChatPage.jsx';
import StubPage from '../pages/StubPage.jsx';

const STUBS = {
  '/settings': { title: 'Settings', description: 'Model ladder, adapter pin, theme.' },
  '/connectors': { title: 'Connectors', description: 'GitHub PR, Postman/OpenAPI, Miro, Slack — gated by inbox approval.' },
  '/skills': { title: 'Skills', description: 'Reusable playbooks for a chat.' },
  '/plugins': { title: 'Plugins', description: 'Third-party integrations.' },
  '/customize': { title: 'Customize', description: 'Appearance and defaults.' },
};

export default function AppShell() {
  const { path } = useRoute();
  const [showAdapters, setShowAdapters] = useState(false);
  const chatParams = matchRoute('/chat/:id', path);

  let page;
  if (path === '/') page = <HomePage />;
  else if (chatParams) page = <ChatPage chatId={chatParams.id} />;
  else if (STUBS[path]) page = <StubPage {...STUBS[path]} />;
  else page = <HomePage />;

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <div className="app-main">
        <header className="app-topbar">
          <span className="tagline">brief → validated contract → running product, any combination of 7 agents</span>
          <button className="btn small" onClick={() => setShowAdapters(true)}>
            Adapters
          </button>
        </header>
        <div className="app-content">{page}</div>
      </div>
      {showAdapters && <AdapterSettings onClose={() => setShowAdapters(false)} />}
    </div>
  );
}
