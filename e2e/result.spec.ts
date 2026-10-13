import { expect, test, type Page } from '@playwright/test';
import type { StoredResult } from '../src/storage/localStore.ts';
import { collectProblems, finishMatch, startGame, waitForMatch } from './helpers.ts';

const RESULT_KEY = 'pirate-battle.lastResult.v1';

const storedResult = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as StoredResult | null,
    RESULT_KEY,
  );

/** Counts writes of the stored result during the current page load. */
async function countResultWrites(page: Page) {
  await page.addInitScript((key) => {
    const counter = window as unknown as { resultWrites: number };
    counter.resultWrites = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key) counter.resultWrites += 1;
      return setItem.call(this, name, value);
    };
  }, RESULT_KEY);
}

const resultWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as { resultWrites: number }).resultWrites);

test.describe('result and match lifecycle', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('a finished match is stored once and survives reload, Back and Forward', async ({
    page,
  }) => {
    await countResultWrites(page);
    await startGame(page, '?scenario=open-sea');
    const historyDuringMatch = await page.evaluate(() => history.length);
    await finishMatch(page);
    // The Result screen replaced the /play entry instead of adding one.
    expect(await page.evaluate(() => history.length)).toBe(historyDuringMatch);
    await expect(page.getByTestId('result-saved')).toHaveText('Yes');
    // Once the online ranking confirms the match, its confirmation is recorded on the result.
    await expect(page.getByTestId('result-registration')).toHaveText('Submitted');
    const stored = (await storedResult(page))!;
    expect(stored).toMatchObject({ score: 0, reason: 'time', timePlayedSeconds: 120 });
    expect(Date.parse(stored.finishedAt)).not.toBeNaN();
    expect(Date.parse(stored.submittedAt!)).not.toBeNaN();
    expect(await resultWrites(page)).toBe(2); // the result, then its confirmation

    await page.reload();
    await expect(page).toHaveURL(/\/result\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-time')).toHaveText('02:00');
    expect(await storedResult(page)).toEqual(stored);

    // The Result screen replaced the finished /play entry: Back goes to the menu.
    await page.goBack();
    await expect(page).toHaveURL(/\/\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('heading', { level: 1, name: 'Battle Complete' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await storedResult(page)).toEqual(stored);
    expect(await resultWrites(page)).toBe(0); // reading and navigating never write
  });

  test('abandoning a match never stores a result', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    const stored = await storedResult(page);

    // Main Menu during a match.
    await page.getByRole('button', { name: 'Play Again' }).click();
    await waitForMatch(page);
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await storedResult(page)).toEqual(stored);

    // Back during a match, then Forward to the abandoned /play: no new game.
    await page.getByRole('button', { name: 'Play' }).click();
    await waitForMatch(page);
    await page.goBack();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/\?/); // redirected home
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pirateTest === undefined)).toBe(true);

    // Reload during a match.
    await page.getByRole('button', { name: 'Play' }).click();
    await waitForMatch(page);
    await page.reload();
    await expect(page).toHaveURL(/\/\?/);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await storedResult(page)).toEqual(stored);
  });

  test('opening /play directly never creates a game', async ({ page }) => {
    await page.addInitScript(() => {
      const seen = window as unknown as { canvasSeen: boolean };
      seen.canvasSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('canvas')) seen.canvasSeen = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/play?scenario=open-sea&clock=manual');
    await expect(page).toHaveURL(/\/\?/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => (window as unknown as { canvasSeen: boolean }).canvasSeen),
    ).toBe(false);
    expect(await page.evaluate(() => window.__pirateTest === undefined)).toBe(true);
  });

  test('without storage the result is shown for the session, never as saved', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      };
      Storage.prototype.getItem = () => {
        throw new DOMException('Storage is blocked', 'SecurityError');
      };
    });
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-saved')).toHaveText('No — kept for this session only');
    await expect(page.getByRole('alert')).toContainText('could not be saved on this device');

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'No battle yet' })).toBeVisible();
    // The mock API still starts (in memory), so the console stays clean.
  });

  test('repeated menu, game and result navigation keeps a single game alive', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    for (let round = 0; round < 3; round += 1) {
      const state = await waitForMatch(page);
      expect(state.liveRuntimes).toBe(1);
      await finishMatch(page);
      await expect(page.locator('canvas')).toHaveCount(0);
      await page.getByRole('button', { name: 'Play Again' }).click();
    }
    expect((await waitForMatch(page)).liveRuntimes).toBe(1);
  });
});
