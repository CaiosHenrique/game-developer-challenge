import { Application, type Ticker } from 'pixi.js';
import { ARENA_BOUNDS, ISLAND_COLLIDERS, WORLD_HEIGHT, WORLD_WIDTH } from './arena.ts';
import type { GameTextures } from './assets.ts';
import type { GameConfig } from './config.ts';
import { announcementFor } from './announcements.ts';
import { HudStore, type HudState, type MatchResult, type PauseReason } from './hudStore.ts';
import { KeyboardInput } from './input.ts';
import { GameRenderer } from './render/GameRenderer.ts';
import { hullCircles, Simulation, type SimulationOptions } from './sim/simulation.ts';
import { installTestHooks, type GameStateSnapshot } from './testHooks.ts';

export type GameRuntimeOptions = {
  /** Draws collision shapes on top of the scene (`?debug=colliders`). */
  debugColliders?: boolean;
  /** Starting situation of the match (fixed test scenarios). */
  simulation?: SimulationOptions;
  /** Start on the manual clock: the simulation only advances through test hooks. */
  manualClock?: boolean;
};

/**
 * Owns the PixiJS application of one match, the input and the fixed-step clock that drives
 * the simulation, and publishes the HUD state to React. `destroy()` may be called before
 * the asynchronous `start()` finishes (React Strict Mode mounts, unmounts and remounts
 * effects), in which case `start()` tears the application down as soon as `init()` resolves.
 */
export class GameRuntime {
  /** Number of initialized runtimes that were not destroyed yet (used to detect leaks). */
  static liveInstances = 0;

