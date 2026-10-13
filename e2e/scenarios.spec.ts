import { expect, test, type Page } from '@playwright/test';
import type { MatchRecord } from '../src/api/contracts.ts';
import { compareRanking, MOCK_DB_KEY } from '../src/mocks/db.ts';
import { fixtureRecords } from '../src/mocks/fixtures.ts';
import { SCENARIO_KEY } from '../src/mocks/scenarioChoice.ts';
import { STORAGE_KEYS, type StoredResult } from '../src/storage/localStore.ts';
import { collectProblems, finishMatch, startGame, waitForMatch } from './helpers.ts';

test.use({ timezoneId: 'UTC', locale: 'en-US' });

const panel = (page: Page) => page.locator('details.mock-panel');
const summary = (page: Page) => panel(page).locator('summary');
const scenarioSelect = (page: Page) => panel(page).getByLabel('Scenario');
const rankingPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Ranking' });
const historyPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Match History' });
const pageStatus = (tab: ReturnType<typeof rankingPanel>) => tab.locator('.records-status');
const registration = (page: Page) => page.getByTestId('result-registration');

declare global {
  interface Window {
    /** URLs of the API requests seen by the mock API since `trackApi`. */
    __apiCalls?: string[];
  }
}

/** Starts recording every request the mock API receives (including ones later aborted). */
async function trackApi(page: Page) {
  await page.waitForFunction(() => window.__pirateMocks !== undefined);
  await page.evaluate(() => {
    window.__apiCalls = [];
    window.__pirateMocks!.worker.events.on('request:start', ({ request }) => {
      window.__apiCalls!.push(new URL(request.url).pathname);
    });
  });
}

/** How many recorded requests went to an API path. */
const apiRequests = (page: Page, path: string) =>
  page.evaluate(
    (prefix) => window.__apiCalls!.filter((pathname) => pathname.startsWith(prefix)).length,
    path,
  );

/** Opens the menu with a scenario, recording requests from the very first one. */
async function openMenu(page: Page, query: string) {
  await page.goto(`/options${query}`);
  await trackApi(page);
  await page.getByRole('button', { name: 'Main Menu' }).click();
}

const stored = (page: Page, key: string) =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

async function chooseScenario(page: Page, label: string) {
  if (!(await panel(page).evaluate((element: HTMLDetailsElement) => element.open))) {
    await summary(page).click();
  }
  await scenarioSelect(page).selectOption({ label });
  await expect(panel(page).getByRole('status')).toHaveText(`Scenario set to ${label}.`);
}

/** How many records the mock server holds for one match. */
function serverCopies(page: Page, matchId: string): Promise<number> {
  return page.evaluate(
    ({ matchId, playerKey }) => {
      const { playerId } = JSON.parse(localStorage.getItem(playerKey)!) as { playerId: string };
      return window
        .__pirateMocks!.db.playerMatches(playerId, 1, 50)
        .items.filter((match) => match.matchId === matchId).length;
    },
    { matchId, playerKey: STORAGE_KEYS.player },
  );
}

const lastResult = (page: Page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null') as StoredResult | null,
    STORAGE_KEYS.lastResult,
  );

