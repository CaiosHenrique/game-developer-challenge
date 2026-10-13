import { expect, test, type Page } from '@playwright/test';
import { focusRing } from './a11y.ts';
import { ignoreFailedResources, overridePut } from './api.ts';
import { collectProblems, finishMatch, getState, startGame } from './helpers.ts';

/** Keyboard focus: where it goes when screens and dialogs open and close, and that it shows. */

const RING = { visible: true, outline: 'solid 3px' };

async function expectFocusRing(page: Page) {
  expect(await focusRing(page)).toEqual(RING);
}

test.describe('keyboard focus', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('Options takes the focus to its first field and gives it back to Options', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
    await page.keyboard.press('Enter');
    const session = page.getByLabel('Game session time (seconds)');
    await expect(session).toBeFocused();
    await expectFocusRing(page);
    await page.keyboard.type('5'); // keys reach the form: no game shortcut is listening
    await expect(session).toHaveValue('1205');

    await page.getByRole('button', { name: 'Main Menu' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
    await expectFocusRing(page);
  });

  test('closing the pause dialog gives the focus back to the pause button', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const pause = page.getByRole('button', { name: 'Pause' });
    await pause.focus();
    await page.keyboard.press('Enter');
    const resume = page.getByRole('button', { name: 'Resume' });
    await expect(resume).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0);
    await expect(pause).toBeFocused();

    // Space is the front gun, also with the focus on the pause button: it fires, not pauses.
    await page.keyboard.down('Space');
    await page.evaluate(() => window.__pirateTest!.step(1));
    await page.keyboard.up('Space');
    const state = await getState(page);
    expect(state.shotsFired.front).toBe(1);
    expect(state.pauseReason).toBeNull();

    // Paused with P, resumed with Esc: the focus comes back to the same button.
    await page.keyboard.press('KeyP');
    await expect(resume).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(pause).toBeFocused();
  });

  test('ranking pages and the scenario panel work with the keyboard, focus visible', async ({
    page,
  }) => {
    await page.goto('/');
    const ranking = page.getByRole('tabpanel', { name: 'Ranking' });
    await expect(ranking.locator('.records-status')).toHaveText('Page 1 of 4');
    const next = ranking.getByRole('button', { name: 'Next ranking page' });
    // Tab order from the selected tab: the ranking's own controls, then the scenario panel.
    await page.getByRole('tab', { name: 'Ranking' }).focus();
    await page.keyboard.press('Tab');
    await expect(next).toBeFocused();
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    await expect(ranking.locator('.records-status')).toHaveText('Page 2 of 4');

    const summary = page.locator('details.mock-panel summary');
    await summary.focus();
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    const select = page.getByLabel('Scenario');
    await expect(select).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(select).toBeFocused();
    await expectFocusRing(page);
    await select.selectOption({ label: 'Slow' }); // a native select (keyboard picker)
    await expect(page.locator('details.mock-panel').getByRole('status')).toHaveText(
      'Scenario set to Slow.',
    );
    await page.keyboard.press('Tab');
    const reset = page.getByRole('button', { name: 'Reset mock data' });
    await expect(reset).toBeFocused();
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    await expect(summary).toHaveText('Network scenarios (mock API)');
  });

  test('a failed submission is retried with the keyboard', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await overridePut(page, '503');
    await finishMatch(page);
    const registration = page.getByTestId('result-registration');
    await expect(registration).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    // The Result screen focuses Play Again; Retry comes just before it.
    await expect(page.getByRole('button', { name: 'Play Again' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeFocused();
    await expectFocusRing(page);
    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    await page.keyboard.press('Enter');
    await expect(registration).toHaveText('Submitted');
    ignoreFailedResources(problems);
  });
});
