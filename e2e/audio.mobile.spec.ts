import { expect, test } from '@playwright/test';
import { collectProblems, startGame } from './helpers.ts';

/** The mute switch on a phone: in the pause dialog, inside the screen, by touch. */

test('the mute switch is reachable and works by touch', async ({ page }) => {
  const problems = collectProblems(page);
  await startGame(page, '?scenario=open-sea');
  await page.getByRole('button', { name: 'Pause' }).tap();
  const mute = page.getByRole('button', { name: 'Mute sound effects' });
  await expect(mute).toBeInViewport({ ratio: 1 });
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.tap();
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect((await page.evaluate(() => window.__pirateAudio!.state())).muted).toBe(true);
  expect(problems).toEqual([]);
});
