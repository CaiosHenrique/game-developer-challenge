import { delay, http, HttpResponse } from 'msw';
import { setupWorker, type SetupWorker } from 'msw/browser';
import { browserStorage } from '../storage/localStore.ts';
import { MockDb, type MockPersistence } from './db.ts';
import { createHandlers } from './handlers.ts';

/** Test-only (e2e build): adds one-off handlers to the running mock API from Playwright. */
export type PirateMocksApi = {
  worker: SetupWorker;
  /** The mock API's data, e.g. to count records or commit one before a failure. */
  db: MockDb;
  http: typeof http;
  HttpResponse: typeof HttpResponse;
  delay: typeof delay;
};

declare global {
  interface Window {
    __pirateMocks?: PirateMocksApi;
  }
}

/**
 * Starts the mock API. It runs in every build (including production), because the
 * ranking and match-history APIs only exist as MSW mocks.
 */
export async function startMockApi(
  onPersistence: (persistence: MockPersistence) => void,
): Promise<void> {
  const db = new MockDb(browserStorage());
  const worker = setupWorker(...createHandlers(db));
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: import.meta.env.PROD,
  });
  if (import.meta.env.MODE === 'e2e') {
    window.__pirateMocks = { worker, db, http, HttpResponse, delay };
  }
  onPersistence(db.persistence);
  db.onPersistenceChange(onPersistence);
}
