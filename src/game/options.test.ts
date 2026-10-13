// Options validation and match configuration, run in Node: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { secondsToTicks } from './config.ts';
import {
  configFromOptions,
  DEFAULT_OPTIONS,
  OPTION_LIMITS,
  sanitizeOptions,
  validateOptions,
} from './options.ts';

test('session time accepts whole seconds from 60 to 180 only', () => {
  for (const value of [60, 61, 120, 180]) {
    assert.equal(
      validateOptions({ ...DEFAULT_OPTIONS, sessionSeconds: value }).sessionSeconds,
      undefined,
    );
  }
  for (const value of [59, 181, 90.5, 0, -1, Number.NaN, Infinity, '120', null]) {
    assert.ok(
      validateOptions({ ...DEFAULT_OPTIONS, sessionSeconds: value }).sessionSeconds,
      String(value),
    );
  }
});

test('spawn time accepts 1 to 10 seconds in half-second steps only', () => {
  for (const value of [1, 1.5, 4, 5, 9.5, 10]) {
    assert.equal(
      validateOptions({ ...DEFAULT_OPTIONS, spawnIntervalSeconds: value }).spawnIntervalSeconds,
      undefined,
    );
  }
  for (const value of [0, 0.5, 10.5, 2.3, -5, Number.NaN, '5', undefined]) {
    assert.ok(
      validateOptions({ ...DEFAULT_OPTIONS, spawnIntervalSeconds: value }).spawnIntervalSeconds,
      String(value),
    );
  }
});

test('invalid fields fall back to their defaults, valid ones are kept', () => {
  assert.deepEqual(sanitizeOptions({ sessionSeconds: 90, spawnIntervalSeconds: 99 }), {
    sessionSeconds: 90,
    spawnIntervalSeconds: DEFAULT_OPTIONS.spawnIntervalSeconds,
  });
  assert.deepEqual(sanitizeOptions('garbage'), DEFAULT_OPTIONS);
  assert.deepEqual(sanitizeOptions(null), DEFAULT_OPTIONS);
});

test('a match configuration is derived from valid options and is a fresh copy', () => {
  const config = configFromOptions({ sessionSeconds: 75, spawnIntervalSeconds: 2.5 });
  assert.equal(config.match.durationSeconds, 75);
  assert.equal(config.spawn.intervalSeconds, 2.5);
  // Half-second steps map to whole simulation ticks.
  assert.equal(secondsToTicks(2.5, config.simulation.stepsPerSecond), 150);
  assert.notEqual(configFromOptions(DEFAULT_OPTIONS), configFromOptions(DEFAULT_OPTIONS));

  // Invalid values never reach a configuration.
  const sanitized = configFromOptions({ sessionSeconds: 5000, spawnIntervalSeconds: 0 });
  assert.equal(sanitized.match.durationSeconds, DEFAULT_OPTIONS.sessionSeconds);
  assert.equal(sanitized.spawn.intervalSeconds, DEFAULT_OPTIONS.spawnIntervalSeconds);
  assert.ok(OPTION_LIMITS.spawnIntervalSeconds.min > 0, 'the spawn interval is always positive');
});
