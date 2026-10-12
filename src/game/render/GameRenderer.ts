import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { ISLAND_COLLIDERS, ISLAND_FRAMES, ISLANDS, WORLD_HEIGHT, WORLD_WIDTH } from '../arena.ts';
import { getFrame, SHIP_FRAMES, type GameTextures } from '../assets.ts';
import type { GameConfig } from '../config.ts';
import { hullCircles, type SimEvent, type Simulation } from '../sim/simulation.ts';

/** Ship sprites point down (+Y) in the source art; heading 0 points up. */
const SHIP_SPRITE_ROTATION_OFFSET = Math.PI;

type Effect = {
  sprite: Sprite;
  age: number;
  duration: number;
  fromScale: number;
  toScale: number;
  /** Optional frame sequence played over the effect's duration. */
  frames: readonly Texture[] | null;
};

/** Sprites keyed by simulation id. Sprites of ids that disappear are hidden and reused. */
class KeyedSprites {
  private readonly active = new Map<number, Sprite>();
  private readonly pool: Sprite[] = [];
  private readonly seen = new Set<number>();

  constructor(readonly layer: Container) {}

  begin(): void {
    this.seen.clear();
  }

  show(id: number, texture: Texture): Sprite {
    this.seen.add(id);
    let sprite = this.active.get(id);
    if (!sprite) {
      sprite = this.pool.pop() ?? this.layer.addChild(new Sprite({ anchor: 0.5 }));
      sprite.visible = true;
      this.active.set(id, sprite);
    }
    sprite.texture = texture;
    return sprite;
  }

