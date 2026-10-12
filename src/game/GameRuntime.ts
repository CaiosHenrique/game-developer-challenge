import { Application, type Ticker } from 'pixi.js';
import { ARENA_BOUNDS, ISLAND_COLLIDERS, WORLD_HEIGHT, WORLD_WIDTH } from './arena.ts';
import type { GameTextures } from './assets.ts';
import type { GameConfig } from './config.ts';
import { KeyboardInput } from './input.ts';
import { GameRenderer } from './render/GameRenderer.ts';
import { hullCircles, Simulation } from './sim/simulation.ts';
import { installTestHooks, type GameStateSnapshot } from './testHooks.ts';

export type GameRuntimeOptions = {
  /** Draws collision shapes on top of the scene (`?debug=colliders`). */
  debugColliders?: boolean;
};

/**
 * Owns the PixiJS application of one game screen, the input and the fixed-step clock that
 * drives the simulation. `destroy()` may be called before the asynchronous `start()`
 * finishes (React Strict Mode mounts, unmounts and remounts effects), in which case
 * `start()` tears the application down as soon as `init()` resolves.
 */
export class GameRuntime {
  /** Number of initialized runtimes that were not destroyed yet (used to detect leaks). */
  static liveInstances = 0;

  private readonly app = new Application();
  private readonly simulation: Simulation;
  private readonly keyboard = new KeyboardInput();
  private renderer: GameRenderer | null = null;
  /** Real time not yet simulated, in seconds. */
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

    this.renderer = new GameRenderer(
      this.textures,
      this.config.player.hull,
      this.options.debugColliders ?? false,
    );
    this.renderer.sync(this.simulation, [], 0);
    this.app.stage.addChild(this.renderer.root);
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
      step: (count) => this.runSteps(count),
      advance: (ms) =>
        this.runSteps(Math.round((ms / 1000) * this.config.simulation.stepsPerSecond)),
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
    // Stops the ticker, removes the canvas and destroys the scene graph, including pooled
    // sprites. Textures are shared between matches and stay in the asset cache.
    this.app.destroy(true, { children: true });
    this.renderer = null;
    GameRuntime.liveInstances -= 1;
  }

  private readonly onTick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, this.config.simulation.maxFrameSeconds);
    if (!this.manualClock) {
      const stepSeconds = 1 / this.config.simulation.stepsPerSecond;
      this.accumulator += deltaSeconds;
      while (this.accumulator >= stepSeconds) {
        this.simulation.step(this.keyboard.state);
        this.accumulator -= stepSeconds;
      }
    }
    this.renderer?.sync(this.simulation, this.simulation.drainEvents(), deltaSeconds);
  };

  /** Manual clock: runs an exact number of steps and refreshes the scene. */
  private runSteps(count: number): void {
    for (let index = 0; index < count; index += 1) this.simulation.step(this.keyboard.state);
    this.renderer?.sync(this.simulation, this.simulation.drainEvents(), 0);
  }

  private snapshot(): GameStateSnapshot {
    const { player, projectiles } = this.simulation;
    return {
      tick: this.simulation.tick,
      elapsed: this.simulation.elapsed,
      player: { ...player, hull: hullCircles(player, this.config.player.hull) },
      projectiles: projectiles.map((projectile) => ({ ...projectile })),
      weaponReadyAt: { ...this.simulation.weaponReadyAt },
      shotsFired: { ...this.simulation.shotsFired },
      projectilesRemoved: { ...this.simulation.projectilesRemoved },
      islands: ISLAND_COLLIDERS.map((box) => ({ ...box })),
      arena: { ...ARENA_BOUNDS },
      render: this.renderer?.stats() ?? null,
    };
  }

  /** Resizes the renderer to the host and letterboxes the fixed-size world inside it. */
  private fitToHost(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width === 0 || height === 0 || !this.renderer) return;

    this.app.renderer.resize(width, height);
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.renderer.root.scale.set(scale);
    this.renderer.root.position.set(
      (width - WORLD_WIDTH * scale) / 2,
      (height - WORLD_HEIGHT * scale) / 2,
    );
  }
}
