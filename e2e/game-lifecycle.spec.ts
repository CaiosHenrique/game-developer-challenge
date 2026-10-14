import { expect, test, type Page } from '@playwright/test';
import { collectProblems, lifecycle, step, waitForMatch } from './helpers.ts';

/**
 * Makes rendering contexts unavailable in the page: `getContext` returns null for the given
 * kinds, and `gpu` removes WebGPU (PixiJS tries WebGL, then WebGPU, then a 2D canvas).
 */
function blockRendering(page: Page, kinds: readonly string[]) {
  return page.addInitScript((blocked) => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: unknown[]
    ) {
      if (blocked.includes(kind)) return null;
      return (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof getContext;
    if (blocked.includes('gpu')) {
      Object.defineProperty(Navigator.prototype, 'gpu', {
        configurable: true,
        get: () => undefined,
      });
    }
  }, kinds);
}

const WEBGL = ['webgl', 'webgl2', 'experimental-webgl'];

test('entering and leaving the game repeatedly keeps exactly one canvas', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');

  for (let round = 0; round < 3; round += 1) {
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);

    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.getByRole('heading', { name: 'Pirate Battle' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  }

  expect(problems).toEqual([]);
});

test('leaving right after entering does not leave a canvas behind', async ({ page }) => {
  const problems = collectProblems(page);
  await page.goto('/');

  // Warm the asset cache so the renderer starts immediately on the next entries.
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Main Menu' }).click();

  for (let round = 0; round < 5; round += 1) {
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Main Menu' }).click();
  }

  await expect(page.getByRole('heading', { name: 'Pirate Battle' })).toBeVisible();
  // Give any pending renderer initialization time to resolve and clean itself up.
  await page.waitForTimeout(500);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a renderer that cannot start fails cleanly, and the menu still works', async ({ page }) => {
  const problems = collectProblems(page);
  // No WebGL, no WebGPU and no 2D canvas: PixiJS has no renderer left.
  await blockRendering(page, [...WEBGL, 'gpu', '2d']);
  await page.goto('/?scenario=open-sea');

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'The game could not start. Reload the page to try again.',
    );
    await expect(page.locator('canvas')).toHaveCount(0);
    // The runtime that failed never ran: nothing is live, nothing was left installed.
    expect(await lifecycle(page)).toEqual({
      constructed: attempt,
      initialized: 0,
      disposedBeforeInit: 0,
      failed: attempt,
      destroyed: 0,
      live: 0,
    });
    expect(await page.evaluate(() => window.__pirateTest === undefined)).toBe(true);

    await page.getByRole('button', { name: 'Main Menu' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});

test('without WebGL or WebGPU the game falls back to a 2D canvas and plays', async ({ page }) => {
  const problems = collectProblems(page);
  await blockRendering(page, [...WEBGL, 'gpu']);
  await page.goto('/?scenario=open-sea&clock=manual');
  await page.getByRole('button', { name: 'Play' }).click();
  const before = await waitForMatch(page);

  // A fallback, not a failure: no error, one canvas, and it is a 2D canvas.
  await expect(page.getByRole('alert')).toHaveCount(0);
  const canvas = page.locator('[data-testid="game-host"] canvas');
  await expect(canvas).toHaveCount(1);
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => element.getContext('2d') !== null),
  ).toBe(true);
  expect(await lifecycle(page)).toMatchObject({ initialized: 1, failed: 0, live: 1 });

  // The match runs on it, through real input.
  await page.keyboard.down('KeyW');
  const after = await step(page, 30);
  await page.keyboard.up('KeyW');
  expect(after.tick).toBe(before.tick + 30);
  expect(after.player.y).toBeLessThan(before.player.y);
  expect(after.render?.healthBars).toBe(1);
  expect(problems).toEqual([]);
});
