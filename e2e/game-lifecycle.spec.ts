import { expect, test } from '@playwright/test';
import { collectProblems } from './helpers.ts';

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
