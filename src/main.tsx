import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { createQueryClient } from './api/queries.ts';
import type { MockApiStatus } from './mocks/status.ts';
import { withReadableStorage } from './mocks/storageFallback.ts';
import './index.css';
import './app/menu.css';

const queryClient = createQueryClient();

function render(mockApi: MockApiStatus) {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element #root not found');

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App mockApi={mockApi} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The mock API must be ready before the first request. A failure only affects ranking and
// history, so the game still renders.
withReadableStorage(() => import('./mocks/browser.ts'))
  .then(({ startMockApi }) => startMockApi())
  .then(({ persistence }): MockApiStatus => ({ state: 'running', persistence }))
  .catch((error: unknown): MockApiStatus => {
    console.warn('Mock API unavailable; ranking and history are offline.', error);
    return { state: 'unavailable' };
  })
  .then(render);