test.describe('network scenarios', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  /** Error responses make the browser log "Failed to load resource"; the app handles them. */
  function ignoreFailedResources() {
    problems.splice(
      0,
      problems.length,
      ...problems.filter((message) => !message.startsWith('Failed to load resource')),
    );
  }

  test('the panel chooses a scenario that survives a reload; a valid ?api= wins', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(summary(page)).toHaveText('Network scenarios (mock API)');
    await expect(scenarioSelect(page)).toBeHidden(); // collapsed
    // Keyboard: the summary opens the panel.
    await summary(page).focus();
    await page.keyboard.press('Enter');
    await expect(scenarioSelect(page)).toBeVisible();
    await chooseScenario(page, 'Empty lists');
    await expect(summary(page)).toHaveText('Network scenarios (mock API): Empty lists');
    await expect(rankingPanel(page)).toContainText('No battles recorded with these options yet.');
    expect(await stored(page, SCENARIO_KEY)).toBe('empty');

    await page.reload();
    await expect(summary(page)).toHaveText('Network scenarios (mock API): Empty lists');
    await page.goto('/?api=slow');
    await expect(summary(page)).toHaveText('Network scenarios (mock API): Slow');
    await page.goto('/'); // kept without the parameter
    await expect(summary(page)).toHaveText('Network scenarios (mock API): Slow');
    await page.goto('/?api=no-such-scenario'); // ignored: the saved one stays
    await expect(summary(page)).toHaveText('Network scenarios (mock API): Slow');
    expect(await stored(page, SCENARIO_KEY)).toBe('slow');
  });

  test('empty and many-pages lists never change the stored data', async ({ page }) => {
    await page.goto('/?api=empty');
    await expect(rankingPanel(page)).toContainText('No battles recorded with these options yet.');
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');
    const data = await stored(page, MOCK_DB_KEY);

    await page.goto('/?api=many-pages');
    await expect(pageStatus(rankingPanel(page))).toHaveText('Page 1 of 24'); // 34 + 200
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(pageStatus(historyPanel(page))).toHaveText('Page 1 of 5'); // 45 generated

    await chooseScenario(page, 'Normal');
    await page.getByRole('tab', { name: 'Ranking' }).click();
    await expect(pageStatus(rankingPanel(page))).toHaveText('Page 1 of 4');
    expect(await stored(page, MOCK_DB_KEY)).toBe(data);
  });

  test('slow and variable latency show the loading state, then the data', async ({ page }) => {
    await page.goto('/?api=slow');
    await expect(rankingPanel(page).getByRole('status')).toHaveText('Loading the ranking…');
    await expect(rankingPanel(page).locator('tbody tr')).toHaveCount(10, { timeout: 6000 });
    await page.goto('/?api=variable-latency&apiSeed=7');
    await expect(rankingPanel(page).locator('tbody tr')).toHaveCount(10, { timeout: 6000 });
  });

  test('out of order: after quick paging, the page shown is the last one chosen', async ({
    page,
  }) => {
    const ranked = fixtureRecords()
      .filter((record: MatchRecord) => record.configKey === '120s-5s')
      .sort(compareRanking);
    await page.goto('/?api=out-of-order');
    const ranking = rankingPanel(page);
    await expect(pageStatus(ranking)).toHaveText('Page 1 of 4', { timeout: 5000 });
    const next = ranking.getByRole('button', { name: 'Next ranking page' });
    const previous = ranking.getByRole('button', { name: 'Previous ranking page' });
    // Requests alternate slow / fast: answers come back in another order than asked.
    await next.click();
    await next.click();
    await next.click();
    await previous.click();
    await next.click();
    await previous.click();
    // Whatever the order of the answers, once they are all in, page 3 is on screen.
    await page.waitForTimeout(2500); // longer than the slowest answer (1.8 s)
    await expect(pageStatus(ranking)).toHaveText('Page 3 of 4');
    const firstRank = ranking.locator('tbody tr').first().locator('td').first();
    await expect(firstRank).toHaveText('21');
    await expect(ranking.locator('tbody tr').first()).toContainText(ranked[20]!.playerName);
  });

  test('a timeout is reported after the retries', async ({ page }) => {
    await openMenu(page, '?api=timeout&apiTimeout=400');
    await expect(rankingPanel(page).getByRole('alert')).toContainText(
      'Could not load the ranking. The server took too long to answer.',
      { timeout: 10_000 },
    );
    expect(await apiRequests(page, '/api/ranking')).toBe(3);
  });

  for (const [scenario, message, requests] of [
    ['network-error', 'The server could not be reached.', 3],
    ['http-5xx', 'The server is unavailable (simulated).', 3],
    ['http-4xx', 'The request was rejected (simulated).', 1],
  ] as const) {
    test(`${scenario}: the error is shown after ${requests} request(s)`, async ({ page }) => {
      await openMenu(page, `?api=${scenario}`);
      await expect(rankingPanel(page).getByRole('alert')).toContainText(
        `Could not load the ranking. ${message}`,
        { timeout: 10_000 },
      );
      await page.waitForTimeout(1500); // a retry would have started by now
      expect(await apiRequests(page, '/api/ranking')).toBe(requests);
      ignoreFailedResources();
    });
  }

  test('ranking-fail and history-fail affect only their own tab', async ({ page }) => {
    await page.goto('/?api=ranking-fail');
    await expect(rankingPanel(page).getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');
    await expect(historyPanel(page).getByRole('alert')).toHaveCount(0);

    await page.goto('/?api=history-fail');
    await expect(rankingPanel(page).locator('tbody tr')).toHaveCount(10);
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page).getByRole('alert')).toBeVisible({ timeout: 10_000 });
    ignoreFailedResources();
  });

  test('a registration stored but answered too late is recovered by the retry, once', async ({
    page,
  }) => {
    // Timeout 1.5 s + first retry delay 1 s: 2.5 s between the first send and the retry.
    await startGame(page, '?scenario=open-sea&api=submit-timeout-after-commit&apiTimeout=1500');
    await trackApi(page);
    await finishMatch(page);
    const { matchId } = (await lastResult(page))!;
    // The first send is stored at once, while the client still waits for its answer.
    await expect(registration(page)).toHaveText('Submitting…');
    expect(await serverCopies(page, matchId)).toBe(1);
    expect(await apiRequests(page, '/api/matches/')).toBe(1);
    // It times out; the retry gets the stored record back instead of adding another.
    await expect(registration(page)).toHaveText('Submitted', { timeout: 10_000 });
    expect(await apiRequests(page, '/api/matches/')).toBe(2);
    expect(await serverCopies(page, matchId)).toBe(1);
  });

  test('registration unavailable at the end of a match, then sent after recovery', async ({
    page,
  }) => {
    await startGame(page, '?scenario=open-sea&api=submit-unavailable');
    await finishMatch(page);
    await expect(registration(page)).toHaveText(
      'Not submitted yet: The server is unavailable (simulated).',
      { timeout: 10_000 },
    );
    const { matchId } = (await lastResult(page))!;
    expect(await serverCopies(page, matchId)).toBe(0);

    await page.getByRole('button', { name: 'Main Menu' }).click();
    await chooseScenario(page, 'Normal');
    await page.getByRole('tab', { name: 'Match History' }).click();
    const band = page.getByRole('region', { name: 'Battles waiting to be submitted' });
    await band.getByRole('button', { name: 'Retry' }).click();
    await expect(band).toHaveCount(0);
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    expect(await serverCopies(page, matchId)).toBe(1);
    ignoreFailedResources();
  });

  test('switching scenario during a first load asks again at once, under the new scenario', async ({
    page,
  }) => {
    // Under "timeout" (client timeout 4 s) the first load would wait 4 s, then retry after 1 s.
    await openMenu(page, '?api=timeout&apiTimeout=4000');
    const ranking = rankingPanel(page);
    await expect(ranking.getByRole('status')).toHaveText('Loading the ranking…');
    expect(await apiRequests(page, '/api/ranking')).toBe(1);

    await chooseScenario(page, 'Normal');
    // A new request starts right away (the old one is dropped) and answers in 150 ms: the
    // list shows long before the old request could have timed out and been retried.
    await expect.poll(() => apiRequests(page, '/api/ranking'), { timeout: 1500 }).toBe(2);
    await expect(ranking.locator('tbody tr')).toHaveCount(10, { timeout: 2000 });
    await expect(ranking.getByRole('alert')).toHaveCount(0);
  });

  test('Reset in one tab brings every open tab back to Normal and the initial data', async ({
    page,
    context,
  }) => {
    // Tab A registers a match; tab B, already open, shows it in its history.
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitted');
    const registered = (await lastResult(page))!.matchId;
    await page.getByRole('button', { name: 'Main Menu' }).click();

    const other = await context.newPage();
    const otherProblems = collectProblems(other);
    await other.goto('/?clock=manual');
    await other.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(other).locator('tbody tr')).toHaveCount(1);

    // A scenario chosen in tab A is followed by tab B, which asks its lists again.
    await chooseScenario(page, 'Empty lists');
    await expect(summary(other)).toHaveText('Network scenarios (mock API): Empty lists');
    await expect(historyPanel(other)).toContainText('No battles recorded yet.');

    const kept = async () => ({
      queue: await stored(other, STORAGE_KEYS.pendingMatches),
      result: await stored(other, STORAGE_KEYS.lastResult),
      player: await stored(other, STORAGE_KEYS.player),
      options: await stored(other, STORAGE_KEYS.options),
    });
    const before = await kept();

    // Reset in tab A: tab B is back to Normal and shows the fixtures, not its cached lists.
    await panel(page).getByRole('button', { name: 'Reset mock data' }).click();
    await expect(summary(other)).toHaveText('Network scenarios (mock API)');
    await other.getByRole('tab', { name: 'Ranking' }).click();
    await expect(pageStatus(rankingPanel(other))).toHaveText('Page 1 of 4');
    await other.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(other)).toContainText('No battles recorded yet.');
    expect(await serverCopies(other, registered)).toBe(0); // the registered match is gone
    expect(await kept()).toEqual(before); // nothing else on the device changed

    // Both tabs agree from now on: a match registered in tab B shows once in tab A.
    await other.getByRole('button', { name: 'Play' }).click();
    await waitForMatch(other);
    await finishMatch(other);
    await expect(registration(other)).toHaveText('Submitted');
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page).locator('tbody tr')).toHaveCount(1);
    expect(otherProblems).toEqual([]);
  });

  test('Reset restores the fixtures and Normal, and keeps everything else on this device', async ({
    page,
  }) => {
    // One match registered, then one that could not be.
    await startGame(page, '?scenario=open-sea');
    await finishMatch(page);
    await expect(registration(page)).toHaveText('Submitted');
    const registered = (await lastResult(page))!.matchId;
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await chooseScenario(page, 'Registration unavailable');
    await page.getByRole('button', { name: 'Play' }).click();
    await waitForMatch(page);
    await finishMatch(page);
    await expect(registration(page)).toHaveText(/Not submitted yet/, { timeout: 10_000 });
    const pending = (await lastResult(page))!.matchId;
    const before = {
      queue: await stored(page, STORAGE_KEYS.pendingMatches),
      result: await stored(page, STORAGE_KEYS.lastResult),
      player: await stored(page, STORAGE_KEYS.player),
      options: await stored(page, STORAGE_KEYS.options),
    };

    await page.getByRole('button', { name: 'Main Menu' }).click();
    if (!(await panel(page).evaluate((element: HTMLDetailsElement) => element.open))) {
      await summary(page).click();
    }
    await panel(page).getByRole('button', { name: 'Reset mock data' }).click();
    await expect(panel(page).getByRole('status')).toHaveText(
      'Mock data restored: initial matches and the Normal scenario.',
    );
    await expect(summary(page)).toHaveText('Network scenarios (mock API)');
    expect(await serverCopies(page, registered)).toBe(0); // back to the fixtures
    expect(await stored(page, SCENARIO_KEY)).toBe('normal');
    expect({
      queue: await stored(page, STORAGE_KEYS.pendingMatches),
      result: await stored(page, STORAGE_KEYS.lastResult),
      player: await stored(page, STORAGE_KEYS.player),
      options: await stored(page, STORAGE_KEYS.options),
    }).toEqual(before);

    // The pending match is still there, and can be sent now.
    await page.getByRole('tab', { name: 'Match History' }).click();
    const band = page.getByRole('region', { name: 'Battles waiting to be submitted' });
    await expect(band).toBeVisible();
    await band.getByRole('button', { name: 'Retry' }).click();
    await expect(band).toHaveCount(0);
    expect(await serverCopies(page, pending)).toBe(1);
    ignoreFailedResources();
  });
});
