import { SOUND_IDS, type SoundId } from './soundMap.ts';

/** Where the sound files are served (copied by scripts/prepare-assets.ts). */
export function soundUrl(id: SoundId): string {
  return `/game/sounds/${id}.wav`;
}

/** The part of the Web Audio API the engine uses (a fake can stand in for it in tests). */
export type AudioContextLike = {
  readonly state: string;
  readonly destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
};
export type GainLike = { gain: { value: number }; connect(destination: unknown): void };
export type SourceLike = {
  buffer: unknown;
  onended: (() => void) | null;
  connect(destination: unknown): void;
  start(): void;
  stop(): void;
  disconnect(): void;
};

/** What a match needs from the audio: play its sounds, silence them, hold them while paused. */
export type SoundOutput = {
  play(ids: readonly SoundId[]): void;
  stopAll(): void;
  setPaused(paused: boolean): void;
};

/** What happened to a requested sound (kept for the end-to-end tests). */
export type PlayStatus =
  'played' | 'locked' | 'unavailable' | 'muted' | 'paused' | 'not-loaded' | 'limited';
export type PlayRecord = { id: SoundId; status: PlayStatus };

/** Versioned like the other keys: `{ "muted": boolean }`. */
export const AUDIO_STORAGE_KEY = 'pirate-battle.audio.v1';
const MASTER_VOLUME = 0.6;
/** At most this many sounds at once, and this many of the same sound. */
const MAX_ACTIVE = 8;
const MAX_ACTIVE_PER_SOUND = 2;
const MAX_RECORDS = 500;

export type AudioEngineOptions = {
  storage?: Storage | null;
  /** Creates the audio context; null (or a throw) means audio is unavailable. */
  createContext?: () => AudioContextLike | null;
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
  /** Keep a record of every requested sound (end-to-end build only). */
  record?: boolean;
};

function defaultContext(): AudioContextLike | null {
  const Context =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? (new Context() as unknown as AudioContextLike) : null;
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

/** Saved preference; missing, unreadable or invalid means sound on. */
function readMuted(storage: Storage | null): boolean {
  try {
    const raw = storage?.getItem(AUDIO_STORAGE_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as unknown;
    return (
      typeof value === 'object' && value !== null && (value as { muted?: unknown }).muted === true
    );
  } catch {
    return false;
  }
}

/**
 * The game's sound effects, one instance for the whole app (created in main.tsx).
 *
 * - Nothing happens before `unlock()`, which the Play button calls from its click (browsers
 *   only let audio start after a user gesture). It creates the audio context once, then
 *   loads every sound in the background: a match never waits for them, and a sound that
 *   is not loaded yet is skipped (never played late).
 * - Every failure (no Web Audio, a file missing or not decodable, a refused resume, blocked
 *   storage) leaves the game silent but working, without console messages.
 * - Mute is saved on the device and stops what is playing at once; muted sounds are never
 *   played later. Paused: what is playing stops and only the pause cue itself can sound.
 */
export class AudioEngine implements SoundOutput {
  private context: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private state: 'locked' | 'loading' | 'ready' | 'unavailable' = 'locked';
  private readonly buffers = new Map<SoundId, unknown>();
  private readonly active = new Map<SourceLike, SoundId>();
  private paused = false;
  private muted: boolean;
  private readonly listeners = new Set<() => void>();
  private readonly storage: Storage | null;
  private readonly createContext: () => AudioContextLike | null;
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  private readonly recording: boolean;
  readonly records: PlayRecord[] = [];

  constructor(options: AudioEngineOptions = {}) {
    this.storage = options.storage ?? null;
    this.createContext = options.createContext ?? defaultContext;
    this.fetchBytes = options.fetchBytes ?? defaultFetch;
    this.recording = options.record ?? false;
    this.muted = readMuted(this.storage);
  }

  get status(): 'locked' | 'loading' | 'ready' | 'unavailable' {
    return this.state;
  }

  get loadedSounds(): number {
    return this.buffers.size;
  }

  get activeSources(): number {
    return this.active.size;
  }

  /**
   * Call from a user gesture (the Play button): creates the audio context the first time and
   * starts loading the sounds; later calls only resume a suspended context.
   */
  unlock(): void {
    if (this.state === 'unavailable') return;
    if (!this.context) {
      try {
        const context = this.createContext();
        if (!context) throw new Error('Web Audio unavailable');
        const master = context.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(context.destination);
        this.context = context;
        this.master = master;
      } catch {
        this.state = 'unavailable';
        return;
      }
      this.state = 'loading';
      void this.load(this.context);
    }
    if (this.context.state === 'suspended') {
      try {
        this.context.resume().catch(() => {});
      } catch {
        // A refused resume leaves the game silent.
      }
    }
  }

  play(ids: readonly SoundId[]): void {
    for (const id of ids) {
      const status = this.start(id);
      if (this.recording) {
        this.records.push({ id, status });
        if (this.records.length > MAX_RECORDS) this.records.shift();
      }
    }
  }

  /** Stops every sound now (end or exit of a match, mute, pause). */
  stopAll(): void {
    for (const source of this.active.keys()) {
      source.onended = null;
      try {
        source.stop();
        source.disconnect();
      } catch {
        // Already stopped.
      }
    }
    this.active.clear();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.stopAll();
  }

  readonly isMuted = (): boolean => this.muted;

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    if (muted) this.stopAll();
    try {
      this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ muted }));
    } catch {
      // Not saved (storage blocked or full): the choice holds for this page load.
    }
    this.listeners.forEach((listener) => listener());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private start(id: SoundId): PlayStatus {
    if (this.state === 'locked') return 'locked';
    const { context, master } = this;
    if (this.state === 'unavailable' || !context || !master) return 'unavailable';
    if (this.muted) return 'muted';
    if (this.paused && id !== 'game_pause') return 'paused';
    const buffer = this.buffers.get(id);
    if (buffer === undefined) return 'not-loaded';
    let same = 0;
    for (const playing of this.active.values()) if (playing === id) same += 1;
    if (this.active.size >= MAX_ACTIVE || same >= MAX_ACTIVE_PER_SOUND) return 'limited';
    try {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      source.onended = () => {
        this.active.delete(source);
        source.disconnect();
      };
      source.start();
      this.active.set(source, id);
      return 'played';
    } catch {
      return 'unavailable';
    }
  }

  private async load(context: AudioContextLike): Promise<void> {
    await Promise.all(
      SOUND_IDS.map(async (id) => {
        try {
          const bytes = await this.fetchBytes(soundUrl(id));
          this.buffers.set(id, await context.decodeAudioData(bytes));
        } catch {
          // This sound stays silent.
        }
      }),
    );
    this.state = 'ready';
  }
}
