import { expect, test, type Page } from '@playwright/test';
import { collectProblems, finishMatch, waitForMatch } from './helpers.ts';

const PORTRAIT = { width: 412, height: 839 };

/** The page never scrolls sideways. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('main flow on a phone', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('menu, options, match and result in landscape, by touch', async ({ page }) => {
    await page.goto('/?scenario=open-sea&clock=manual');
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();
    await expect(page.getByText('Touch: hold the buttons on the left')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Options' }).tap();
    await page.getByLabel('Game session time (seconds)').fill('60');
    await page.getByRole('button', { name: 'Save' }).tap();
    await expect(page.getByRole('status')).toContainText('Options saved');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Main Menu' }).tap();

    await page.getByRole('button', { name: 'Play' }).tap();
    const state = await waitForMatch(page);
    expect(state.durationTicks).toBe(60 * 60);
    await expect(page.getByRole('button', { name: 'Sail forward', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await finishMatch(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Battle Complete' })).toBeVisible();
    await expect(page.getByTestId('result-time')).toHaveText('01:00');
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Play Again' }).tap();
    await waitForMatch(page);
  });

  test('menus work in portrait too, without sideways scrolling', async ({ page }) => {
    await page.setViewportSize(PORTRAIT);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: 'Options' }).tap();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto('/result');
    await expect(page.getByRole('heading', { level: 1, name: 'No battle yet' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
