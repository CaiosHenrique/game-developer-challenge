import type { MockPersistence } from './db.ts';

/** Whether the mock API started, and where it keeps its data. */
export type MockApiStatus =
  { state: 'running'; persistence: MockPersistence } | { state: 'unavailable' };

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
