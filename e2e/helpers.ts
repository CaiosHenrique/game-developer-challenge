import { expect, type Page } from '@playwright/test';
import type { GameStateSnapshot } from '../src/game/testHooks.ts';

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
 * Opens the game on the manual (test-controlled) clock: `clock=manual` makes every match on
 * the page, including ones started with Play Again, begin at tick 0 without advancing.
 */
export async function startGame(page: Page, query = ''): Promise<void> {
  const params = new URLSearchParams(query);
  params.set('clock', 'manual');
  await page.goto(`/?${params.toString()}`);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);
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

/** Waits for a match started from the menu or the Result screen (manual clock from the URL). */
export async function waitForMatch(page: Page): Promise<GameStateSnapshot> {
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);
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