  /** Hides and pools the sprites of ids not shown since `begin()`. */
  end(): void {
    for (const [id, sprite] of this.active) {
      if (this.seen.has(id)) continue;
      sprite.visible = false;
      this.pool.push(sprite);
      this.active.delete(id);
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pooledCount(): number {
    return this.pool.length;
  }
}

export type RendererStats = {
  /** Sprites currently showing a projectile. */
  projectileSprites: number;
  /** Hidden projectile sprites kept for reuse. */
  pooledProjectileSprites: number;
  enemySprites: number;
  pooledEnemySprites: number;
  effects: number;
  pooledEffects: number;
  /** Display objects in the enemy, projectile and effect layers (visible or pooled). */
  dynamicChildren: number;
};

/**
 * Draws the simulation. It only reads simulation state and events: visual effects live
 * here, in render time, and never feed back into the deterministic game state.
 */
export class GameRenderer {
  readonly root = new Container();
  private readonly enemyLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly playerSprite: Sprite;
  private readonly debugLayer: Graphics | null;

  private readonly enemies = new KeyedSprites(this.enemyLayer);
  private readonly projectiles = new KeyedSprites(this.projectileLayer);
  private readonly effects: Effect[] = [];
  private readonly effectPool: Sprite[] = [];

  private readonly enemyTextures: { chaser: Texture; shooter: Texture };
  private readonly cannonBall: Texture;
  private readonly smallExplosion: Texture;
  private readonly explosionFrames: readonly Texture[];

  constructor(
    textures: GameTextures,
    private readonly config: GameConfig,
    debugColliders: boolean,
  ) {
    const { ships, tiles, water } = textures;
    this.enemyTextures = {
      chaser: getFrame(ships, SHIP_FRAMES.chaser),
      shooter: getFrame(ships, SHIP_FRAMES.shooter),
    };
    this.cannonBall = getFrame(ships, 'cannon_ball');
    this.smallExplosion = getFrame(ships, 'explosion_3');
    this.explosionFrames = ['explosion_3', 'explosion_2', 'explosion_1'].map((name) =>
      getFrame(ships, name),
    );

    this.root.addChild(
      new TilingSprite({ texture: water, width: WORLD_WIDTH, height: WORLD_HEIGHT }),
    );
    for (const island of ISLANDS) {
      const sprite = new Sprite({
        texture: getFrame(tiles, ISLAND_FRAMES[island.kind]),
        anchor: 0.5,
      });
      sprite.position.set(island.x, island.y);
      this.root.addChild(sprite);
    }

    this.playerSprite = new Sprite({ texture: getFrame(ships, SHIP_FRAMES.player), anchor: 0.5 });
    this.root.addChild(this.enemyLayer, this.playerSprite, this.projectileLayer, this.effectLayer);

    this.debugLayer = debugColliders ? new Graphics() : null;
    if (this.debugLayer) this.root.addChild(this.debugLayer);
  }

  /** Brings the scene up to date with the simulation and advances visual effects. */
  sync(simulation: Simulation, events: readonly SimEvent[], deltaSeconds: number): void {
    const player = simulation.player;
    this.playerSprite.position.set(player.x, player.y);
    this.playerSprite.rotation = player.heading + SHIP_SPRITE_ROTATION_OFFSET;

    this.enemies.begin();
    for (const enemy of simulation.enemies) {
      const sprite = this.enemies.show(enemy.id, this.enemyTextures[enemy.kind]);
      sprite.position.set(enemy.x, enemy.y);
      sprite.rotation = enemy.heading + SHIP_SPRITE_ROTATION_OFFSET;
    }
    this.enemies.end();

    this.projectiles.begin();
    for (const projectile of simulation.projectiles) {
      this.projectiles
        .show(projectile.id, this.cannonBall)
        .position.set(projectile.x, projectile.y);
    }
    this.projectiles.end();

    for (const event of events) this.spawnEffects(event);
    this.updateEffects(deltaSeconds);

    if (this.debugLayer) this.drawColliders(this.debugLayer, simulation);
  }

  stats(): RendererStats {
    return {
      projectileSprites: this.projectiles.activeCount,
      pooledProjectileSprites: this.projectiles.pooledCount,
      enemySprites: this.enemies.activeCount,
      pooledEnemySprites: this.enemies.pooledCount,
      effects: this.effects.length,
      pooledEffects: this.effectPool.length,
      dynamicChildren:
        this.enemyLayer.children.length +
        this.projectileLayer.children.length +
        this.effectLayer.children.length,
    };
  }

  private spawnEffects(event: SimEvent): void {
    switch (event.type) {
      case 'shot':
        for (const muzzle of event.muzzles) {
          this.addEffect(this.smallExplosion, muzzle.x, muzzle.y, 0.18, 0.45, 0.85);
        }
        break;
      case 'projectileRemoved':
        if (event.reason === 'island') {
          this.addEffect(this.smallExplosion, event.x, event.y, 0.3, 0.45, 0.9);
        } else if (event.reason === 'expired') {
          // The ball sinks where it lands.
          this.addEffect(this.cannonBall, event.x, event.y, 0.3, 1, 0.3);
        }
        break;
      case 'shipHit':
        this.addEffect(this.smallExplosion, event.x, event.y, 0.3, 0.5, 1);
        break;
      case 'shipDestroyed':
        this.addEffect(this.smallExplosion, event.x, event.y, 0.6, 0.9, 1.3, this.explosionFrames);
        break;
    }
  }

  private addEffect(
    texture: Texture,
    x: number,
    y: number,
    duration: number,
    fromScale: number,
    toScale: number,
    frames: readonly Texture[] | null = null,
  ): void {
    const sprite = this.effectPool.pop() ?? this.effectLayer.addChild(new Sprite({ anchor: 0.5 }));
    sprite.texture = texture;
    sprite.visible = true;
    sprite.position.set(x, y);
    sprite.scale.set(fromScale);
    sprite.alpha = 1;
    this.effects.push({ sprite, age: 0, duration, fromScale, toScale, frames });
  }

  private updateEffects(deltaSeconds: number): void {
    let kept = 0;
    for (const effect of this.effects) {
      effect.age += deltaSeconds;
      const progress = Math.min(1, effect.age / effect.duration);
      if (progress >= 1) {
        effect.sprite.visible = false;
        this.effectPool.push(effect.sprite);
        continue;
      }
      if (effect.frames) {
        const index = Math.min(
          effect.frames.length - 1,
          Math.floor(progress * effect.frames.length),
        );
        effect.sprite.texture = effect.frames[index]!;
      }
      effect.sprite.scale.set(effect.fromScale + (effect.toScale - effect.fromScale) * progress);
      effect.sprite.alpha = 1 - progress * progress;
      this.effects[kept++] = effect;
    }
    this.effects.length = kept;
  }

  private drawColliders(graphics: Graphics, simulation: Simulation): void {
    graphics.clear();
    for (const box of ISLAND_COLLIDERS) {
      graphics.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    }
    for (const circle of hullCircles(simulation.player, this.config.player.hull)) {
      graphics.circle(circle.x, circle.y, circle.radius);
    }
    for (const enemy of simulation.enemies) {
      for (const circle of hullCircles(enemy, this.config.enemies[enemy.kind].hull)) {
        graphics.circle(circle.x, circle.y, circle.radius);
      }
    }
    for (const projectile of simulation.projectiles) {
      graphics.circle(projectile.x, projectile.y, projectile.radius);
    }
    graphics.stroke({ width: 2, color: 0xff3366 });
  }
}
