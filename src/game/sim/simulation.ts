import { ARENA_BOUNDS, ISLAND_COLLIDERS, PLAYER_START, SPAWN_POINTS } from '../arena.ts';
import { secondsToTicks, type EnemyConfig, type GameConfig, type WeaponConfig } from '../config.ts';
import { enemyControls, headingTowards, wrapAngle, type Enemy, type EnemyKind } from './ai.ts';
import {
  hullCircles,
  hullsOverlap,
  resolveShipCollisions,
  separateShips,
  steerShip,
  type Ship,
  type ShipControls,
} from './ships.ts';
import { Rng } from './rng.ts';
import { Spawner } from './spawner.ts';
import {
  createShot,
  moveProjectile,
  PLAYER_ID,
  WEAPON_SLOTS,
  type Projectile,
  type ProjectileRemoval,
  type ProjectileTarget,
  type WeaponSlot,
} from './weapons.ts';

export { hullCircles, type Ship } from './ships.ts';

/** Player commands sampled once per simulation step. */
export type InputState = {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
};

const FIRE_INPUT: Record<WeaponSlot, keyof InputState> = {
  front: 'fireFront',
  left: 'fireLeft',
  right: 'fireRight',
};

export type PlayerShip = Ship & { hp: number; maxHp: number };

/** Why an enemy was destroyed. Only `playerFire` scores. */
export type DestroyCause = 'playerFire' | 'ramming';

export type EnemyPlacement = { kind: EnemyKind; x: number; y: number; heading: number };

export type SimulationOptions = {
  /** Seed of the simulation's random generator: the same seed replays the same match. */
  seed?: number;
  playerStart?: { x: number; y: number; heading: number };
  /** Enemies present when the match starts (used by fixed test scenarios). */
  enemies?: readonly EnemyPlacement[];
  /** Spawns enemies over time (default true; fixed test scenarios turn it off). */
  spawner?: boolean;
};

/** Seed used when none is given (tests); the game passes a fresh seed for every match. */
export const DEFAULT_SEED = 1;

/** Facts produced by a step, consumed by the renderer for visual effects only. */
export type SimEvent =
  | { type: 'shot'; ownerId: number; muzzles: { x: number; y: number }[]; heading: number }
  | { type: 'projectileRemoved'; id: number; x: number; y: number; reason: ProjectileRemoval }
  | { type: 'shipHit'; targetId: number; x: number; y: number; damage: number }
  | {
      type: 'shipDestroyed';
      id: number;
      kind: EnemyKind;
      x: number;
      y: number;
      cause: DestroyCause;
    };

/**
 * Deterministic game simulation. It has no rendering or DOM dependencies.
 *
 * Order of one step:
 * 1. commands: player input; AI for each living enemy (by id), from start-of-step positions
 * 2. movement of every ship
 * 3. separation of overlapping hulls (enemy/enemy, shooter/player; chasers ram instead)
 * 4. island and arena collision for every ship, so islands always win
 * 5. ramming: a chaser touching the player damages it once and is destroyed
 * 6. projectiles, in creation order: first contact along the swept segment; a hit applies
 *    damage once, and a destroyed enemy stops being a target immediately and loses its
 *    projectiles in flight
 * 7. firing: player, then living shooters (by id); new projectiles move from the next step
 * 8. destroyed enemies are removed
 * 9. spawning: a new enemy appears at a valid point; it acts from the next step
 */
