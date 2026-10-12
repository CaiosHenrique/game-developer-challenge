import { Container, Graphics, Rectangle, Sprite, Texture, TilingSprite } from 'pixi.js';
import { ISLAND_COLLIDERS, ISLAND_FRAMES, ISLANDS, WORLD_HEIGHT, WORLD_WIDTH } from '../arena.ts';
import { getFrame, shipFrame, type GameTextures, type ShipColor } from '../assets.ts';
import type { GameConfig } from '../config.ts';
import type { EnemyKind } from '../sim/ai.ts';
import { hullCircles, type SimEvent, type Simulation } from '../sim/simulation.ts';
import { PLAYER_ID } from '../sim/weapons.ts';

/** Ship sprites point down (+Y) in the source art; heading 0 points up. */
const SHIP_SPRITE_ROTATION_OFFSET = Math.PI;

/** Fill area of the enemy health bar art (ui atlas `layout.fill_rect`, logical pixels). */
const BAR_FILL = { x: 24, y: 12, w: 112, h: 15 };
const BAR_SCALE = 0.45;
/** Distance of a health bar above its ship's center. */
const BAR_OFFSET_Y = 66;

/** Damage stage from the health fraction: 0 intact, 1 damaged, 2 badly damaged. */
export function damageStage(hp: number, maxHp: number): 0 | 1 | 2 {
  const ratio = hp / maxHp;
  if (ratio > 2 / 3) return 0;
  if (ratio > 1 / 3) return 1;
  return 2;
}

/** A health bar drawn above a ship; it never rotates with the hull. */
class HealthBar {
  readonly root = new Container();
  private readonly fill = new Sprite();
  private fillTexture: Texture | null = null;
  private ratio = -1;

  constructor(
    frame: Texture,
    private readonly green: Texture,
    private readonly red: Texture,
  ) {
    this.fill.position.set(BAR_FILL.x, BAR_FILL.y);
    this.root.addChild(new Sprite(frame), this.fill);
    this.root.pivot.set(frame.width / 2, frame.height / 2);
    this.root.scale.set(BAR_SCALE);
  }

  /** Crops the fill to the health fraction; a new texture is made only when it changes. */
  set(fraction: number): void {
    const ratio = Math.min(1, Math.max(0, fraction));
    if (ratio === this.ratio) return;
    this.ratio = ratio;
    this.disposeFill();
    const width = BAR_FILL.w * ratio;
    if (width <= 0) {
      this.fill.visible = false;
      return;
    }
    const art = ratio > 1 / 3 ? this.green : this.red;
    this.fillTexture = new Texture({
      source: art.source,
      frame: new Rectangle(art.frame.x + BAR_FILL.x, art.frame.y + BAR_FILL.y, width, BAR_FILL.h),
    });
    this.fill.texture = this.fillTexture;
    this.fill.visible = true;
  }

  disposeFill(): void {
    this.fill.texture = Texture.EMPTY;
    this.fillTexture?.destroy(false);
    this.fillTexture = null;
  }
}

/** Hull (by damage stage), fire overlay and health bar of one ship. */
class ShipView {
  readonly root = new Container();
  readonly hull = new Sprite({ anchor: 0.5 });
  readonly fire = new Sprite({ anchor: { x: 0.5, y: 0.85 } });
  readonly bar: HealthBar;
  color: ShipColor = 'player';
  stage = -1;

  constructor(bar: HealthBar) {
    this.bar = bar;
    this.root.addChild(this.hull, this.fire, bar.root);
  }
}

