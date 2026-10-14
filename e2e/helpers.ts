import { expect, type Page } from '@playwright/test';
import type { GameStateSnapshot, RuntimeLifecycle } from '../src/game/testHooks.ts';

/** Collects console errors/warnings, uncaught exceptions; tests assert it stays empty. */
export function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  return problems;
}

/**
 * How long a match may take to be on screen (assets, then PixiJS initialization). Usually well
 * under a second, but measured up to 5.3 s for a tab left behind another one while six workers
 * run at once (the browser throttles that tab), so the 5 s default of `expect` is too short.
 * A match that never starts still fails.
 */
const MATCH_READY_TIMEOUT = 15_000;

/**
 * Opens the game on the manual (test-controlled) clock: `clock=manual` makes every match on
 * the page, including ones started with Play Again, begin at tick 0 without advancing.
 */
export async function startGame(page: Page, query = ''): Promise<void> {
  const params = new URLSearchParams(query);
  params.set('clock', 'manual');
  await page.goto(`/?${params.toString()}`);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1, {
    timeout: MATCH_READY_TIMEOUT,
  });
  await page.waitForFunction(() => window.__pirateTest !== undefined);
  await page.evaluate(() => window.__pirateTest!.setManualClock(true));
}

export function getState(page: Page): Promise<GameStateSnapshot> {
  return page.evaluate(() => window.__pirateTest!.getState());
}

export async function step(page: Page, count: number): Promise<GameStateSnapshot> {
  return page.evaluate((steps) => {
    window.__pirateTest!.step(steps);
    return window.__pirateTest!.getState();
  }, count);
}

export async function advance(page: Page, ms: number): Promise<GameStateSnapshot> {
  return page.evaluate((duration) => {
    window.__pirateTest!.advance(duration);
    return window.__pirateTest!.getState();
  }, ms);
}

/**
 * Runs single steps until the player (or an enemy) loses health, and returns that state.
 * Throws if no such hit happens within `limit` steps.
 */
export function stepUntilHit(
  page: Page,
  target: 'player' | 'enemy',
  limit = 600,
): Promise<GameStateSnapshot> {
  return page.evaluate(
    ([who, max]) => {
      const api = window.__pirateTest!;
      const startHp = api.getState().player.hp;
      for (let i = 0; i < max; i += 1) {
        api.step(1);
        const state = api.getState();
        const hit =
          who === 'player'
            ? state.player.hp < startHp
            : state.enemies.some((enemy) => enemy.hp < enemy.maxHp);
        if (hit) return state;
      }
      throw new Error(`no ${who} hit within ${max} steps`);
    },
    [target, limit] as const,
  );
}

/** Runtime lifecycle counters of the page (constructed, initialized, destroyed, live…). */
export function lifecycle(page: Page): Promise<RuntimeLifecycle> {
  return page.evaluate(() => window.__pirateLifecycle!.get());
}

/** Waits for a match started from the menu or the Result screen (manual clock from the URL). */
export async function waitForMatch(page: Page): Promise<GameStateSnapshot> {
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1, {
    timeout: MATCH_READY_TIMEOUT,
  });
  await page.waitForFunction(() => window.__pirateTest?.getState().phase === 'running');
  return getState(page);
}

/** Plays out the remaining time of the current match and waits for the Result screen. */
export async function finishMatch(page: Page): Promise<GameStateSnapshot> {
  const ended = await page.evaluate(() => {
    const api = window.__pirateTest!;
    api.step(api.getState().remainingTicks);
    return api.getState();
  });
  await expect(page).toHaveURL(/\/result\?/);
  return ended;
}