export class Simulation {
  readonly player: PlayerShip;
  enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  /** Completed simulation steps. All game timing is expressed in whole ticks. */
  tick = 0;
  /** Enemies destroyed by the player's fire. Ramming chasers do not count. */
  score = 0;
  readonly enemiesDestroyed: Record<DestroyCause, number> = { playerFire: 0, ramming: 0 };
  /** Tick from which each player weapon may fire again. */
  readonly weaponReadyAt: Record<WeaponSlot, number> = { front: 0, left: 0, right: 0 };
  readonly shotsFired: Record<WeaponSlot, number> = { front: 0, left: 0, right: 0 };
  enemyShotsFired = 0;
  readonly projectilesRemoved: Record<ProjectileRemoval, number> = {
    island: 0,
    outOfBounds: 0,
    expired: 0,
    ship: 0,
    ownerDestroyed: 0,
  };
  readonly seed: number;
  readonly spawner: Spawner | null;
  private readonly rng: Rng;
  private nextProjectileId = 1;
  private nextEnemyId = 1;
  private events: SimEvent[] = [];
  private readonly dt: number;
  /** Projectiles removed during the current step (filtered out at its end). */
  private readonly removedProjectiles = new Set<number>();

  constructor(
    readonly config: GameConfig,
    options: SimulationOptions = {},
  ) {
    const start = options.playerStart ?? PLAYER_START;
    this.player = {
      x: start.x,
      y: start.y,
      heading: start.heading,
      speed: 0,
      hp: config.player.maxHp,
      maxHp: config.player.maxHp,
    };
    this.dt = 1 / config.simulation.stepsPerSecond;
    this.seed = (options.seed ?? DEFAULT_SEED) >>> 0;
    this.rng = new Rng(this.seed);
    this.spawner = options.spawner === false ? null : new Spawner(config, this.rng, SPAWN_POINTS);
    for (const placement of options.enemies ?? []) this.addEnemy(placement);
  }

  /** Simulated seconds since the match started. */
  get elapsed(): number {
    return this.tick / this.config.simulation.stepsPerSecond;
  }

  enemyConfig(kind: EnemyKind): EnemyConfig {
    return this.config.enemies[kind];
  }

  addEnemy(placement: EnemyPlacement): Enemy {
    const kindConfig = this.enemyConfig(placement.kind);
    const enemy: Enemy = {
      id: this.nextEnemyId++,
      kind: placement.kind,
      x: placement.x,
      y: placement.y,
      heading: placement.heading,
      speed: 0,
      hp: kindConfig.maxHp,
      maxHp: kindConfig.maxHp,
      alive: true,
      weaponReadyAt: 0,
      stuckTicks: 0,
      unstuckUntil: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  step(input: InputState): void {
    const playerConfig = this.config.player;

    // 1. Commands, decided from start-of-step positions.
    const playerControls: ShipControls = {
      throttle: input.forward,
      turn: (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0),
    };
    const enemyCommands = this.enemies.map((enemy) =>
      enemyControls(
        enemy,
        this.enemyConfig(enemy.kind),
        this.player,
        this.config,
        ISLAND_COLLIDERS,
        this.tick,
      ),
    );
    const startPositions = this.enemies.map((enemy) => ({ x: enemy.x, y: enemy.y }));

    // 2. Movement.
    steerShip(this.player, playerConfig.movement, playerControls, this.dt);
    this.enemies.forEach((enemy, index) => {
      steerShip(enemy, this.enemyConfig(enemy.kind).movement, enemyCommands[index]!, this.dt);
    });

    // 3. Separation between hulls (chasers ram the player instead of being pushed away).
    for (let i = 0; i < this.enemies.length; i += 1) {
      const enemy = this.enemies[i]!;
      const hull = this.enemyConfig(enemy.kind).hull;
      for (let j = i + 1; j < this.enemies.length; j += 1) {
        const other = this.enemies[j]!;
        separateShips(enemy, hull, other, this.enemyConfig(other.kind).hull);
      }
      if (enemy.kind === 'shooter') separateShips(enemy, hull, this.player, playerConfig.hull);
    }

    // 4. Islands and arena bounds win over everything else.
    resolveShipCollisions(
      this.player,
      playerConfig.hull,
      playerConfig.movement.maxSpeed,
      ISLAND_COLLIDERS,
      ARENA_BOUNDS,
    );
    this.enemies.forEach((enemy, index) => {
      const { hull, movement } = this.enemyConfig(enemy.kind);
      resolveShipCollisions(enemy, hull, movement.maxSpeed, ISLAND_COLLIDERS, ARENA_BOUNDS);
      this.updateStuckState(
        enemy,
        movement.maxSpeed,
        enemyCommands[index]!,
        startPositions[index]!,
      );
    });

    // 5. Ramming.
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.kind !== 'chaser') continue;
      if (!hullsOverlap(enemy, this.enemyConfig('chaser').hull, this.player, playerConfig.hull)) {
        continue;
      }
      this.damagePlayer(this.config.enemies.chaser.impactDamage, enemy.x, enemy.y);
      this.destroyEnemy(enemy, 'ramming');
    }

    // 6. Projectiles.
    this.updateProjectiles();

    // 7. Firing.
    this.firePlayerWeapons(input);
    this.fireShooters();

    // 8. Cleanup.
    this.enemies = this.enemies.filter((enemy) => enemy.alive);

    // 9. Spawning.
    this.spawner?.update(
      this.tick,
      this.player,
      playerConfig.hull,
      this.enemies.map((enemy) => ({ ship: enemy, hull: this.enemyConfig(enemy.kind).hull })),
      (kind, x, y, heading) => this.addEnemy({ kind, x, y, heading }).id,
    );
    this.tick += 1;
  }

