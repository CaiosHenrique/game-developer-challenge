import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_OPTIONS } from '../src/game/options.ts';
import { collectProblems, getState, startGame, step, waitForMatch } from './helpers.ts';

const SPS = 60;

async function openOptions(page: Page) {
  await page.goto('/options');
  await expect(page.getByRole('heading', { level: 1, name: 'Options' })).toBeVisible();
  return {
    session: page.getByLabel('Game session time (seconds)'),
    spawn: page.getByLabel('Enemy spawn time (seconds)'),
    save: page.getByRole('button', { name: 'Save' }),
    status: page.getByRole('status'),
  };
}

test.describe('options', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('invalid values are reported accessibly and cannot be saved', async ({ page }) => {
    const { session, spawn, save } = await openOptions(page);
    await expect(session).toHaveValue(String(DEFAULT_OPTIONS.sessionSeconds));
    await expect(spawn).toHaveValue(String(DEFAULT_OPTIONS.spawnIntervalSeconds));

    for (const value of ['30', '181', '90.5', '']) {
      await session.fill(value);
      await expect(session).toHaveAttribute('aria-invalid', 'true');
      await expect(session).toHaveAccessibleDescription(/whole number from 60 to 180|Enter the/);
      await expect(save).toBeDisabled();
    }
    await session.fill('90');
    await expect(session).not.toHaveAttribute('aria-invalid', 'true');

    for (const value of ['0', '0.5', '2.3', '11']) {
      await spawn.fill(value);
      await expect(spawn).toHaveAttribute('aria-invalid', 'true');
      await expect(spawn).toHaveAccessibleDescription(/from 1 to 10 seconds, in steps of 0.5/);
      await expect(save).toBeDisabled();
    }
    await spawn.fill('2.5');
    await expect(save).toBeEnabled();
  });

  test('saved options survive a reload; Restore defaults only fills the form', async ({ page }) => {
    let form = await openOptions(page);
    await form.session.fill('75');
    await form.spawn.fill('2.5');
    await form.save.click();
    await expect(form.status).toHaveText('Options saved. They apply from the next battle.');

    await page.reload();
    form = await openOptions(page);
    await expect(form.session).toHaveValue('75');
    await expect(form.spawn).toHaveValue('2.5');

    await page.getByRole('button', { name: 'Restore defaults' }).click();
    await expect(form.session).toHaveValue(String(DEFAULT_OPTIONS.sessionSeconds));
    await page.reload();
    form = await openOptions(page);
    await expect(form.session).toHaveValue('75'); // not saved until Save
  });

  test('a match uses the options saved when it starts', async ({ page }) => {
    const form = await openOptions(page);
    await form.session.fill('75');
    await form.spawn.fill('2.5');
    await form.save.click();

    await startGame(page, '?scenario=endless-spawns&seed=5');
    let state = await getState(page);
    expect(state.durationTicks).toBe(75 * SPS);
    state = await page.evaluate(() => {
      const api = window.__pirateTest!;
      while (api.getState().spawns.length < 3) api.step(1);
      return api.getState();
    });
    expect(state.spawns.map((record) => record.scheduledTick)).toEqual([120, 270, 420]);

    // Stored options changing during the match do not affect it.
    await page.evaluate(() =>
      localStorage.setItem(
        'pirate-battle.options.v1',
        JSON.stringify({ sessionSeconds: 180, spawnIntervalSeconds: 10 }),
      ),
    );
    expect((await step(page, 60)).durationTicks).toBe(75 * SPS);
  });

  test('options that cannot be stored still apply for the session', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      };
    });
    const form = await openOptions(page);
    await form.session.fill('90');
    await form.save.click();
    await expect(form.status).toHaveText(
      'Options applied for this session, but they could not be saved on this device.',
    );

    // Same page session (no reload): Play uses them.
    await page.getByRole('button', { name: 'Main Menu' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    const state = await waitForMatch(page);
    expect(state.durationTicks).toBe(90 * SPS);
  });
});
