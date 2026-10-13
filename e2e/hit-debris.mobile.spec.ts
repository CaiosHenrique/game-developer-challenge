import { expect, test } from '@playwright/test';
import { collectProblems, step, startGame, stepUntilHit } from './helpers.ts';

/** The hit splinters on a phone (touch, landscape): same three pieces, same 30 ticks. */

test('a hit on the player throws three splinters on a phone too', async ({ page }) => {
  const problems = collectProblems(page);
  await startGame(page, '?scenario=chaser-ahead');
  const hit = await stepUntilHit(page, 'player');
  expect(hit.render!.debris).toHaveLength(3);
  expect(hit.render!.hitFlashShips).toEqual([0]);
  expect((await step(page, 29)).render!.debris).toHaveLength(3);
  expect((await step(page, 1)).render!.debris).toEqual([]);
  expect(problems).toEqual([]);
});
