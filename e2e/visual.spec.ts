import { expect, test } from '@playwright/test';
import { collectProblems, finishMatch, startGame } from './helpers.ts';
import { openStableArena, SCREENSHOT, settleVisuals } from './visual.ts';

/**
 * Visual regression of the main screens (desktop). Baselines are Windows + Microsoft Edge
 * screenshots, versioned next to this file: see docs/TESTING.md before updating them.
 */
test.describe('visual regression', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('main menu', async ({ page }) => {
    await page.goto('/');
    const ranking = page.getByRole('tabpanel', { name: 'Ranking' });
    // Fixture data only: page 1 of the default setup, no match of this (random) player.
    await expect(ranking.locator('.records-status')).toHaveText('Page 1 of 4');
    await expect(ranking.locator('tbody tr')).toHaveCount(10);
    await expect(ranking.locator('.records-own')).toHaveCount(0);
    await expect(page.locator('details.mock-panel')).not.toHaveAttribute('open');
    await settleVisuals(page);
    await expect(page).toHaveScreenshot('menu.png', SCREENSHOT);
  });

  test('arena in a stable state', async ({ page }) => {
    await openStableArena(page);
    await expect(page).toHaveScreenshot('arena.png', SCREENSHOT);
  });

  test('result of a match ended by time', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-registration')).toHaveText('Submitted');
    await settleVisuals(page);
    await expect(page).toHaveScreenshot('result.png', SCREENSHOT);
  });
});
