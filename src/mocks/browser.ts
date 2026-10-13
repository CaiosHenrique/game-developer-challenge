import { delay, http, HttpResponse } from 'msw';
import { setupWorker, type SetupWorker } from 'msw/browser';
import { http as apiClient } from '../api/http.ts';
import { browserStorage } from '../storage/localStore.ts';
import { MOCK_DB_KEY, MockDb } from './db.ts';
import { createHandlers } from './handlers.ts';
import {
  apiSeedFromQuery,
  initialScenario,
  SCENARIO_KEY,
  saveScenario,
  savedScenario,
} from './scenarioChoice.ts';
import { DEFAULT_SCENARIO, type ScenarioId } from './scenarios.ts';
import type { MockApiControls, MockApiStatusStore } from './status.ts';

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
 * ranking and match-history APIs only exist as MSW mocks. Its status (persistence, network
 * scenario) and controls are published to `status` for the menu.
 *
 * Tabs share the stored data and scenario: when another tab changes them (a new scenario, a
 * reset, a registered match), this tab follows and `onDataChanged` refreshes what it shows.
 */
export async function startMockApi(
  status: MockApiStatusStore,
  onDataChanged: () => void,
): Promise<void> {
  const storage = browserStorage();
  const db = new MockDb(storage);
  let scenario: ScenarioId = initialScenario(window.location.search, storage);
  const worker = setupWorker(
    ...createHandlers(db, {
      current: () => scenario,
      seed: apiSeedFromQuery(window.location.search),
    }),
  );
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: import.meta.env.PROD,
  });
  if (import.meta.env.MODE === 'e2e') {
    window.__pirateMocks = { worker, db, http, HttpResponse, delay };
    // Test-only: `?apiTimeout=<ms>` shortens the client timeout so timeouts are quick to test.
    const timeout = new URLSearchParams(window.location.search).get('apiTimeout');
    if (timeout !== null && /^\d+$/.test(timeout)) apiClient.defaults.timeout = Number(timeout);
  }

  const controls: MockApiControls = {
    setScenario: (next) => {
      scenario = next;
      saveScenario(next, storage);
      publish();
    },
    reset: () => {
      db.reset();
      controls.setScenario(DEFAULT_SCENARIO);
    },
  };
  const publish = () =>
    status.set({ state: 'running', persistence: db.persistence, scenario, controls });
  publish();
  db.onPersistenceChange(publish);

  window.addEventListener('storage', (event) => {
    const everything = event.key === null; // storage cleared
    if (event.key === SCENARIO_KEY || everything) {
      const saved = savedScenario(storage) ?? DEFAULT_SCENARIO;
      if (saved !== scenario) {
        scenario = saved;
        publish();
      }
    }
    if (event.key === SCENARIO_KEY || event.key === MOCK_DB_KEY || everything) onDataChanged();
  });
}
