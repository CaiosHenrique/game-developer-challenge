import type { MockPersistence } from './db.ts';

/** Whether the mock API started, and where it keeps its data. */
export type MockApiStatus =
  { state: 'running'; persistence: MockPersistence } | { state: 'unavailable' };