  private readonly app = new Application();
  /** This match's own copy of the configuration: later changes apply to new matches only. */
  private readonly config: GameConfig;
  private readonly simulation: Simulation;
  private readonly keyboard = new KeyboardInput();
  private renderer: GameRenderer | null = null;
  private result: MatchResult | null = null;
  private pauseReason: PauseReason | null = null;
  /** After a resume, the first frame's delta is dropped so no paused time is simulated. */
  private discardNextDelta = false;
  private announcement = '';
  private lowHealthAnnounced = false;
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
    config: GameConfig,
    readonly hud: HudStore,
    private readonly options: GameRuntimeOptions = {},
  ) {
    this.config = structuredClone(config);
    this.manualClock = options.manualClock ?? false;
    // Randomness enters the simulation only through its seed, chosen here per match.
    const seed = options.simulation?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
    this.simulation = new Simulation(this.config, { ...options.simulation, seed });
    this.hud.offer(this.hudState());
  }

  /** Initial HUD state for a match played with `config`, before the runtime exists. */
  static initialHud(config: GameConfig): HudState {
    return {
      hp: config.player.maxHp,
      maxHp: config.player.maxHp,
      score: 0,
      remainingSeconds: config.match.durationSeconds,
      phase: 'running',
      result: null,
      pauseReason: null,
      announcement: '',
    };
  }

  /** Pauses the match (no-op when already paused or over). Game keys are released. */
  pause(reason: PauseReason): void {
    if (this.pauseReason || this.simulation.phase === 'ended' || !this.initialized) return;
    if (this.disposed) return;
    this.pauseReason = reason;
    this.keyboard.detach();
    this.hud.offer(this.hudState());
  }

  /**
   * Resumes after a player action only. Nothing from the pause carries over: held keys must
   * be pressed again, and no paused time is simulated.
   */
  resume(): void {
    if (!this.pauseReason || this.disposed) return;
    this.pauseReason = null;
    this.accumulator = 0;
    this.discardNextDelta = true;
    this.keyboard.attach(window);
    this.hud.offer(this.hudState());
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
      this.config,
      this.options.debugColliders ?? false,
    );
    this.renderer.sync(this.simulation, [], 0);
    this.app.stage.addChild(this.renderer.root);
    this.host.appendChild(this.app.canvas);

    this.resizeObserver = new ResizeObserver(() => this.fitToHost());
    this.resizeObserver.observe(this.host);
    this.fitToHost();

    this.keyboard.attach(window);
    window.addEventListener('keydown', this.onPauseKey);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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
    window.removeEventListener('keydown', this.onPauseKey);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // Stops the ticker, removes the canvas and destroys the scene graph, including pooled
    // sprites. Textures are shared between matches and stay in the asset cache.
    this.renderer?.destroy();
    this.app.destroy(true, { children: true });
    this.renderer = null;
    GameRuntime.liveInstances -= 1;
  }

  /** P or Escape toggles the pause while the match is running. */
  private readonly onPauseKey = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyP' && event.code !== 'Escape') return;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.simulation.phase === 'ended') return;
    event.preventDefault();
    if (this.pauseReason) this.resume();
    else this.pause('manual');
  };

  private readonly onWindowBlur = (): void => this.pause('blur');

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.pause('hidden');
  };

  private readonly onTick = (ticker: Ticker): void => {
    if (this.pauseReason) {
      // Paused: no simulated time, and effects stand still.
      this.present(0);
      return;
    }
    let deltaSeconds = Math.min(ticker.deltaMS / 1000, this.config.simulation.maxFrameSeconds);
    if (this.discardNextDelta) {
      this.discardNextDelta = false;
      deltaSeconds = 0;
    }
    if (!this.manualClock) {
      const stepSeconds = 1 / this.config.simulation.stepsPerSecond;
      this.accumulator += deltaSeconds;
      while (this.accumulator >= stepSeconds) {
        this.simulation.step(this.keyboard.state);
        this.accumulator -= stepSeconds;
      }
    }
    this.present(deltaSeconds);
  };

  /** Manual clock: runs an exact number of steps and refreshes the scene. */
  private runSteps(count: number): void {
    // A paused match does not advance, whichever clock drives it.
    const steps = this.pauseReason ? 0 : count;
    for (let index = 0; index < steps; index += 1) this.simulation.step(this.keyboard.state);
    this.present(0);
  }

  /** Draws the scene and publishes the HUD state after the simulation advanced. */
  private present(deltaSeconds: number): void {
    this.renderer?.sync(this.simulation, this.simulation.drainEvents(), deltaSeconds);
    if (this.simulation.phase === 'ended' && !this.result) {
      // The match is over: stop capturing game keys so the end panel can use them.
      this.keyboard.detach();
      this.result = {
        reason: this.simulation.endReason!,
        score: this.simulation.score,
        timePlayedSeconds: this.simulation.endTick! / this.config.simulation.stepsPerSecond,
      };
    }
    this.hud.offer(this.hudState());
  }

  private hudState(): HudState {
    const { player, score, phase, endReason } = this.simulation;
    const remainingSeconds = Math.ceil(
      this.simulation.remainingTicks / this.config.simulation.stepsPerSecond,
    );
    const previous = this.hud.getSnapshot();
    const message = announcementFor(
      {
        ...previous,
        endReason: previous.result?.reason ?? null,
        paused: previous.pauseReason !== null,
      },
      {
        hp: player.hp,
        maxHp: player.maxHp,
        score,
        remainingSeconds,
        phase,
        endReason,
        paused: this.pauseReason !== null,
      },
      this.lowHealthAnnounced,
    );
    if (message) {
      this.announcement = message;
      if (message === 'Health low.') this.lowHealthAnnounced = true;
    }
    return {
      hp: player.hp,
      maxHp: player.maxHp,
      score,
      remainingSeconds,
      phase,
      result: this.result,
      pauseReason: this.pauseReason,
      announcement: this.announcement,
    };
  }

  private snapshot(): GameStateSnapshot {
    const { player, enemies, projectiles } = this.simulation;
    return {
      seed: this.simulation.seed,
      rngState: this.simulation.rngState,
      spawns: this.simulation.spawner?.spawns.map((record) => ({ ...record })) ?? [],
      spawnStats: this.simulation.spawner?.getStats() ?? null,
      phase: this.simulation.phase,
      endReason: this.simulation.endReason,
      endTick: this.simulation.endTick,
      durationTicks: this.simulation.durationTicks,
      remainingTicks: this.simulation.remainingTicks,
      hud: { ...this.hud.getSnapshot() },
      hudEmissions: this.hud.emissions,
      pauseReason: this.pauseReason,
      liveRuntimes: GameRuntime.liveInstances,
      tick: this.simulation.tick,
      elapsed: this.simulation.elapsed,
      player: { ...player, hull: hullCircles(player, this.config.player.hull) },
      enemies: enemies.map((enemy) => ({
        ...enemy,
        hull: hullCircles(enemy, this.config.enemies[enemy.kind].hull),
      })),
      score: this.simulation.score,
      enemiesDestroyed: { ...this.simulation.enemiesDestroyed },
      enemyShotsFired: this.simulation.enemyShotsFired,
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
