import type { MockPersistence } from './db.ts';
import type { ScenarioId } from './scenarios.ts';

/** What the menu can change in the running mock API. */
export type MockApiControls = {
  /** Answers the next requests with another network scenario (kept for the next loads). */
  setScenario: (scenario: ScenarioId) => void;
  /** Restores the fixtures and the normal scenario (nothing else on this device changes). */
  reset: () => void;
};

/** Whether the mock API started, where it keeps its data and how it answers. */
export type MockApiStatus =
  | {
      state: 'running';
      persistence: MockPersistence;
      scenario: ScenarioId;
      controls: MockApiControls;
    }
  | { state: 'unavailable' };

/** The mock API status, observable: it changes if storage stops accepting writes. */
export class MockApiStatusStore {
  private status: MockApiStatus;
  private readonly listeners = new Set<() => void>();

  constructor(initial: MockApiStatus) {
    this.status = initial;
  }

  readonly get = (): MockApiStatus => this.status;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(status: MockApiStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener();
  }
}
