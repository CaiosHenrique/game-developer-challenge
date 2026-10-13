// Audio engine state and lifecycle with a fake Web Audio context, run in Node:
// `npm run test:unit`. No sound device is used.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_STORAGE_KEY,
  AudioEngine,
  type AudioContextLike,
  type SourceLike,
} from './AudioEngine.ts';
import { SOUND_IDS } from './soundMap.ts';

class FakeSource implements SourceLike {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  disconnect(): void {}
  /** The sound reaches its end on its own. */
  finish(): void {
    this.onended?.();
  }
}

class FakeContext implements AudioContextLike {
  state = 'suspended';
  destination = {};
  resumes = 0;
  readonly sources: FakeSource[] = [];
  constructor(private readonly decodeFails = false) {}
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    return this.decodeFails ? Promise.reject(new Error('bad data')) : Promise.resolve({ data });
  }
  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

/** An engine over a fake context; `loaded` resolves once every sound is loaded (or failed). */
async function readyEngine(options: { storage?: Storage | null; decodeFails?: boolean } = {}) {
  const context = new FakeContext(options.decodeFails);
  let created = 0;
  const engine = new AudioEngine({
    storage: options.storage ?? null,
    createContext: () => {
      created += 1;
      return context;
    },
    fetchBytes: () => Promise.resolve(new ArrayBuffer(8)),
    record: true,
  });
  engine.unlock();
  while (engine.status === 'loading') await new Promise((resolve) => setImmediate(resolve));
  return { engine, context, created: () => created };
}

test('nothing is created or played before the user gesture unlocks the audio', () => {
  let created = 0;
  const engine = new AudioEngine({
    createContext: () => (created++, new FakeContext()),
    record: true,
  });
  engine.play(['game_start', 'cannon_fire_1']);
  assert.equal(created, 0);
  assert.equal(engine.status, 'locked');
  assert.deepEqual(
    engine.records.map((record) => record.status),
    ['locked', 'locked'],
  );
});

test('unlock creates one context, resumes it and loads every sound in the background', async () => {
  const { engine, context, created } = await readyEngine();
  assert.equal(created(), 1);
  assert.equal(context.resumes, 1);
  assert.equal(engine.status, 'ready');
  assert.equal(engine.loadedSounds, SOUND_IDS.length);
  engine.unlock(); // a second Play: same context, nothing reloaded
  assert.equal(created(), 1);
  assert.equal(engine.loadedSounds, SOUND_IDS.length);
});

test('a sound requested before it is loaded is skipped, never played late', () => {
  const engine = new AudioEngine({
    createContext: () => new FakeContext(),
    fetchBytes: () => new Promise(() => {}), // never arrives
    record: true,
  });
  engine.unlock();
  engine.play(['game_start']);
  assert.equal(engine.records[0]!.status, 'not-loaded');
  assert.equal(engine.activeSources, 0);
});

test('plays a loaded sound and forgets it when it ends', async () => {
  const { engine, context } = await readyEngine();
  engine.play(['cannon_fire_1']);
  assert.equal(engine.records.at(-1)!.status, 'played');
  assert.equal(context.sources[0]!.started, true);
  assert.equal(engine.activeSources, 1);
  context.sources[0]!.finish();
  assert.equal(engine.activeSources, 0);
});

test('limits the same sound to two at once and all sounds to eight', async () => {
  const { engine } = await readyEngine();
  engine.play(['cannon_fire_1', 'cannon_fire_1', 'cannon_fire_1']);
  assert.deepEqual(
    engine.records.map((record) => record.status),
    ['played', 'played', 'limited'],
  );
  engine.play([
    'cannon_fire_2',
    'cannon_fire_2',
    'cannon_fire_3',
    'cannon_fire_3',
    'ship_collision',
    'ship_collision',
    'game_start',
  ]);
  assert.equal(engine.activeSources, 8);
  assert.equal(engine.records.at(-1)!.status, 'limited');
});

