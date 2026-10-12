import { expect, test } from '@playwright/test';

test('app boots with the mock API active and no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Pirate Battle' })).toBeVisible();

  // The mock worker must control the page before the app makes requests.
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled).toBe(true);

  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health');
    return { status: response.status, body: (await response.json()) as unknown };
  });
  expect(health).toEqual({ status: 200, body: { status: 'ok', mocked: true } });

  // Still mocked after a reload (worker already installed).
  await page.reload();
  const afterReload = await page.evaluate(async () => (await fetch('/api/health')).status);
  expect(afterReload).toBe(200);

  expect(errors).toEqual([]);
});
