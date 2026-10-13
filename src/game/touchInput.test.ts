// Touch command tracking, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InputState } from './sim/simulation.ts';
import { combineInputs, TouchInput } from './touchInput.ts';

const NONE: InputState = {
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
};

test('several fingers hold several actions at once', () => {
  const touch = new TouchInput();
  touch.press(1, 'forward');
  touch.press(2, 'fireFront');
  assert.deepEqual(touch.state, { ...NONE, forward: true, fireFront: true });

  touch.release(1);
  assert.deepEqual(touch.state, { ...NONE, fireFront: true }, 'the other finger keeps firing');
});

test('releasing is idempotent and a pointer holds one action at a time', () => {
  const touch = new TouchInput();
  touch.press(7, 'turnLeft');
  touch.release(7);
  touch.release(7); // e.g. pointerup, then lostpointercapture
  assert.deepEqual(touch.state, NONE);

  touch.press(3, 'turnLeft');
  touch.press(3, 'turnRight'); // the same pointer cannot hold two buttons
  assert.deepEqual(touch.state, { ...NONE, turnRight: true });
  touch.release(99); // unknown pointer: no effect
  assert.deepEqual(touch.state, { ...NONE, turnRight: true });
});

test('two fingers on the same button: lifting one keeps the action held', () => {
  const touch = new TouchInput();
  touch.press(1, 'forward');
  touch.press(2, 'forward');
  touch.release(1);
  assert.equal(touch.state.forward, true);
  touch.release(2);
  assert.equal(touch.state.forward, false);
});

test('reset releases everything', () => {
  const touch = new TouchInput();
  touch.press(1, 'forward');
  touch.press(2, 'fireLeft');
  touch.reset();
  assert.deepEqual(touch.state, NONE);
});

test('combined sources: releasing one never cancels the other', () => {
  const keyboard: InputState = { ...NONE, fireFront: true };
  const touch = new TouchInput();
  touch.press(1, 'fireFront');
  touch.press(2, 'forward');
  const combined = combineInputs({ ...NONE }, keyboard, touch.state);
  assert.deepEqual(combined, { ...NONE, fireFront: true, forward: true });

  touch.reset();
  combineInputs(combined, keyboard, touch.state);
  assert.deepEqual(combined, { ...NONE, fireFront: true }, 'the key still fires');
});
