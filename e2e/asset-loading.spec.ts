import { expect, test } from '@playwright/test';

// Requests that go through a service worker cannot be routed by Playwright, so this test
// blocks the MSW worker. The mock API is not needed to load the game assets.
test.use({ serviceWorkers: 'block' });

test('shows loading progress, reports a failed load and recovers with Retry', async ({ page }) => {
  let shipSheetRequests = 0;
  await page.route('**/game/ships.png', async (route) => {
    shipSheetRequests += 1;
    if (shipSheetRequests === 1) {
      // Keep the first request pending briefly so the loading state is observable, then fail it.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).click();

  await expect(page.getByRole('status')).toContainText('Loading assets');
  await expect(page.getByRole('progressbar', { name: 'Asset loading progress' })).toBeVisible();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Failed to load the game assets');
  await expect(page.locator('canvas')).toHaveCount(0);

  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(shipSheetRequests).toBe(2);
});

test('a spritesheet missing a required island frame fails the load instead of rendering', async ({
  page,
}) => {
  let tileSheetRequests = 0;
  await page.route('**/game/tiles.json', async (route) => {
    tileSheetRequests += 1;
    if (tileSheetRequests > 1) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const sheet = (await response.json()) as { frames: Record<string, unknown> };
    delete sheet.frames.island_grass;
    await route.fulfill({ response, json: sheet });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Failed to load the game assets');
  await expect(page.locator('canvas')).toHaveCount(0);

  // The invalid sheet is evicted from the cache, so Retry downloads it again.
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-testid="game-host"] canvas')).toHaveCount(1);
  expect(tileSheetRequests).toBe(2);
});

test('after a failed load, Main Menu takes a real click back to the menu', async ({ page }) => {
  await page.route('**/game/ships.png', (route) => route.abort('failed'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('alert')).toContainText('Failed to load the game assets');

  // A mouse click (Playwright checks that the button itself receives it, not a layer above).
  await page.getByRole('button', { name: 'Main Menu' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});