test('mute stops what plays now, blocks new sounds, is saved, and replays nothing later', async () => {
  const storage = memoryStorage();
  const { engine, context } = await readyEngine({ storage });
  engine.play(['ship_explosion_1']);
  let notified = 0;
  engine.subscribe(() => (notified += 1));

  engine.setMuted(true);
  assert.equal(context.sources[0]!.stopped, true);
  assert.equal(engine.activeSources, 0);
  assert.equal(notified, 1);
  assert.deepEqual(JSON.parse(storage.getItem(AUDIO_STORAGE_KEY)!), { muted: true });

  engine.play(['score_point']);
  assert.equal(engine.records.at(-1)!.status, 'muted');
  engine.setMuted(false);
  assert.equal(engine.activeSources, 0); // nothing muted is played back
  engine.play(['score_point']);
  assert.equal(engine.records.at(-1)!.status, 'played');
});

test('the saved preference is read; missing, invalid or blocked storage means sound on', () => {
  const muted = (storage: Storage | null) => new AudioEngine({ storage }).isMuted();
  assert.equal(muted(memoryStorage({ [AUDIO_STORAGE_KEY]: '{"muted":true}' })), true);
  assert.equal(muted(memoryStorage({ [AUDIO_STORAGE_KEY]: '{"muted":false}' })), false);
  assert.equal(muted(memoryStorage()), false);
  assert.equal(muted(memoryStorage({ [AUDIO_STORAGE_KEY]: '{not json' })), false);
  assert.equal(muted(memoryStorage({ [AUDIO_STORAGE_KEY]: '{"muted":"yes"}' })), false);
  assert.equal(muted(null), false);
  const blocked = memoryStorage();
  blocked.getItem = () => {
    throw new Error('blocked');
  };
  blocked.setItem = () => {
    throw new Error('blocked');
  };
  const engine = new AudioEngine({ storage: blocked });
  assert.equal(engine.isMuted(), false);
  engine.setMuted(true); // not saved, but effective for this page load
  assert.equal(engine.isMuted(), true);
});

test('paused: what plays stops, only the pause cue sounds; resuming lets sounds through', async () => {
  const { engine, context } = await readyEngine();
  engine.play(['cannon_broadside']);
  engine.setPaused(true);
  assert.equal(context.sources[0]!.stopped, true);
  engine.play(['game_pause', 'cannon_fire_1']);
  assert.deepEqual(
    engine.records.slice(-2).map((record) => record.status),
    ['played', 'paused'],
  );
  engine.setPaused(false);
  engine.play(['game_resume']);
  assert.equal(engine.records.at(-1)!.status, 'played');
});

test('stopAll silences every source and detaches its end callback', async () => {
  const { engine, context } = await readyEngine();
  engine.play(['cannon_fire_1', 'ship_wood_hit_1']);
  engine.stopAll();
  assert.equal(engine.activeSources, 0);
  for (const source of context.sources) {
    assert.equal(source.stopped, true);
    assert.equal(source.onended, null);
  }
});

test('no Web Audio, a throwing context or undecodable files: silent, never an error', async () => {
  const none = new AudioEngine({ createContext: () => null, record: true });
  none.unlock();
  none.play(['game_start']);
  assert.equal(none.status, 'unavailable');
  assert.equal(none.records[0]!.status, 'unavailable');

  const throwing = new AudioEngine({
    createContext: () => {
      throw new Error('not allowed');
    },
  });
  assert.doesNotThrow(() => throwing.unlock());
  assert.equal(throwing.status, 'unavailable');

  const { engine } = await readyEngine({ decodeFails: true });
  assert.equal(engine.status, 'ready');
  assert.equal(engine.loadedSounds, 0);
  engine.play(['game_over']);
  assert.equal(engine.records.at(-1)!.status, 'not-loaded');
});

test('a refused resume is swallowed', () => {
  const context = new FakeContext();
  context.resume = () => Promise.reject(new Error('refused'));
  const engine = new AudioEngine({
    createContext: () => context,
    fetchBytes: () => new Promise(() => {}),
  });
  assert.doesNotThrow(() => engine.unlock());
});
