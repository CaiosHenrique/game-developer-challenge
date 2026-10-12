import type { EndReason, MatchPhase } from './sim/simulation.ts';

export type MatchResult = {
  reason: EndReason;
  score: number;
  /** Active play time, in seconds (exact: end tick / steps per second). */
  timePlayedSeconds: number;
};

/** What the React HUD shows. Every field changes rarely, never once per frame. */
export type HudState = {
  hp: number;
  maxHp: number;
  score: number;
  /** Whole seconds left on the timer (rounded up). */
  remainingSeconds: number;
  phase: MatchPhase;
  result: MatchResult | null;
};

function sameHud(a: HudState, b: HudState): boolean {
  return (
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.score === b.score &&
    a.remainingSeconds === b.remainingSeconds &&
    a.phase === b.phase &&
    a.result === b.result
  );
}

/**
 * Bridge between the game loop and React (`useSyncExternalStore`). The runtime offers a new
 * state every frame; listeners are notified only when a displayed value actually changed.
 */
export class HudStore {
  private state: HudState;
  private readonly listeners = new Set<() => void>();
  /** Number of notified changes, observed by tests to prove there is no per-frame update. */
  emissions = 0;

  constructor(initial: HudState) {
    this.state = initial;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): HudState => this.state;

  /** Publishes `next` only if it differs from the current state. */
  offer(next: HudState): void {
    if (sameHud(this.state, next)) return;
    this.state = next;
    this.emissions += 1;
    this.listeners.forEach((listener) => listener());
  }
}
