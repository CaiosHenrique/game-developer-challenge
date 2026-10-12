import { Application, Container, Sprite, TilingSprite } from 'pixi.js';
import { ISLAND_FRAMES, ISLANDS, PLAYER_START, WORLD_HEIGHT, WORLD_WIDTH } from './arena.ts';
import { getFrame, SHIP_FRAMES, type GameTextures } from './assets.ts';

/** Ship sprites point down (+Y) in the source art; this rotation makes heading 0 point up. */
const SHIP_SPRITE_ROTATION = Math.PI;

/**
 * Owns the PixiJS application of one game screen. `destroy()` may be called before the
 * asynchronous `start()` finishes (React Strict Mode mounts, unmounts and remounts effects),
 * in which case `start()` tears the application down as soon as `init()` resolves.
 */
export class GameRuntime {
  /** Number of initialized runtimes that were not destroyed yet (used to detect leaks). */
  static liveInstances = 0;

  private readonly app = new Application();
  private readonly world = new Container();
  private initialized = false;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly textures: GameTextures,
  ) {}

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
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Not initialized yet: start() finishes the cleanup when init() resolves.
    if (!this.initialized) return;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // Removes the canvas and destroys the scene graph. Textures are shared between
    // matches and stay in the asset cache.
    this.app.destroy(true, { children: true });
    GameRuntime.liveInstances -= 1;
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

    const player = new Sprite({ texture: getFrame(ships, SHIP_FRAMES.player), anchor: 0.5 });
    player.position.set(PLAYER_START.x, PLAYER_START.y);
    player.rotation = SHIP_SPRITE_ROTATION;
    this.world.addChild(player);
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
