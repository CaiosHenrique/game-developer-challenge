import { expect, test, type Locator, type Page } from '@playwright/test';
import { configKeyOf, type MatchRecord } from '../src/api/contracts.ts';
import { compareHistory, compareRanking, MOCK_DB_KEY } from '../src/mocks/db.ts';
import { fixtureRecords } from '../src/mocks/fixtures.ts';
import { STORAGE_KEYS } from '../src/storage/localStore.ts';
import { collectProblems } from './helpers.ts';
import { ignoreFailedResources } from './api.ts';

declare global {
  interface Window {
    /** URLs of the API requests seen by a counting handler. */
    __apiCalls?: string[];
    /** Lets a held API response go. */
    __releaseApi?: () => void;
  }
}

// Dates in the history are shown in the player's time zone and language.
test.use({ timezoneId: 'UTC', locale: 'en-US' });

const PLAYER = { playerId: 'e2e-player', playerName: 'Captain E2E' };
const DEFAULT_KEY = '120s-5s';

const rankingPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Ranking' });
const historyPanel = (page: Page) => page.getByRole('tabpanel', { name: 'Match History' });

/** The cells of each body row, as shown. */
function rowTexts(panel: Locator) {
  return panel
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? '')),
    );
}

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** Stores this device's player and the mock API data before the app loads. */
async function seed(page: Page, records: MatchRecord[]) {
  await page.addInitScript(
    ({ player, records, keys }) => {
      localStorage.setItem(keys.player, JSON.stringify(player));
      localStorage.setItem(keys.db, JSON.stringify({ records }));
    },
    { player: PLAYER, records, keys: { player: STORAGE_KEYS.player, db: MOCK_DB_KEY } },
  );
}

/** Matches of the seeded player: the newest one is the best of the default setup. */
function ownRecords(count: number): MatchRecord[] {
  const config = { sessionSeconds: 120, spawnIntervalSeconds: 5 };
  return Array.from({ length: count }, (_, index) => ({
    matchId: `own-${String(index).padStart(2, '0')}`,
    ...PLAYER,
    finishedAt: new Date(Date.UTC(2026, 9, 1 + index, 14, 5)).toISOString(),
    score: index === count - 1 ? 40 : index,
    durationSeconds: index % 2 ? 61.5 : 120,
    endReason: index % 2 ? 'death' : 'time',
    config,
    configKey: configKeyOf(config),
  }));
}

/** Opens a screen without ranking or history, so handlers can be added before any request. */
async function openOptions(page: Page) {
  await page.goto('/options');
  await page.waitForFunction(() => window.__pirateMocks !== undefined);
}

