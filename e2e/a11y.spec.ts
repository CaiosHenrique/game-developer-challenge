import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, textContrastOverImage } from './a11y.ts';
import { ignoreFailedResources, overridePut } from './api.ts';
import { collectProblems, finishMatch, startGame, step } from './helpers.ts';

/** Accessibility scans (axe) of every main screen and state, on desktop. */

async function openScenarioPanel(page: Page) {
  const panel = page.locator('details.mock-panel');
  await panel.locator('summary').click();
  await expect(panel.getByLabel('Scenario')).toBeVisible();
}

test.describe('accessibility scans', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('menu: ranking and history tabs, scenario panel open', async ({ page }, testInfo) => {
    await page.goto('/');
    const ranking = page.getByRole('tabpanel', { name: 'Ranking' });
    await expect(ranking.locator('.records-status')).toHaveText('Page 1 of 4');
    await openScenarioPanel(page);
    await expectNoAxeViolations(page, testInfo, 'menu, ranking tab');

    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Match History' })).toContainText(
      'No battles recorded yet.',
    );
    await expectNoAxeViolations(page, testInfo, 'menu, history tab');
  });

  test('options: the form, and the form with validation errors', async ({ page }, testInfo) => {
    await page.goto('/options');
    await expect(page.getByLabel('Game session time (seconds)')).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'options');

    await page.getByLabel('Game session time (seconds)').fill('20');
    await page.getByLabel('Enemy spawn time (seconds)').fill('0.3');
    await expect(page.locator('.form-error').first()).not.toBeEmpty();
    await expectNoAxeViolations(page, testInfo, 'options with errors');
  });

  test('match: HUD and game controls', async ({ page }, testInfo) => {
    await startGame(page, '?scenario=skirmish');
    await step(page, 20);
    await expect(page.getByRole('region', { name: 'Match status' })).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'match');
  });

  test('HUD text drawn over its art keeps a WCAG AA contrast', async ({ page }) => {
    await startGame(page, '?scenario=skirmish');
    await step(page, 20);
    // axe cannot measure text over images: measured against the pixels behind the glyphs.
    // 4.5:1 for the health label (normal text), 3:1 for the large, bold counters.
    expect(await textContrastOverImage(page, '.hud-bar-label')).toBeGreaterThanOrEqual(4.5);
    expect(
      await textContrastOverImage(page, '.hud-score .hud-counter-value'),
    ).toBeGreaterThanOrEqual(3);
    expect(
      await textContrastOverImage(page, '.hud-time .hud-counter-value'),
    ).toBeGreaterThanOrEqual(3);
  });

  test('pause dialog', async ({ page }, testInfo) => {
    await startGame(page, '?scenario=open-sea');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
    await expectNoAxeViolations(page, testInfo, 'pause dialog');
  });

  test('result: submitted', async ({ page }, testInfo) => {
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    await expect(page.getByTestId('result-registration')).toHaveText('Submitted');
    await expectNoAxeViolations(page, testInfo, 'result, submitted');
  });

  test('result: submission failed, then a conflict', async ({ page }, testInfo) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    await expect(page.getByTestId('result-registration')).toHaveText(
      'Not submitted yet: Down for repairs.',
      { timeout: 10_000 },
    );
    await expectNoAxeViolations(page, testInfo, 'result, submission failed');

    await overridePut(page, '409');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('result-registration')).toHaveText(
      'Conflict: the online ranking holds a different record for this match.',
    );
    await expectNoAxeViolations(page, testInfo, 'result, conflict');
    ignoreFailedResources(problems);
  });
});
