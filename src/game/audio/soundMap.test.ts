// Sound rules of a match, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SimEvent } from '../sim/simulation.ts';
import { PLAYER_ID } from '../sim/weapons.ts';
import { INITIAL_SOUND_CURSOR, soundsFor, type SoundCursor, type SoundHud } from './soundMap.ts';

const FRONT_COUNT = 1;
const hud: SoundHud = {
  hp: 150,
  maxHp: 150,
  score: 0,
  remainingSeconds: 100,
  phase: 'running',
  paused: false,
};
const at = (changes: Partial<SoundHud>): SoundHud => ({ ...hud, ...changes });

const muzzle = { x: 0, y: 0 };
const frontShot = (ownerId = PLAYER_ID): SimEvent => ({
  type: 'shot',
  ownerId,
  muzzles: [muzzle],
  heading: 0,
});
const broadside: SimEvent = {
  type: 'shot',
  ownerId: PLAYER_ID,
  muzzles: [muzzle, muzzle, muzzle],
  heading: 0,
};
const hit = (targetId: number, x = 10, y = 20): SimEvent => ({
  type: 'shipHit',
  targetId,
  x,
  y,
  damage: 25,
});
const destroyed = (cause: 'playerFire' | 'ramming', x = 10, y = 20): SimEvent => ({
  type: 'shipDestroyed',
  id: 3,
  kind: 'chaser',
  x,
  y,
  heading: 0,
  cause,
});
const removed = (
  reason: 'island' | 'outOfBounds' | 'expired' | 'ship' | 'ownerDestroyed',
): SimEvent => ({
  type: 'projectileRemoved',
  id: 1,
  x: 0,
  y: 0,
  reason,
});

/** Sounds of one update with unchanged HUD values. */
function sounds(events: SimEvent[], cursor: SoundCursor = INITIAL_SOUND_CURSOR) {
  return soundsFor(events, hud, hud, cursor, FRONT_COUNT);
}

test('the match starts with game_start, and nothing else', () => {
  assert.deepEqual(soundsFor([], null, hud, INITIAL_SOUND_CURSOR, FRONT_COUNT).sounds, [
    'game_start',
  ]);
});

test('front shots rotate through the three cannon sounds; a shooter shot is a cannon shot', () => {
  let cursor = INITIAL_SOUND_CURSOR;
  const heard: string[] = [];
  for (const shot of [frontShot(), frontShot(), frontShot(7), frontShot()]) {
    const result = sounds([shot], cursor);
    heard.push(...result.sounds);
    cursor = result.cursor;
  }
  assert.deepEqual(heard, ['cannon_fire_1', 'cannon_fire_2', 'cannon_fire_3', 'cannon_fire_1']);
});

test('a broadside is one broadside sound, not a cannon shot', () => {
  const result = sounds([broadside]);
  assert.deepEqual(result.sounds, ['cannon_broadside']);
  assert.equal(result.cursor.frontFire, 0);
});

test('hits on ships alternate the two wood sounds, one per update however many balls hit', () => {
  const first = sounds([hit(3), hit(3), hit(4)]);
  assert.deepEqual(first.sounds, ['ship_wood_hit_1']);
  assert.deepEqual(sounds([hit(PLAYER_ID)], first.cursor).sounds, ['ship_wood_hit_2']);
});

test('only balls ending in the water splash; islands, the arena edge and owners do not', () => {
  assert.deepEqual(sounds([removed('expired')]).sounds, ['cannonball_water_hit_1']);
  for (const reason of ['island', 'outOfBounds', 'ownerDestroyed', 'ship'] as const) {
    assert.deepEqual(sounds([removed(reason)]).sounds, [], reason);
  }
});

test('a ship sunk by the player explodes, alternating the two explosions', () => {
  const first = sounds([destroyed('playerFire')]);
  assert.deepEqual(first.sounds, ['ship_explosion_1']);
  assert.deepEqual(sounds([destroyed('playerFire')], first.cursor).sounds, ['ship_explosion_2']);
});

