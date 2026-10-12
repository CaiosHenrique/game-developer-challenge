import { Container, Graphics, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { ISLAND_COLLIDERS, ISLAND_FRAMES, ISLANDS, WORLD_HEIGHT, WORLD_WIDTH } from '../arena.ts';
import { getFrame, SHIP_FRAMES, type GameTextures } from '../assets.ts';
import type { ShipHull } from '../config.ts';
import { hullCircles, type SimEvent, type Simulation } from '../sim/simulation.ts';

/** Ship sprites point down (+Y) in the source art; heading 0 points up. */
const SHIP_SPRITE_ROTATION_OFFSET = Math.PI;

type Effect = {
  sprite: Sprite;
  age: number;
  duration: number;
  fromScale: number;
  toScale: number;
};

export type RendererStats = {
  /** Sprites currently showing a projectile. */
  projectileSprites: number;
  /** Hidden projectile sprites kept for reuse. */
  pooledProjectileSprites: number;
  effects: number;
  pooledEffects: number;
  /** Display objects in the projectile and effect layers (visible or pooled). */
  dynamicChildren: number;
};

/**
 * Draws the simulation. It only reads simulation state and events: visual effects live
 * here, in render time, and never feed back into the deterministic game state.
 */
export class GameRenderer {
  readonly root = new Container();
  private readonly projectileLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly playerSprite: Sprite;
  private readonly debugLayer: Graphics | null;

  private readonly projectileSprites = new Map<number, Sprite>();
  private readonly projectilePool: Sprite[] = [];
  private readonly effects: Effect[] = [];
  private readonly effectPool: Sprite[] = [];
  private readonly seen = new Set<number>();

  private readonly cannonBall: Texture;
  private readonly smallExplosion: Texture;

  constructor(
    textures: GameTextures,
    private readonly hull: ShipHull,
    debugColliders: boolean,
  ) {
    const { ships, tiles, water } = textures;
    this.cannonBall = getFrame(ships, 'cannon_ball');
    this.smallExplosion = getFrame(ships, 'explosion_3');

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
    this.root.addChild(this.playerSprite, this.projectileLayer, this.effectLayer);

    this.debugLayer = debugColliders ? new Graphics() : null;
    if (this.debugLayer) this.root.addChild(this.debugLayer);
  }

  /** Brings the scene up to date with the simulation and advances visual effects. */
  sync(simulation: Simulation, events: readonly SimEvent[], deltaSeconds: number): void {
    const player = simulation.player;
    this.playerSprite.position.set(player.x, player.y);
    this.playerSprite.rotation = player.heading + SHIP_SPRITE_ROTATION_OFFSET;

    this.syncProjectiles(simulation);
    for (const event of events) this.spawnEffects(event);
    this.updateEffects(deltaSeconds);

    if (this.debugLayer) this.drawColliders(this.debugLayer, simulation);
  }

  stats(): RendererStats {
    return {
      projectileSprites: this.projectileSprites.size,
      pooledProjectileSprites: this.projectilePool.length,
      effects: this.effects.length,
      pooledEffects: this.effectPool.length,
      dynamicChildren: this.projectileLayer.children.length + this.effectLayer.children.length,
    };
  }

  private syncProjectiles(simulation: Simulation): void {
    this.seen.clear();
    for (const projectile of simulation.projectiles) {
      this.seen.add(projectile.id);
      let sprite = this.projectileSprites.get(projectile.id);
      if (!sprite) {
        sprite = this.acquire(this.projectilePool, this.projectileLayer, this.cannonBall);
        this.projectileSprites.set(projectile.id, sprite);
      }
      sprite.position.set(projectile.x, projectile.y);
    }
    // Sprites of removed projectiles are hidden and kept for reuse.
    for (const [id, sprite] of this.projectileSprites) {
      if (this.seen.has(id)) continue;
      sprite.visible = false;
      this.projectilePool.push(sprite);
      this.projectileSprites.delete(id);
    }
  }

  private spawnEffects(event: SimEvent): void {
    if (event.type === 'shot') {
      for (const muzzle of event.muzzles) {
        this.addEffect(this.smallExplosion, muzzle.x, muzzle.y, 0.18, 0.45, 0.85);
      }
    } else if (event.reason === 'island') {
      this.addEffect(this.smallExplosion, event.x, event.y, 0.3, 0.45, 0.9);
    } else if (event.reason === 'expired') {
      // The ball sinks where it lands.
      this.addEffect(this.cannonBall, event.x, event.y, 0.3, 1, 0.3);
    }
  }

  private addEffect(
    texture: Texture,
    x: number,
    y: number,
    duration: number,
    fromScale: number,
    toScale: number,
  ): void {
    const sprite = this.acquire(this.effectPool, this.effectLayer, texture);
    sprite.position.set(x, y);
    sprite.scale.set(fromScale);
    sprite.alpha = 1;
    this.effects.push({ sprite, age: 0, duration, fromScale, toScale });
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
      effect.sprite.scale.set(effect.fromScale + (effect.toScale - effect.fromScale) * progress);
      effect.sprite.alpha = 1 - progress;
      this.effects[kept++] = effect;
    }
    this.effects.length = kept;
  }

  /** Reuses a hidden sprite from the pool, or creates one in the layer. */
  private acquire(pool: Sprite[], layer: Container, texture: Texture): Sprite {
    const sprite = pool.pop() ?? layer.addChild(new Sprite({ texture, anchor: 0.5 }));
    sprite.texture = texture;
    sprite.visible = true;
    sprite.alpha = 1;
    sprite.scale.set(1);
    return sprite;
  }

  private drawColliders(graphics: Graphics, simulation: Simulation): void {
    graphics.clear();
    for (const box of ISLAND_COLLIDERS) {
      graphics.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    }
    for (const circle of hullCircles(simulation.player, this.hull)) {
      graphics.circle(circle.x, circle.y, circle.radius);
    }
    for (const projectile of simulation.projectiles) {
      graphics.circle(projectile.x, projectile.y, projectile.radius);
    }
    graphics.stroke({ width: 2, color: 0xff3366 });
  }
}
