import type { GameConfig, ShipHull } from '../config.ts';
import { headingTowards, type EnemyKind } from './ai.ts';
import type { Rng } from './rng.ts';
import { hullsOverlap, type Ship } from './ships.ts';

export type SpawnRecord = {
  id: number;
  kind: EnemyKind;
  /** Tick the spawn was scheduled for. */
  scheduledTick: number;
  /** Tick the enemy actually appeared (later than scheduled when it had to wait for a point). */
  spawnTick: number;
  x: number;
  y: number;
  /** Distance to the player at the moment it appeared. */
  distanceToPlayer: number;
};

export type SpawnStats = {
  /** Scheduled spawns skipped because `maxAlive` enemies were alive. */
  skippedAtCap: number;
  /** Pending spawns dropped because the next scheduled spawn arrived first. */
  replaced: number;
  /** Ticks a pending spawn waited because no spawn point was valid. */
  deferredTicks: number;
  nextScheduledTick: number;
};

type Pending = { scheduledTick: number; kind: EnemyKind | null };

/** A ship already in the arena, with its hull, that a new spawn must not overlap. */
export type Occupant = { ship: Ship; hull: ShipHull };

const KIND_ORDER: readonly EnemyKind[] = ['chaser', 'shooter'];

/**
 * Schedules enemy spawns on a fixed cadence and places them at valid spawn points.
 *
 * - Cadence: scheduled at firstDelay, then every interval, in whole ticks. Skipping or
 *   replacing a spawn never moves the following scheduled ticks.
 * - At a scheduled tick: skipped when `maxAlive` enemies are alive; otherwise it becomes
 *   pending (a still-pending older spawn is dropped and counted as replaced).
 * - A pending spawn is placed on the first tick with a valid point: at least
 *   `minDistanceFromPlayer` away from the player and not overlapping any living hull,
 *   checked on the tick it actually appears.
 * - Kinds: the opening kinds in order, then weighted random picks.
 */
export class Spawner {
  readonly spawns: SpawnRecord[] = [];
  private readonly stats: SpawnStats;
  private pending: Pending | null = null;
  private openingIndex = 0;
  private readonly intervalTicks: number;

  constructor(
    private readonly config: GameConfig,
    private readonly rng: Rng,
    private readonly points: readonly { x: number; y: number }[],
  ) {
    const { stepsPerSecond } = config.simulation;
    const { intervalSeconds, firstDelaySeconds } = config.spawn;
    this.intervalTicks = Math.max(1, Math.round(intervalSeconds * stepsPerSecond));
    this.stats = {
      skippedAtCap: 0,
      replaced: 0,
      deferredTicks: 0,
      nextScheduledTick: Math.max(0, Math.round(firstDelaySeconds * stepsPerSecond)),
    };
  }

  getStats(): SpawnStats {
    return { ...this.stats };
  }

  /**
   * Runs once per step, after the step's other phases. Calls `spawn` at most once and
   * returns the record of the enemy it created, if any.
   */
  update(
    tick: number,
    player: Ship,
    playerHull: ShipHull,
    enemies: readonly Occupant[],
    spawn: (kind: EnemyKind, x: number, y: number, heading: number) => number,
  ): SpawnRecord | null {
    const spawnConfig = this.config.spawn;

    if (tick === this.stats.nextScheduledTick) {
      this.stats.nextScheduledTick += this.intervalTicks;
      if (enemies.length >= spawnConfig.maxAlive) {
        this.stats.skippedAtCap += 1;
      } else {
        if (this.pending) this.stats.replaced += 1;
        this.pending = { scheduledTick: tick, kind: null };
      }
    }
    if (!this.pending) return null;

    // The kind is decided once per pending spawn; opening kinds are consumed only when
    // they actually appear, so a dropped spawn cannot lose one of them.
    const kind = (this.pending.kind ??= this.nextKind());
    const hull = this.config.enemies[kind].hull;
    const occupants: Occupant[] = [{ ship: player, hull: playerHull }, ...enemies];
    const valid = this.points.filter((point) => {
      const distance = Math.hypot(point.x - player.x, point.y - player.y);
      if (distance < spawnConfig.minDistanceFromPlayer) return false;
      const candidate: Ship = {
        x: point.x,
        y: point.y,
        heading: headingTowards(point, player),
        speed: 0,
      };
      return !occupants.some((other) => hullsOverlap(candidate, hull, other.ship, other.hull));
    });
    if (valid.length === 0) {
      this.stats.deferredTicks += 1;
      return null;
    }

    const point = valid[this.rng.int(valid.length)]!;
    const id = spawn(kind, point.x, point.y, headingTowards(point, player));
    if (this.openingIndex < spawnConfig.openingKinds.length) this.openingIndex += 1;
    const record: SpawnRecord = {
      id,
      kind,
      scheduledTick: this.pending.scheduledTick,
      spawnTick: tick,
      x: point.x,
      y: point.y,
      distanceToPlayer: Math.hypot(point.x - player.x, point.y - player.y),
    };
    this.spawns.push(record);
    this.pending = null;
    return record;
  }

  private nextKind(): EnemyKind {
    const opening = this.config.spawn.openingKinds[this.openingIndex];
    if (opening) return opening;
    const { weights } = this.config.spawn;
    const total = KIND_ORDER.reduce((sum, kind) => sum + weights[kind], 0);
    let roll = this.rng.next() * total;
    for (const kind of KIND_ORDER) {
      roll -= weights[kind];
      if (roll < 0) return kind;
    }
    return KIND_ORDER[KIND_ORDER.length - 1]!;
  }
}