type Effect = {
  sprite: Sprite;
  age: number;
  duration: number;
  fromScale: number;
  toScale: number;
  /** Optional frame sequence played over the effect's duration. */
  frames: readonly Texture[] | null;
};

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
  /** Visible health bars (player and enemies). */
  healthBars: number;
  /** Damage stage shown for each ship id (0 = player), 3 = sunk. */
  shipStages: Record<number, number>;
  /** Ships currently showing a fire overlay. */
  fires: number;
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
  private readonly debugLayer: Graphics | null;

  private readonly player: ShipView;
  private readonly enemyViews = new Map<number, ShipView>();
  private readonly enemyPool: ShipView[] = [];
  private readonly projectileSprites = new Map<number, Sprite>();
  private readonly projectilePool: Sprite[] = [];
  private readonly seen = new Set<number>();
  private readonly effects: Effect[] = [];
  private readonly effectPool: Sprite[] = [];
  private readonly bars: HealthBar[] = [];
  private renderTime = 0;

  private readonly ships: GameTextures['ships'];
  private readonly cannonBall: Texture;
  private readonly smallExplosion: Texture;
  private readonly explosionFrames: readonly Texture[];
  private readonly fireFrames: readonly [Texture, Texture];
  private readonly barTextures: { frame: Texture; green: Texture; red: Texture };

  constructor(
    textures: GameTextures,
    private readonly config: GameConfig,
    debugColliders: boolean,
  ) {
    const { ships, tiles, ui, water } = textures;
    this.ships = ships;
    this.cannonBall = getFrame(ships, 'cannon_ball');
    this.smallExplosion = getFrame(ships, 'explosion_3');
    this.explosionFrames = ['explosion_3', 'explosion_2', 'explosion_1'].map((name) =>
      getFrame(ships, name),
    );
    this.fireFrames = [getFrame(ships, 'fire_2'), getFrame(ships, 'fire_1')];
    this.barTextures = {
      frame: getFrame(ui, 'enemy_health_frame'),
      green: getFrame(ui, 'enemy_health_fill_green'),
      red: getFrame(ui, 'enemy_health_fill_red'),
    };

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

    this.player = this.createShipView();
    this.root.addChild(this.enemyLayer, this.player.root, this.projectileLayer, this.effectLayer);

    this.debugLayer = debugColliders ? new Graphics() : null;
    if (this.debugLayer) this.root.addChild(this.debugLayer);
  }

  /** Releases the cropped health bar textures (the scene graph is destroyed by the app). */
  destroy(): void {
    for (const bar of this.bars) bar.disposeFill();
  }

  /** Brings the scene up to date with the simulation and advances visual effects. */
  sync(simulation: Simulation, events: readonly SimEvent[], deltaSeconds: number): void {
    this.renderTime += deltaSeconds;
    const { player } = simulation;
    const sunk = simulation.phase === 'ended' && simulation.endReason === 'death';
    this.drawShip(this.player, 'player', player, sunk ? 3 : damageStage(player.hp, player.maxHp));
    this.player.bar.set(player.hp / player.maxHp);
    this.player.bar.root.visible = !sunk;

    this.seen.clear();
    for (const enemy of simulation.enemies) {
      this.seen.add(enemy.id);
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = this.enemyPool.pop() ?? this.createShipView(this.enemyLayer);
        view.root.visible = true;
        this.enemyViews.set(enemy.id, view);
      }
      this.drawShip(view, enemy.kind, enemy, damageStage(enemy.hp, enemy.maxHp));
      view.bar.set(enemy.hp / enemy.maxHp);
    }
    for (const [id, view] of this.enemyViews) {
      if (this.seen.has(id)) continue;
      view.root.visible = false;
      this.enemyPool.push(view);
      this.enemyViews.delete(id);
    }

    this.seen.clear();
    for (const projectile of simulation.projectiles) {
      this.seen.add(projectile.id);
      let sprite = this.projectileSprites.get(projectile.id);
      if (!sprite) {
        sprite =
          this.projectilePool.pop() ??
          this.projectileLayer.addChild(new Sprite({ texture: this.cannonBall, anchor: 0.5 }));
        sprite.visible = true;
        this.projectileSprites.set(projectile.id, sprite);
      }
      sprite.position.set(projectile.x, projectile.y);
    }
    for (const [id, sprite] of this.projectileSprites) {
      if (this.seen.has(id)) continue;
      sprite.visible = false;
      this.projectilePool.push(sprite);
      this.projectileSprites.delete(id);
    }

    for (const event of events) this.spawnEffects(event);
    this.updateEffects(deltaSeconds);

    if (this.debugLayer) this.drawColliders(this.debugLayer, simulation);
  }

  stats(): RendererStats {
    const views: [number, ShipView][] = [[PLAYER_ID, this.player], ...this.enemyViews];
    return {
      projectileSprites: this.projectileSprites.size,
      pooledProjectileSprites: this.projectilePool.length,
      enemySprites: this.enemyViews.size,
      pooledEnemySprites: this.enemyPool.length,
      effects: this.effects.length,
      pooledEffects: this.effectPool.length,
      dynamicChildren:
        this.enemyLayer.children.length +
        this.projectileLayer.children.length +
        this.effectLayer.children.length,
      healthBars: views.filter(([, view]) => view.bar.root.visible).length,
      shipStages: Object.fromEntries(views.map(([id, view]) => [id, view.stage])),
      fires: views.filter(([, view]) => view.fire.visible).length,
    };
  }

  private createShipView(layer?: Container): ShipView {
    const { frame, green, red } = this.barTextures;
    const bar = new HealthBar(frame, green, red);
    this.bars.push(bar);
    const view = new ShipView(bar);
    layer?.addChild(view.root);
    return view;
  }

  private drawShip(
    view: ShipView,
    color: ShipColor,
    ship: { x: number; y: number; heading: number },
    stage: number,
  ): void {
    if (view.stage !== stage || view.color !== color) {
      view.hull.texture = getFrame(this.ships, shipFrame(color, stage));
      view.color = color;
      view.stage = stage;
    }
    view.root.position.set(ship.x, ship.y);
    view.hull.rotation = ship.heading + SHIP_SPRITE_ROTATION_OFFSET;
    view.bar.root.position.set(0, -BAR_OFFSET_Y);

    // Damaged ships burn: a small flame, then a large flickering one.
    view.fire.visible = stage === 1 || stage === 2;
    if (view.fire.visible) {
      const flicker = Math.floor(this.renderTime * 8) % 2;
      view.fire.texture = stage === 2 && flicker === 0 ? this.fireFrames[1] : this.fireFrames[0];
      view.fire.scale.set(stage === 2 ? 1 : 0.8);
    }
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
        this.sinkWreck(event.kind, event.x, event.y, event.heading);
        this.addEffect(this.smallExplosion, event.x, event.y, 0.6, 0.9, 1.3, this.explosionFrames);
        break;
      case 'matchEnded':
        if (event.reason === 'death') {
          this.addEffect(
            this.smallExplosion,
            event.x,
            event.y,
            0.6,
            0.9,
            1.3,
            this.explosionFrames,
          );
        }
        break;
    }
  }

  /** A destroyed enemy leaves its wreck, which sinks and fades away. */
  private sinkWreck(kind: EnemyKind, x: number, y: number, heading: number): void {
    const wreck = this.addEffect(getFrame(this.ships, shipFrame(kind, 3)), x, y, 1.2, 1, 0.8);
    wreck.rotation = heading + SHIP_SPRITE_ROTATION_OFFSET;
  }

  private addEffect(
    texture: Texture,
    x: number,
    y: number,
    duration: number,
    fromScale: number,
    toScale: number,
    frames: readonly Texture[] | null = null,
  ): Sprite {
    const sprite = this.effectPool.pop() ?? this.effectLayer.addChild(new Sprite({ anchor: 0.5 }));
    sprite.texture = texture;
    sprite.visible = true;
    sprite.rotation = 0;
    sprite.position.set(x, y);
    sprite.scale.set(fromScale);
    sprite.alpha = 1;
    this.effects.push({ sprite, age: 0, duration, fromScale, toScale, frames });
    return sprite;
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
