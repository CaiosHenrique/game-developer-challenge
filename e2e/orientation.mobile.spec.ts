import { expect, test, type Page } from '@playwright/test';
import { collectProblems, getState, startGame, step } from './helpers.ts';
import { touchScreen } from './touch.ts';

const LANDSCAPE = { width: 863, height: 360 };
const PORTRAIT = { width: 412, height: 839 };

const rotatePrompt = (page: Page) => page.getByText('Rotate your device to landscape to play.');

test.describe('orientation', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('turning to portrait pauses the match; landscape does not resume it', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const start = await step(page, 10);

    await page.setViewportSize(PORTRAIT);
    await expect(rotatePrompt(page)).toBeVisible();
    await page.waitForFunction(() => window.__pirateTest!.getState().pauseReason !== null);
    let state = await step(page, 60);
    expect(state.pauseReason).toBe('orientation');
    expect(state.tick).toBe(start.tick);

    await page.setViewportSize(LANDSCAPE);
    await expect(rotatePrompt(page)).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: 'Paused' });
    await expect(dialog).toContainText('held in portrait');
    state = await step(page, 60);
    expect(state.pauseReason).toBe('orientation');
    expect(state.tick).toBe(start.tick);

    const touch = await touchScreen(page);
    await touch.tap(1, page.getByRole('button', { name: 'Resume' }));
    expect((await step(page, 10)).tick).toBe(start.tick + 10);
  });

  test('an existing pause keeps its reason when the device turns', async ({ page }) => {
    await startGame(page, '?scenario=open-sea');
    const touch = await touchScreen(page);
    await touch.tap(1, page.getByRole('button', { name: 'Pause' }));
    expect((await getState(page)).pauseReason).toBe('manual');

    await page.setViewportSize(PORTRAIT);
    await expect(rotatePrompt(page)).toBeVisible();
    expect((await getState(page)).pauseReason).toBe('manual');
    await page.setViewportSize(LANDSCAPE);
    await expect(page.getByRole('dialog', { name: 'Paused' })).toContainText('on hold');
  });

  test('a match started in portrait starts paused', async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await startGame(page, '?scenario=open-sea');
    await expect(rotatePrompt(page)).toBeVisible();
    await page.waitForFunction(() => window.__pirateTest!.getState().pauseReason !== null);
    const state = await step(page, 60);
    expect(state.pauseReason).toBe('orientation');
    expect(state.tick).toBe(0);
  });
});
