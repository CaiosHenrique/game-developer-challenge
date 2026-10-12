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

/** Opens the game and switches the simulation to the manual (test-controlled) clock. */
export async function startGame(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);
  await page.waitForFunction(() => window.__pirateTest !== undefined);
  await page.evaluate(() => window.__pirateTest!.setManualClock(true));
}

export function getState(page: Page): Promise<GameStateSnapshot> {
  return page.evaluate(() => window.__pirateTest!.getState());
}

export async function advance(page: Page, ms: number): Promise<GameStateSnapshot> {
  return page.evaluate((duration) => {
    window.__pirateTest!.advance(duration);
    return window.__pirateTest!.getState();
  }, ms);
}
