// Live-region announcement rules, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { announcementFor, type AnnouncedState } from './announcements.ts';

const base: AnnouncedState = {
  hp: 100,
  maxHp: 100,
  score: 0,
  remainingSeconds: 120,
  phase: 'running',
  endReason: null,
  paused: false,
};
const next = (changes: Partial<AnnouncedState>): AnnouncedState => ({ ...base, ...changes });

test('the running clock alone is never announced', () => {
  for (let seconds = 119; seconds > 30; seconds -= 1) {
    assert.equal(
      announcementFor(
        next({ remainingSeconds: seconds + 1 }),
        next({ remainingSeconds: seconds }),
        false,
      ),
      null,
    );
  }
});

test('time warnings are announced when crossing 30 and 10 seconds', () => {
  assert.equal(
    announcementFor(next({ remainingSeconds: 31 }), next({ remainingSeconds: 30 }), false),
    '30 seconds left.',
  );
  assert.equal(
    announcementFor(next({ remainingSeconds: 11 }), next({ remainingSeconds: 10 }), false),
    '10 seconds left.',
  );
  assert.equal(
    announcementFor(next({ remainingSeconds: 30 }), next({ remainingSeconds: 29 }), false),
    null,
  );
});

test('score, pause, resume, low health and the end are announced', () => {
  assert.equal(announcementFor(base, next({ score: 1 }), false), 'Score 1.');
  assert.equal(announcementFor(base, next({ paused: true }), false), 'Game paused.');
  assert.equal(announcementFor(next({ paused: true }), base, false), 'Game resumed.');
  assert.equal(announcementFor(base, next({ hp: 25 }), false), 'Health low.');
  assert.equal(announcementFor(next({ hp: 25 }), next({ hp: 20 }), true), null, 'only once');
  assert.equal(
    announcementFor(base, next({ phase: 'ended', endReason: 'time', score: 7 }), false),
    'Battle complete. Final score 7.',
  );
  assert.equal(
    announcementFor(base, next({ phase: 'ended', endReason: 'death', hp: 0 }), false),
    'Your ship sank. Final score 0.',
  );
});

test('the match end takes priority over anything else in the same update', () => {
  const ending = next({
    phase: 'ended',
    endReason: 'death',
    hp: 0,
    score: 3,
    remainingSeconds: 10,
  });
  assert.equal(
    announcementFor(next({ score: 2, remainingSeconds: 11 }), ending, false),
    'Your ship sank. Final score 3.',
  );
});
