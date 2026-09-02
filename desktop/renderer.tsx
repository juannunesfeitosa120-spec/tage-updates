import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '../app/page';
import '../app/globals.css';
import { useDesktopUpdates } from '../hooks/use-desktop-updates';
import { installUpdateGuard } from './update-guard.mjs';

if (window.taggiDesktop) {
  window.taggiUpdateGuard?.dispose();
  window.taggiUpdateGuard = installUpdateGuard(window);
}

function UpdateNotice() {
  const { updateState } = useDesktopUpdates();
  if (!['available', 'downloading', 'ready', 'installing'].includes(updateState.phase)) return null;
  return (
    <output aria-live="polite" className="surface-panel pointer-events-none fixed bottom-5 right-5 z-[100] max-w-sm px-5 py-4 text-sm shadow-xl">
      <span className="block font-semibold text-[var(--text-main)]">Atualização automática</span>
      <span className="mt-1 block text-[var(--text-soft)]">{updateState.message}</span>
    </output>
  );
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Não foi possível iniciar o Tage.');
}

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdateNotice />
  </StrictMode>,
);
