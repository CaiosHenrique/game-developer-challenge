import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.ts';

export const worker = setupWorker(...handlers);

/**
 * Starts the mock API. It runs in every build (including production), because the
 * ranking and match-history APIs only exist as MSW mocks.
 */
export async function startMockApi(): Promise<void> {
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: import.meta.env.PROD,
  });
}