  /** Internal state of the random generator (for determinism checks). */
  get rngState(): number {
    return this.rng.currentState;
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  private updateStuckState(
    enemy: Enemy,
    maxSpeed: number,
    controls: ShipControls,
    start: { x: number; y: number },
  ): void {
    const { ai } = this.config.enemies;
    const { stepsPerSecond } = this.config.simulation;
    const moved = Math.hypot(enemy.x - start.x, enemy.y - start.y);
    const barelyMoving = moved < maxSpeed * this.dt * ai.stuckSpeedRatio;
    enemy.stuckTicks = controls.throttle && barelyMoving ? enemy.stuckTicks + 1 : 0;
    if (enemy.stuckTicks >= secondsToTicks(ai.stuckSeconds, stepsPerSecond)) {
      enemy.stuckTicks = 0;
      enemy.unstuckUntil = this.tick + secondsToTicks(ai.unstuckSeconds, stepsPerSecond);
    }
  }

  private damagePlayer(damage: number, x: number, y: number): void {
    this.player.hp = Math.max(0, this.player.hp - damage);
    this.events.push({ type: 'shipHit', targetId: PLAYER_ID, x, y, damage });
  }

  private destroyEnemy(enemy: Enemy, cause: DestroyCause): void {
    if (!enemy.alive) return;
    enemy.alive = false;
    this.enemiesDestroyed[cause] += 1;
    if (cause === 'playerFire') this.score += 1;
    this.events.push({
      type: 'shipDestroyed',
      id: enemy.id,
      kind: enemy.kind,
      x: enemy.x,
      y: enemy.y,
      cause,
    });
    // A destroyed enemy stops causing damage: its projectiles in flight are removed too.
    for (const projectile of this.projectiles) {
      if (projectile.ownerId === enemy.id) this.removeProjectile(projectile, 'ownerDestroyed');
    }
  }

  private removeProjectile(projectile: Projectile, reason: ProjectileRemoval): void {
    if (this.removedProjectiles.has(projectile.id)) return;
    this.removedProjectiles.add(projectile.id);
    this.projectilesRemoved[reason] += 1;
    this.events.push({
      type: 'projectileRemoved',
      id: projectile.id,
      x: projectile.x,
      y: projectile.y,
      reason,
    });
  }

  private updateProjectiles(): void {
    // Hull positions are final for this step. Living enemies are filtered per projectile,
    // so an enemy destroyed by one projectile cannot be hit by the next.
    const enemyTargets = this.enemies.map((enemy) => ({
      enemy,
      target: {
        id: enemy.id,
        circles: hullCircles(enemy, this.enemyConfig(enemy.kind).hull),
      } satisfies ProjectileTarget,
    }));
    const playerTargets: ProjectileTarget[] = [
      { id: PLAYER_ID, circles: hullCircles(this.player, this.config.player.hull) },
    ];

    for (const projectile of this.projectiles) {
      // Removed earlier in this step (e.g. its owner was destroyed): it does nothing.
      if (this.removedProjectiles.has(projectile.id)) continue;
      const targets =
        projectile.owner === 'player'
          ? enemyTargets.filter(({ enemy }) => enemy.alive).map(({ target }) => target)
          : playerTargets;
      const outcome = moveProjectile(projectile, this.dt, ISLAND_COLLIDERS, ARENA_BOUNDS, targets);
      if (!outcome) continue;

      this.removeProjectile(projectile, outcome.reason);
      if (outcome.reason !== 'ship') continue;
      if (outcome.targetId === PLAYER_ID) {
        this.damagePlayer(projectile.damage, projectile.x, projectile.y);
        continue;
      }
      const enemy = this.enemies.find((candidate) => candidate.id === outcome.targetId)!;
      enemy.hp = Math.max(0, enemy.hp - projectile.damage);
      this.events.push({
        type: 'shipHit',
        targetId: enemy.id,
        x: projectile.x,
        y: projectile.y,
        damage: projectile.damage,
      });
      if (enemy.hp === 0) this.destroyEnemy(enemy, 'playerFire');
    }

    this.compactProjectiles();
  }

  private compactProjectiles(): void {
    if (this.removedProjectiles.size === 0) return;
    let kept = 0;
    for (const projectile of this.projectiles) {
      if (!this.removedProjectiles.has(projectile.id)) this.projectiles[kept++] = projectile;
    }
    this.projectiles.length = kept;
    this.removedProjectiles.clear();
  }

  private spawnShot(ship: Ship, ownerId: number, slot: WeaponSlot, weapon: WeaponConfig): void {
    const shot = createShot(ship, slot, weapon, this.config.simulation.stepsPerSecond);
    for (const projectile of shot) {
      this.projectiles.push({
        ...projectile,
        id: this.nextProjectileId++,
        owner: ownerId === PLAYER_ID ? 'player' : 'enemy',
        ownerId,
      });
    }
    this.events.push({
      type: 'shot',
      ownerId,
      muzzles: shot.map(({ x, y }) => ({ x, y })),
      heading: ship.heading,
    });
  }

  private firePlayerWeapons(input: InputState): void {
    const { stepsPerSecond } = this.config.simulation;
    for (const slot of WEAPON_SLOTS) {
      if (!input[FIRE_INPUT[slot]] || this.tick < this.weaponReadyAt[slot]) continue;
      const weapon = slot === 'front' ? this.config.weapons.front : this.config.weapons.side;
      this.weaponReadyAt[slot] = this.tick + secondsToTicks(weapon.cooldown, stepsPerSecond);
      this.shotsFired[slot] += 1;
      this.spawnShot(this.player, PLAYER_ID, slot, weapon);
    }
  }

  private fireShooters(): void {
    const shooter = this.config.enemies.shooter;
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.kind !== 'shooter' || this.tick < enemy.weaponReadyAt) continue;
      const distance = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
      const offAxis = Math.abs(wrapAngle(headingTowards(enemy, this.player) - enemy.heading));
      if (distance > shooter.attackRange || offAxis > shooter.fireCone) continue;

      enemy.weaponReadyAt =
        this.tick + secondsToTicks(shooter.weapon.cooldown, this.config.simulation.stepsPerSecond);
      this.enemyShotsFired += 1;
      this.spawnShot(enemy, enemy.id, 'front', shooter.weapon);
    }
  }
}
