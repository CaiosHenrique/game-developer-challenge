import { Application, Container, Graphics, Sprite, TilingSprite, type Ticker } from 'pixi.js';
import {
  ARENA_BOUNDS,
  ISLAND_COLLIDERS,
  ISLAND_FRAMES,
  ISLANDS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './arena.ts';
import { getFrame, SHIP_FRAMES, type GameTextures } from './assets.ts';
import type { GameConfig } from './config.ts';
import { KeyboardInput } from './input.ts';
import { hullCircles, Simulation } from './sim/simulation.ts';
import { installTestHooks } from './testHooks.ts';

/** Ship sprites point down (+Y) in the source art; heading 0 points up. */
const SHIP_SPRITE_ROTATION_OFFSET = Math.PI;

export type GameRuntimeOptions = {
  /** Draws collision shapes on top of the scene (`?debug=colliders`). */
  debugColliders?: boolean;
};

/**
 * Owns the PixiJS application of one game screen and drives the simulation with a
 * fixed-step clock. `destroy()` may be called before the asynchronous `start()` finishes
 * (React Strict Mode mounts, unmounts and remounts effects), in which case `start()` tears
 * the application down as soon as `init()` resolves.
 */
export class GameRuntime {
  /** Number of initialized runtimes that were not destroyed yet (used to detect leaks). */
  static liveInstances = 0;

  private readonly app = new Application();
  private readonly world = new Container();
  private readonly simulation: Simulation;
  private readonly keyboard = new KeyboardInput();
  private playerSprite: Sprite | null = null;
  private debugLayer: Graphics | null = null;
  private accumulator = 0;
  private manualClock = false;
  private initialized = false;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private uninstallTestHooks: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly textures: GameTextures,
    private readonly config: GameConfig,
    private readonly options: GameRuntimeOptions = {},
  ) {
    this.simulation = new Simulation(config);
  }

  async start(): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      background: '#0d1b2a',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
    });

    if (this.disposed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.initialized = true;
    GameRuntime.liveInstances += 1;

    this.buildScene();
    this.app.stage.addChild(this.world);
    this.host.appendChild(this.app.canvas);

    this.resizeObserver = new ResizeObserver(() => this.fitToHost());
    this.resizeObserver.observe(this.host);
    this.fitToHost();

    this.keyboard.attach(window);
    this.app.ticker.add(this.onTick);
    this.uninstallTestHooks = installTestHooks({
      getState: () => this.snapshot(),
      setManualClock: (enabled) => {
        this.manualClock = enabled;
        this.accumulator = 0;
      },
      advance: (ms) => this.advance(ms / 1000),
    });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Not initialized yet: start() finishes the cleanup when init() resolves.
    if (!this.initialized) return;

    this.uninstallTestHooks?.();
    this.keyboard.detach();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // Stops the ticker, removes the canvas and destroys the scene graph. Textures are shared
    // between matches and stay in the asset cache.
    this.app.destroy(true, { children: true });
    GameRuntime.liveInstances -= 1;
  }

  private readonly onTick = (ticker: Ticker): void => {
    if (!this.manualClock) {
      this.advance(Math.min(ticker.deltaMS / 1000, this.config.simulation.maxFrameSeconds));
    }
    this.render();
  };

  /** Runs as many fixed simulation steps as the elapsed time covers. */
  private advance(seconds: number): void {
    const step = this.config.simulation.stepSeconds;
    this.accumulator += seconds;
    // The epsilon absorbs floating-point error, so e.g. 500 ms is exactly 30 steps.
    while (this.accumulator >= step - 1e-9) {
      this.simulation.step(step, this.keyboard.state);
      this.accumulator -= step;
    }
  }

  private render(): void {
    const player = this.simulation.player;
    if (this.playerSprite) {
      this.playerSprite.position.set(player.x, player.y);
      this.playerSprite.rotation = player.heading + SHIP_SPRITE_ROTATION_OFFSET;
    }
    if (this.debugLayer) this.drawColliders(this.debugLayer);
  }

  private buildScene(): void {
    const { ships, tiles, water } = this.textures;

    this.world.addChild(
      new TilingSprite({ texture: water, width: WORLD_WIDTH, height: WORLD_HEIGHT }),
    );

    for (const island of ISLANDS) {
      const sprite = new Sprite({
        texture: getFrame(tiles, ISLAND_FRAMES[island.kind]),
        anchor: 0.5,
      });
      sprite.position.set(island.x, island.y);
      this.world.addChild(sprite);
    }

    this.playerSprite = new Sprite({ texture: getFrame(ships, SHIP_FRAMES.player), anchor: 0.5 });
    this.world.addChild(this.playerSprite);

    if (this.options.debugColliders) {
      this.debugLayer = new Graphics();
      this.world.addChild(this.debugLayer);
    }
    this.render();
  }

  private drawColliders(graphics: Graphics): void {
    graphics.clear();
    for (const box of ISLAND_COLLIDERS) {
      graphics.rect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    }
    for (const circle of hullCircles(this.simulation.player, this.config.player.hull)) {
      graphics.circle(circle.x, circle.y, circle.radius);
    }
    graphics.stroke({ width: 2, color: 0xff3366 });
  }

  private snapshot() {
    const player = this.simulation.player;
    return {
      elapsed: this.simulation.elapsed,
      player: { ...player, hull: hullCircles(player, this.config.player.hull) },
      islands: ISLAND_COLLIDERS.map((box) => ({ ...box })),
      arena: { ...ARENA_BOUNDS },
    };
  }

  /** Resizes the renderer to the host and letterboxes the fixed-size world inside it. */
  private fitToHost(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0) return;

    this.app.renderer.resize(width, height);
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.world.scale.set(scale);
    this.world.position.set((width - WORLD_WIDTH * scale) / 2, (height - WORLD_HEIGHT * scale) / 2);
  }
}
