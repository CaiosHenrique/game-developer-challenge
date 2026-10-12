import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

function render() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element #root not found');

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// The mock API must be ready before the first request. A failure only affects ranking and
// history, so the game still renders.
import('./mocks/browser.ts')
  .then(({ startMockApi }) => startMockApi())
  .catch((error: unknown) =>
    console.warn('Mock API unavailable; ranking and history are offline.', error),
  )
  .finally(render);
