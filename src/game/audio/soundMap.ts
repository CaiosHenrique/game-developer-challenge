import { LOW_HEALTH_FRACTION, TIME_WARNINGS } from '../announcements.ts';
import type { MatchPhase, SimEvent } from '../sim/simulation.ts';
import { PLAYER_ID } from '../sim/weapons.ts';

/**
 * Sound effects of a match, derived from the simulation's events and from changes of the HUD
 * state. Pure: no audio API, so the rules can be tested in Node. Each id is a file
 * `assets/sounds/<id>.wav`, copied as is to `public/game/sounds/` by scripts/prepare-assets.ts.
 */
export const SOUND_IDS = [
  'cannon_fire_1',
  'cannon_fire_2',
  'cannon_fire_3',
  'cannon_broadside',
  'ship_wood_hit_1',
  'ship_wood_hit_2',
  'ship_collision',
  'ship_explosion_1',
  'ship_explosion_2',
  'cannonball_water_hit_1',
  'cannonball_water_hit_2',
  'game_complete',
  'game_over',
  'game_pause',
  'game_resume',
  'health_low',
  'time_warning',
  'score_point',
  'game_start',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

const FRONT_FIRE = ['cannon_fire_1', 'cannon_fire_2', 'cannon_fire_3'] as const;
const WOOD_HIT = ['ship_wood_hit_1', 'ship_wood_hit_2'] as const;
const EXPLOSION = ['ship_explosion_1', 'ship_explosion_2'] as const;
const WATER_HIT = ['cannonball_water_hit_1', 'cannonball_water_hit_2'] as const;

/** The HUD values that sound cues are derived from. */
export type SoundHud = {
  hp: number;
  maxHp: number;
  score: number;
  remainingSeconds: number;
  phase: MatchPhase;
  paused: boolean;
};

/** What carries over between calls: the next variant of each sound family, low health heard. */
export type SoundCursor = {
  frontFire: number;
  woodHit: number;
  explosion: number;
  waterHit: number;
  lowHealthPlayed: boolean;
};

export const INITIAL_SOUND_CURSOR: SoundCursor = {
  frontFire: 0,
  woodHit: 0,
  explosion: 0,
  waterHit: 0,
  lowHealthPlayed: false,
};

/**
 * Sounds for one update of the match: the events of the steps just run, and the HUD state
 * before (`null` when the match starts) and after them. Each sound plays at most once per
 * update, whatever the number of events behind it (three broadside balls hitting together
 * make one hit sound).
 *
 * - Start: `game_start`. Nothing at all once the match has ended.
 * - The end of the match replaces every other sound of that update.
 * - A player shot with more balls than the front gun fires (`playerFrontCount`) is a
 *   broadside; any other shot, the player's front gun or a shooter's, is a cannon shot.
 * - A ram is one collision sound: neither the hit on the player nor the destroyed chaser
 *   (identified by the same position in the same update) adds its own sound.
 * - Balls ending in the water at the end of their range splash; balls stopped by an
 *   island, leaving the arena or removed with their owner do not.
 * - From the HUD: pause and resume, low health (once per match, when crossing the
 *   threshold), 30 s and 10 s warnings (when crossing them) and each new point.
 */
export function soundsFor(
  events: readonly SimEvent[],
  previous: SoundHud | null,
  next: SoundHud,
  cursor: SoundCursor,
  playerFrontCount: number,
): { sounds: SoundId[]; cursor: SoundCursor } {
  if (previous === null) return { sounds: ['game_start'], cursor };
  if (previous.phase === 'ended') return { sounds: [], cursor };

  for (const event of events) {
    if (event.type === 'matchEnded') {
      return { sounds: [event.reason === 'time' ? 'game_complete' : 'game_over'], cursor };
    }
  }

  const rams = events.filter(
    (event): event is Extract<SimEvent, { type: 'shipDestroyed' }> =>
      event.type === 'shipDestroyed' && event.cause === 'ramming',
  );
  const isRam = (event: Extract<SimEvent, { type: 'shipHit' }>) =>
    event.targetId === PLAYER_ID && rams.some((ram) => ram.x === event.x && ram.y === event.y);

  let cannon = false;
  let broadside = false;
  let woodHit = false;
  let explosion = false;
  let waterHit = false;
  for (const event of events) {
    switch (event.type) {
      case 'shot':
        if (event.ownerId === PLAYER_ID && event.muzzles.length > playerFrontCount) {
          broadside = true;
        } else {
          cannon = true;
        }
        break;
      case 'shipHit':
        if (!isRam(event)) woodHit = true;
        break;
      case 'shipDestroyed':
        if (event.cause === 'playerFire') explosion = true;
        break;
      case 'projectileRemoved':
        if (event.reason === 'expired') waterHit = true;
        break;
    }
  }

  const sounds: SoundId[] = [];
  const nextCursor = { ...cursor };
  if (cannon) sounds.push(FRONT_FIRE[nextCursor.frontFire++ % FRONT_FIRE.length]!);
  if (broadside) sounds.push('cannon_broadside');
  if (woodHit) sounds.push(WOOD_HIT[nextCursor.woodHit++ % WOOD_HIT.length]!);
  if (rams.length > 0) sounds.push('ship_collision');
  if (explosion) sounds.push(EXPLOSION[nextCursor.explosion++ % EXPLOSION.length]!);
  if (waterHit) sounds.push(WATER_HIT[nextCursor.waterHit++ % WATER_HIT.length]!);

  if (!previous.paused && next.paused) sounds.push('game_pause');
  if (previous.paused && !next.paused) sounds.push('game_resume');

  const lowHealth = next.maxHp * LOW_HEALTH_FRACTION;
  if (
    !nextCursor.lowHealthPlayed &&
    next.hp > 0 &&
    next.hp <= lowHealth &&
    previous.hp > lowHealth
  ) {
    sounds.push('health_low');
    nextCursor.lowHealthPlayed = true;
  }
  if (
    TIME_WARNINGS.some(
      (seconds) => previous.remainingSeconds > seconds && next.remainingSeconds <= seconds,
    )
  ) {
    sounds.push('time_warning');
  }
  if (next.score > previous.score) sounds.push('score_point');

  return { sounds, cursor: nextCursor };
}
