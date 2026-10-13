import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './a11y.ts';
import { collectProblems, startGame, step } from './helpers.ts';

/** Accessibility scan (axe) of a match on a phone: HUD and touch controls. */
test.describe('accessibility scans (mobile)', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('match with the touch controls', async ({ page }, testInfo) => {
    await startGame(page, '?scenario=skirmish');
    await step(page, 20);
    await expect(page.getByRole('button', { name: 'Sail forward', exact: true })).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'match with touch controls');
  });
});
