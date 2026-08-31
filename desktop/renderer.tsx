import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '../app/page';
import '../app/globals.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Não foi possível iniciar o Tage.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
