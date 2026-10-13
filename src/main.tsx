import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App.tsx';
import { createQueryClient, refreshRecordQueries } from './api/queries.ts';
import { AudioEngine } from './game/audio/AudioEngine.ts';
import { installAudioTestHooks } from './game/audio/testHooks.ts';
import { MockApiStatusStore } from './mocks/status.ts';
import { withReadableStorage } from './mocks/storageFallback.ts';
import { browserStorage } from './storage/localStore.ts';
import './index.css';
import './app/menu.css';

const queryClient = createQueryClient();
const mockApi = new MockApiStatusStore({ state: 'unavailable' });
/** The app's single audio engine; it stays silent until the Play button unlocks it. */
const audio = new AudioEngine({
  storage: browserStorage(),
  record: import.meta.env.MODE === 'e2e',
});
installAudioTestHooks(audio);

function render() {
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element #root not found');

  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App mockApi={mockApi} audio={audio} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The mock API must be ready before the first request. A failure only affects ranking and
// history, so the game still renders.
withReadableStorage(() => import('./mocks/browser.ts'))
  .then(({ startMockApi }) => startMockApi(mockApi, () => refreshRecordQueries(queryClient)))
  .catch((error: unknown) => {
    console.warn('Mock API unavailable; ranking and history are offline.', error);
    mockApi.set({ state: 'unavailable' });
  })
  .then(render);
