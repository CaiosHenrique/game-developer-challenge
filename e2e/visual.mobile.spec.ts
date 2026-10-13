import { expect, test } from '@playwright/test';
import { collectProblems } from './helpers.ts';
import { openStableArena, SCREENSHOT } from './visual.ts';

/**
 * Visual regression on a phone held in landscape (the mobile project): the arena with the
 * touch controls. Baselines are Windows + Microsoft Edge: see docs/TESTING.md.
 */
test.describe('visual regression (mobile)', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('arena with the touch controls', async ({ page }) => {
    await openStableArena(page);
    await expect(page.getByTestId('touch-controls')).toBeAttached();
    await expect(page.getByRole('button', { name: 'Sail forward', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fire front gun', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('arena-touch.png', SCREENSHOT);
  });
});
