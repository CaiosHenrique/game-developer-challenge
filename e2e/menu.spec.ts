import { expect, test, type Page } from '@playwright/test';
import { collectProblems } from './helpers.ts';

const focusIsVisible = (page: Page) =>
  page.evaluate(() => document.activeElement?.matches(':focus-visible') ?? false);

test.describe('main menu', () => {
  let problems: string[];

  test.beforeEach(({ page }) => {
    problems = collectProblems(page);
  });

  test.afterEach(() => {
    expect(problems).toEqual([]);
  });

  test('is fully usable with the keyboard, with a visible focus', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Pirate Battle' })).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    expect(await focusIsVisible(page)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
    expect(await focusIsVisible(page)).toBe(true);

    // Tabs: only the selected tab is in the Tab order; arrows move between tabs.
    await page.keyboard.press('Tab');
    const ranking = page.getByRole('tab', { name: 'Ranking' });
    const history = page.getByRole('tab', { name: 'Match History' });
    await expect(ranking).toBeFocused();
    await expect(ranking).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Ranking' })).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(history).toBeFocused();
    await expect(history).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Match History' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Ranking' })).toBeHidden();
    await page.keyboard.press('Home');
    await expect(ranking).toBeFocused();
    await page.keyboard.press('End');
    await expect(history).toBeFocused();

    // Back to Options and open it with Enter.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Options' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/options$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Options' })).toBeVisible();

    // And back to the menu with the keyboard only.
    await page.getByRole('button', { name: 'Main Menu' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
  });

  test('explains the keyboard controls', async ({ page }) => {
    await page.goto('/');
    const controls = page.getByRole('region', { name: 'Controls' });
    for (const text of ['Sail forward', 'Turn', 'Front gun', 'Space', 'Broadsides', 'Pause']) {
      await expect(controls).toContainText(text);
    }
  });
});
