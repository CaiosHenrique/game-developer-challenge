import type { AudioEngine, PlayRecord } from './AudioEngine.ts';

/**
 * Test instrumentation of the sound effects, compiled only into the e2e build
 * (`vite build --mode e2e`): the engine's state and the record of requested sounds.
 */
export type PirateAudioApi = {
  state(): { status: AudioEngine['status']; loaded: number; active: number; muted: boolean };
  records(): PlayRecord[];
  clearRecords(): void;
};

declare global {
  interface Window {
    __pirateAudio?: PirateAudioApi;
  }
}

export function installAudioTestHooks(engine: AudioEngine): void {
  if (import.meta.env.MODE !== 'e2e') return;
  window.__pirateAudio = {
    state: () => ({
      status: engine.status,
      loaded: engine.loadedSounds,
      active: engine.activeSources,
      muted: engine.isMuted(),
    }),
    records: () => engine.records.map((record) => ({ ...record })),
    clearRecords: () => {
      engine.records.length = 0;
    },
  };
}