test('a ram is a single collision sound: no wood hit, no explosion', () => {
  const result = sounds([hit(PLAYER_ID, 50, 60), destroyed('ramming', 50, 60)]);
  assert.deepEqual(result.sounds, ['ship_collision']);
  // A hit elsewhere in the same update still sounds.
  assert.deepEqual(
    sounds([hit(PLAYER_ID, 50, 60), destroyed('ramming', 50, 60), hit(4, 1, 2)]).sounds,
    ['ship_wood_hit_1', 'ship_collision'],
  );
});

test('the end replaces every other sound: time up completes, a sinking is game over', () => {
  const timeUp: SimEvent = { type: 'matchEnded', reason: 'time', x: 0, y: 0, heading: 0 };
  const sunk: SimEvent = { type: 'matchEnded', reason: 'death', x: 0, y: 0, heading: 0 };
  assert.deepEqual(sounds([frontShot(), hit(4), timeUp]).sounds, ['game_complete']);
  assert.deepEqual(sounds([hit(PLAYER_ID), sunk]).sounds, ['game_over']);
});

test('nothing sounds once the match has ended', () => {
  const ended = at({ phase: 'ended' });
  assert.deepEqual(
    soundsFor([frontShot(), hit(4)], ended, ended, INITIAL_SOUND_CURSOR, FRONT_COUNT).sounds,
    [],
  );
});

test('pause and resume sound on the change only', () => {
  const pause = (from: boolean, to: boolean) =>
    soundsFor([], at({ paused: from }), at({ paused: to }), INITIAL_SOUND_CURSOR, FRONT_COUNT)
      .sounds;
  assert.deepEqual(pause(false, true), ['game_pause']);
  assert.deepEqual(pause(true, false), ['game_resume']);
  assert.deepEqual(pause(true, true), []);
});

test('low health sounds once, when health crosses a quarter, never again in the match', () => {
  const first = soundsFor([], at({ hp: 40 }), at({ hp: 37 }), INITIAL_SOUND_CURSOR, FRONT_COUNT);
  assert.deepEqual(first.sounds, ['health_low']);
  assert.equal(first.cursor.lowHealthPlayed, true);
  // Still low, then lower: nothing more.
  assert.deepEqual(
    soundsFor([], at({ hp: 37 }), at({ hp: 30 }), first.cursor, FRONT_COUNT).sounds,
    [],
  );
  assert.deepEqual(
    soundsFor([], at({ hp: 60 }), at({ hp: 20 }), first.cursor, FRONT_COUNT).sounds,
    [],
  );
  // A match that starts low does not sound until it crosses the threshold.
  assert.deepEqual(
    soundsFor([], at({ hp: 15 }), at({ hp: 15 }), INITIAL_SOUND_CURSOR, FRONT_COUNT).sounds,
    [],
  );
  // A sinking ship (health 0) is the end of the match, not low health.
  assert.deepEqual(
    soundsFor([], at({ hp: 40 }), at({ hp: 0 }), INITIAL_SOUND_CURSOR, FRONT_COUNT).sounds,
    [],
  );
});

test('time warnings sound when crossing 30 s and 10 s, not on every second', () => {
  const tick = (from: number, to: number) =>
    soundsFor(
      [],
      at({ remainingSeconds: from }),
      at({ remainingSeconds: to }),
      INITIAL_SOUND_CURSOR,
      FRONT_COUNT,
    ).sounds;
  assert.deepEqual(tick(31, 30), ['time_warning']);
  assert.deepEqual(tick(11, 10), ['time_warning']);
  for (let seconds = 100; seconds > 31; seconds -= 1)
    assert.deepEqual(tick(seconds, seconds - 1), []);
  assert.deepEqual(tick(30, 29), []);
  assert.deepEqual(tick(10, 9), []);
});

test('each new point sounds, with the explosion of the ship that gave it', () => {
  assert.deepEqual(
    soundsFor(
      [destroyed('playerFire')],
      at({ score: 2 }),
      at({ score: 3 }),
      INITIAL_SOUND_CURSOR,
      FRONT_COUNT,
    ).sounds,
    ['ship_explosion_1', 'score_point'],
  );
});

test('an update without events or HUD changes is silent', () => {
  assert.deepEqual(sounds([]).sounds, []);
});
