import { expect, test, type Locator, type Page } from '@playwright/test';
import { STORAGE_KEYS } from '../src/storage/localStore.ts';
import { ignoreFailedResources, lastResult, overridePut, serverCopies } from './api.ts';
import { collectProblems, finishMatch, waitForMatch } from './helpers.ts';

/**
 * Ranking, history, match submission and the network-scenario panel on a phone held in
 * landscape, by touch. The desktop specs cover the data rules; these cover what can break
 * on a small touch screen: tapping each control, reaching it, and no sideways scrolling.
 */

const rankingPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Ranking' });
const historyPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Match History' });
const pageStatus = (panel: Locator) => panel.locator('.records-status');
const registration = (page: Page) => page.getByTestId('result-registration');
const pendingBand = (page: Page) =>
  page.getByRole('region', { name: 'Battles waiting to be submitted' });
const scenarioPanel = (page: Page) => page.locator('details.mock-panel');

/** The page never scrolls sideways. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A control the player can reach: inside the screen's width once scrolled into view. */
async function expectReachable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const box = (await control.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
}

/** Plays a match to its end on the manual clock, starting it with a tap on Play. */
async function playToTheEnd(page: Page) {
  await page.goto('/?scenario=open-sea&clock=manual');
  await page.getByRole('button', { name: 'Play' }).tap();
  await waitForMatch(page);
  await finishMatch(page);
}

test.describe('ranking and history on a phone', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('tabs and pages are used by touch, without sideways scrolling', async ({ page }) => {
    await page.goto('/');
    const ranking = rankingPanel(page);
    await expect(pageStatus(ranking)).toHaveText('Page 1 of 4');
    await expectNoSidewaysScroll(page);

    const next = ranking.getByRole('button', { name: 'Next ranking page' });
    await expectReachable(page, next);
    await next.tap();
    await expect(pageStatus(ranking)).toHaveText('Page 2 of 4');
    await expect(ranking.locator('tbody tr').first().locator('td').first()).toHaveText('11');
    await ranking.getByRole('button', { name: 'Previous ranking page' }).tap();
    await expect(pageStatus(ranking)).toHaveText('Page 1 of 4');

    const historyTab = page.getByRole('tab', { name: 'Match History' });
    await expectReachable(page, historyTab);
    await historyTab.tap();
    await expect(historyTab).toHaveAttribute('aria-selected', 'true');
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');
    await page.getByRole('tab', { name: 'Ranking' }).tap();
    await expect(pageStatus(ranking)).toHaveText('Page 1 of 4');
    await expectNoSidewaysScroll(page);
  });

  test('a submitted match appears in the history', async ({ page }) => {
    await playToTheEnd(page);
    await expect(registration(page)).toHaveText('Submitted');
    const { matchId } = (await lastResult(page))!;
    await expectNoSidewaysScroll(page);

    await page.getByRole('button', { name: 'Main Menu' }).tap();
    await page.getByRole('tab', { name: 'Match History' }).tap();
    const rows = historyPanel(page).locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('02:00Time up');
    expect(await serverCopies(page, matchId)).toBe(1);
    await expectNoSidewaysScroll(page);
  });

  test('a failed submission survives Reset and is sent from the pending band', async ({ page }) => {
    await page.goto('/?scenario=open-sea&clock=manual');
    await page.waitForFunction(() => window.__pirateMocks !== undefined);
    await overridePut(page, '503');
    await page.getByRole('button', { name: 'Play' }).tap();
    await waitForMatch(page);
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Not submitted yet: Down for repairs.', {
      timeout: 10_000,
    });
    const { matchId } = (await lastResult(page))!;
    expect(await serverCopies(page, matchId)).toBe(0);
    await page.getByRole('button', { name: 'Main Menu' }).tap();

    // The scenario panel opens by touch; Reset brings back Normal and the initial data.
    const panel = scenarioPanel(page);
    const summary = panel.locator('summary');
    await expectReachable(page, summary);
    await summary.tap();
    await panel.getByLabel('Scenario').selectOption({ label: 'Empty lists' });
    await expect(summary).toHaveText('Network scenarios (mock API): Empty lists');
    await expect(rankingPanel(page)).toContainText('No battles recorded with these options yet.');
    const kept = async () => ({
      queue: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.pendingMatches),
      result: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.lastResult),
      player: await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.player),
    });
    const before = await kept();
    const reset = panel.getByRole('button', { name: 'Reset mock data' });
    await expectReachable(page, reset);
    await reset.tap();
    await expect(summary).toHaveText('Network scenarios (mock API)');
    await expect(pageStatus(rankingPanel(page))).toHaveText('Page 1 of 4');
    expect(await kept()).toEqual(before);

    // The match was not lost: it waits in the history, and is sent once the server works.
    await page.getByRole('tab', { name: 'Match History' }).tap();
    const band = pendingBand(page);
    await expect(band.getByRole('status')).toHaveText('1 battle waiting to be submitted');
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');
    await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
    const retry = band.getByRole('button', { name: 'Retry' });
    await expectReachable(page, retry);
    await retry.tap();
    await expect(band).toHaveCount(0);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    expect(await serverCopies(page, matchId)).toBe(1);
    await expectNoSidewaysScroll(page);
    ignoreFailedResources(problems);
  });
});