test.describe('ranking and match history', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('the ranking pages through matches of the current setup, in a stable order', async ({
    page,
  }) => {
    const expected = fixtureRecords()
      .filter((record) => record.configKey === DEFAULT_KEY)
      .sort(compareRanking);
    const pages = Math.ceil(expected.length / 10);
    await page.goto('/');
    const panel = rankingPanel(page);
    await expect(panel).toContainText('Matches of 120 s · enemies every 5 s');
    const previous = panel.getByRole('button', { name: 'Previous ranking page' });
    const next = panel.getByRole('button', { name: 'Next ranking page' });

    for (let number = 1; number <= pages; number += 1) {
      if (number > 1) await next.click();
      await expect(panel.getByRole('status')).toHaveText(`Page ${number} of ${pages}`);
      const slice = expected.slice((number - 1) * 10, number * 10);
      expect(await rowTexts(panel)).toEqual(
        slice.map((record, index) => [
          String((number - 1) * 10 + index + 1),
          record.playerName,
          String(record.score),
          clock(record.durationSeconds),
        ]),
      );
      await expect(previous).toBeEnabled({ enabled: number !== 1 });
      await expect(next).toBeEnabled({ enabled: number !== pages });
    }
  });

  test('the ranking follows the options; a setup without matches is empty', async ({ page }) => {
    await page.goto('/options');
    await page.getByLabel('Game session time (seconds)').fill('60');
    await page.getByLabel('Enemy spawn time (seconds)').fill('3');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Main Menu' }).click();
    const panel = rankingPanel(page);
    await expect(panel).toContainText('Matches of 60 s · enemies every 3 s');
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 2');
    const best = fixtureRecords()
      .filter((record) => record.configKey === '60s-3s')
      .sort(compareRanking)[0]!;
    expect((await rowTexts(panel))[0]).toEqual(['1', best.playerName, String(best.score), '01:00']);

    await page.getByRole('button', { name: 'Options' }).click();
    await page.getByLabel('Game session time (seconds)').fill('75');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(panel).toContainText('Matches of 75 s · enemies every 3 s');
    await expect(panel).toContainText('No battles recorded with these options yet.');
    await expect(panel.getByRole('table')).toHaveCount(0);
  });

  test('match history lists the player’s matches, newest first, with every field', async ({
    page,
  }) => {
    const own = ownRecords(13);
    await seed(page, [...fixtureRecords(), ...own]);
    await page.goto('/');

    // The player's best match leads the ranking, marked as theirs.
    const ranking = rankingPanel(page);
    await expect(ranking.locator('tbody tr').first()).toHaveClass('records-own');
    await expect(ranking.locator('tbody tr').first()).toContainText('Captain E2E (you)');

    await page.getByRole('tab', { name: 'Match History' }).click();
    const panel = historyPanel(page);
    await expect(panel).toContainText('Battles of Captain E2E');
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 2');
    const newestFirst = [...own].sort(compareHistory);
    expect((await rowTexts(panel))[0]).toEqual([
      'Oct 13, 2026, 2:05 PM120 s · enemies every 5 s',
      '40',
      '02:00',
      'Time up',
    ]);
    expect((await rowTexts(panel))[1]).toEqual([
      'Oct 12, 2026, 2:05 PM120 s · enemies every 5 s',
      '11',
      '01:01',
      'Ship sunk',
    ]);
    await panel.getByRole('button', { name: 'Next match history page' }).click();
    await expect(panel.getByRole('status')).toHaveText('Page 2 of 2');
    expect((await rowTexts(panel)).map((cells) => cells[1])).toEqual(
      newestFirst.slice(10).map((record) => String(record.score)),
    );
  });

  test('a new player has an empty history', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Match History' }).click();
    const panel = historyPanel(page);
    await expect(panel).toContainText(/Battles of Captain [0-9A-Z]{1,4} \(this device\)/);
    await expect(panel).toContainText('No battles recorded yet.');
  });

  test('a first load shows a loading state until the answer arrives', async ({ page }) => {
    await openOptions(page);
    await page.evaluate(() => {
      const { worker, http } = window.__pirateMocks!;
      const held = new Promise<void>((release) => {
        window.__releaseApi = release;
      });
      worker.use(http.get('/api/ranking', () => held));
    });
    await page.getByRole('button', { name: 'Main Menu' }).click();
    const panel = rankingPanel(page);
    await expect(panel.getByRole('status')).toHaveText('Loading the ranking…');
    await page.evaluate(() => window.__releaseApi!());
    await expect(panel.locator('tbody tr')).toHaveCount(10);
  });

  test('client errors are shown at once, without retrying', async ({ page }) => {
    await openOptions(page);
    await page.evaluate(() => {
      const { worker, http, HttpResponse } = window.__pirateMocks!;
      window.__apiCalls = [];
      worker.use(
        http.get('/api/ranking', ({ request }) => {
          window.__apiCalls!.push(request.url);
          return HttpResponse.json(
            { error: { code: 'invalid_request', message: 'Invalid page.' } },
            { status: 400 },
          );
        }),
      );
    });
    await page.getByRole('button', { name: 'Main Menu' }).click();
    const alert = rankingPanel(page).getByRole('alert');
    await expect(alert).toContainText('Could not load the ranking. Invalid page.');
    await page.waitForTimeout(2500); // longer than the first retry delay
    expect(await page.evaluate(() => window.__apiCalls!.length)).toBe(1);
    ignoreFailedResources(problems);
  });

  for (const failure of ['server', 'network'] as const) {
    test(`${failure} errors are retried twice, then Try again recovers`, async ({ page }) => {
      await openOptions(page);
      await page.evaluate((kind) => {
        const { worker, http, HttpResponse } = window.__pirateMocks!;
        window.__apiCalls = [];
        worker.use(
          http.get('/api/ranking', ({ request }) => {
            window.__apiCalls!.push(request.url);
            return kind === 'network'
              ? HttpResponse.error()
              : HttpResponse.json(
                  { error: { code: 'unavailable', message: 'Down for repairs.' } },
                  { status: 503 },
                );
          }),
        );
      }, failure);
      await page.getByRole('button', { name: 'Main Menu' }).click();
      const panel = rankingPanel(page);
      await expect(panel.getByRole('alert')).toContainText(
        failure === 'network'
          ? 'Could not load the ranking. The server could not be reached.'
          : 'Could not load the ranking. Down for repairs.',
        { timeout: 10_000 },
      );
      expect(await page.evaluate(() => window.__apiCalls!.length)).toBe(3);

      // Try again while the server is still failing: progress is shown at once, on the same
      // (still focused) button, with no error message alongside; then the error returns.
      await panel.getByRole('button', { name: 'Try again' }).click();
      const retrying = panel.getByRole('button', { name: 'Trying again…' });
      await expect(retrying).toBeFocused();
      await expect(retrying).toHaveAttribute('aria-disabled', 'true');
      await expect(panel.getByRole('status')).toHaveText('Loading the ranking…');
      await expect(panel.getByRole('alert')).toHaveCount(0);
      await expect(panel.getByRole('alert')).toContainText('Could not load the ranking.', {
        timeout: 10_000,
      });
      await expect(panel.getByRole('button', { name: 'Try again' })).toBeFocused();
      expect(await page.evaluate(() => window.__apiCalls!.length)).toBe(6);

      await page.evaluate(() => window.__pirateMocks!.worker.resetHandlers());
      await panel.getByRole('button', { name: 'Try again' }).click();
      await expect(panel.locator('tbody tr')).toHaveCount(10);
      await expect(panel.getByRole('alert')).toHaveCount(0);
      ignoreFailedResources(problems);
    });
  }

  test('showing a tab again refreshes it in the background; a failed refresh keeps the data', async ({
    page,
  }) => {
    await page.goto('/');
    const panel = rankingPanel(page);
    await expect(panel.locator('tbody tr')).toHaveCount(10);
    await page.evaluate(() => {
      const { worker, http } = window.__pirateMocks!;
      window.__apiCalls = [];
      // Counts the requests and lets the normal handler answer.
      worker.use(
        http.get('/api/ranking', ({ request }) => {
          window.__apiCalls!.push(request.url);
        }),
      );
    });
    await page.getByRole('tab', { name: 'Match History' }).click();
    await page.getByRole('tab', { name: 'Ranking' }).click();
    // The cached list is shown at once, never the first-load message, while it refreshes.
    await expect(panel.locator('tbody tr')).toHaveCount(10);
    await expect(panel.getByText('Loading the ranking…')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__apiCalls!.length)).toBe(1);
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 4');

    await page.evaluate(() => {
      const { worker, http, HttpResponse } = window.__pirateMocks!;
      worker.use(http.get('/api/ranking', () => HttpResponse.json(null, { status: 500 })));
    });
    await page.getByRole('tab', { name: 'Match History' }).click();
    await page.getByRole('tab', { name: 'Ranking' }).click();
    await expect(panel.getByRole('alert')).toContainText(
      'Could not refresh the ranking; showing the last results.',
      { timeout: 10_000 },
    );
    await expect(panel.locator('tbody tr')).toHaveCount(10);
    ignoreFailedResources(problems);
  });

  test('a late answer for a page the player left never replaces the page on screen', async ({
    page,
  }) => {
    await page.goto('/');
    const panel = rankingPanel(page);
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 4');
    const firstPage = await rowTexts(panel);
    await page.evaluate(() => {
      const { worker, http, delay } = window.__pirateMocks!;
      window.__apiCalls = [];
      // Page 2 answers slowly, then the normal handler answers it.
      worker.use(
        http.get('/api/ranking', async ({ request }) => {
          if (new URL(request.url).searchParams.get('page') !== '2') return;
          await delay(1500);
          window.__apiCalls!.push('page 2 answered');
        }),
      );
    });

    await panel.getByRole('button', { name: 'Next ranking page' }).click();
    // While page 2 loads, page 1 stays visible, marked as busy.
    await expect(panel.getByRole('status')).toHaveText('Loading page 2…');
    await expect(panel.locator('.records-scroll')).toHaveAttribute('aria-busy', 'true');
    // The table is still named after the rows it shows (page 1), not the page requested.
    await expect(panel.getByRole('table', { name: 'Ranking, page 1' })).toBeVisible();
    await panel.getByRole('button', { name: 'Previous ranking page' }).click();
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 4');

    await expect.poll(() => page.evaluate(() => window.__apiCalls!.length)).toBe(1);
    await page.waitForTimeout(300);
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 4');
    expect(await rowTexts(panel)).toEqual(firstPage);

    await panel.getByRole('button', { name: 'Next ranking page' }).click();
    await expect(panel.getByRole('status')).toHaveText('Page 2 of 4', { timeout: 5000 });
    await expect(panel.getByRole('table', { name: 'Ranking, page 2' })).toBeVisible();
    await expect(panel.locator('.records-scroll')).toHaveAttribute('aria-busy', 'false');
  });

  test('a page that keeps failing never traps the player: Previous returns to a valid page', async ({
    page,
  }) => {
    await page.goto('/');
    const panel = rankingPanel(page);
    const next = panel.getByRole('button', { name: 'Next ranking page' });
    const previous = panel.getByRole('button', { name: 'Previous ranking page' });
    await expect(panel.getByRole('status')).toHaveText('Page 1 of 4');
    await next.click();
    await expect(panel.getByRole('status')).toHaveText('Page 2 of 4');
    const secondPage = await rowTexts(panel);

    // From now on every ranking request fails.
    await page.evaluate(() => {
      const { worker, http, HttpResponse } = window.__pirateMocks!;
      worker.use(
        http.get('/api/ranking', () =>
          HttpResponse.json(
            { error: { code: 'unavailable', message: 'Down for repairs.' } },
            { status: 503 },
          ),
        ),
      );
    });
    await next.click();
    await expect(panel.getByRole('alert')).toContainText(
      'Could not load the ranking. Down for repairs.',
      { timeout: 10_000 },
    );
    // Still on the selected page, with the pager limited to pages known to exist.
    await expect(panel.locator('tbody tr')).toHaveCount(0);
    await expect(panel.getByRole('status')).toHaveText('Page 3 of 4');
    await expect(previous).toBeEnabled();
    await expect(next).toBeEnabled(); // page 4 exists according to the last valid answer

    await previous.click();
    await expect(panel.getByRole('status')).toHaveText('Page 2 of 4');
    expect(await rowTexts(panel)).toEqual(secondPage);
    await expect(panel.getByRole('alert')).toHaveCount(0);
    ignoreFailedResources(problems);
  });

  test('without storage the mock API runs in memory and says the data will not last', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      };
      Storage.prototype.getItem = () => {
        throw new DOMException('Storage is blocked', 'SecurityError');
      };
    });
    await page.goto('/');
    await expect(
      page.getByText('kept in memory only and reset when the page reloads'),
    ).toBeVisible();
    await expect(rankingPanel(page).locator('tbody tr')).toHaveCount(10);
    await page.getByRole('tab', { name: 'Match History' }).click();
    await expect(historyPanel(page)).toContainText('No battles recorded yet.');
  });
});
