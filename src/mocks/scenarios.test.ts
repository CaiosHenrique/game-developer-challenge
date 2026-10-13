// Network scenarios of the mock API: `npm run test:unit`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Rng } from '../game/sim/rng.ts';
import { createMemoryStorage } from './storageFallback.ts';
import {
  apiSeedFromQuery,
  DEFAULT_API_SEED,
  initialScenario,
  SCENARIO_KEY,
  saveScenario,
} from './scenarioChoice.ts';
import {
  decide,
  isScenarioId,
  LATENCY,
  SCENARIOS,
  type RequestKind,
  type ScenarioDecision,
  type ScenarioId,
} from './scenarios.ts';

const context = (overrides: Partial<{ requestIndex: number; firstSend: boolean }> = {}) => ({
  requestIndex: 0,
  rng: new Rng(1),
  firstSend: true,
  ...overrides,
});

const normal: ScenarioDecision = { kind: 'respond', delayMs: LATENCY.normal, data: 'stored' };
const unavailable: Partial<ScenarioDecision> = { kind: 'error', status: 503 };

test('every scenario answers each kind of request as documented', () => {
  const expected: Record<ScenarioId, Record<RequestKind, Partial<ScenarioDecision>>> = {
    normal: { ranking: normal, history: normal, submit: normal },
    empty: {
      ranking: { kind: 'respond', data: 'empty' },
      history: { kind: 'respond', data: 'empty' },
      submit: normal,
    },
    'many-pages': {
      ranking: { kind: 'respond', data: 'many-pages' },
      history: { kind: 'respond', data: 'many-pages' },
      submit: normal,
    },
    slow: {
      ranking: { delayMs: LATENCY.slow },
      history: { delayMs: LATENCY.slow },
      submit: { delayMs: LATENCY.slow },
    },
    'variable-latency': { ranking: { kind: 'respond' }, history: {}, submit: {} },
    'out-of-order': { ranking: { delayMs: LATENCY.outOfOrderSlow }, history: {}, submit: {} },
    timeout: {
      ranking: { kind: 'no-answer', commitFirst: false },
      history: { kind: 'no-answer', commitFirst: false },
      submit: { kind: 'no-answer', commitFirst: false },
    },
    'network-error': {
      ranking: { kind: 'network-error' },
      history: { kind: 'network-error' },
      submit: { kind: 'network-error' },
    },
    'http-4xx': {
      ranking: { kind: 'error', status: 400 },
      history: { kind: 'error', status: 400 },
      submit: { kind: 'error', status: 400 },
    },
    'http-5xx': { ranking: unavailable, history: unavailable, submit: unavailable },
    'ranking-fail': { ranking: unavailable, history: normal, submit: normal },
    'history-fail': { ranking: normal, history: unavailable, submit: normal },
    'submit-timeout-after-commit': {
      ranking: normal,
      history: normal,
      submit: { kind: 'no-answer', commitFirst: true },
    },
    'submit-unavailable': { ranking: normal, history: normal, submit: unavailable },
  };
  assert.deepEqual(Object.keys(expected).sort(), SCENARIOS.map((scenario) => scenario.id).sort());
  for (const [scenario, kinds] of Object.entries(expected) as [
    ScenarioId,
    Record<RequestKind, Partial<ScenarioDecision>>,
  ][]) {
    for (const [kind, partial] of Object.entries(kinds) as [
      RequestKind,
      Partial<ScenarioDecision>,
    ][]) {
      const decision = decide(scenario, kind, context());
      for (const [key, value] of Object.entries(partial)) {
        assert.equal(
          (decision as Record<string, unknown>)[key],
          value,
          `${scenario} / ${kind} / ${key}`,
        );
      }
    }
  }
});

test('a registration is delayed past the timeout only on its first send', () => {
  const first = decide('submit-timeout-after-commit', 'submit', context({ firstSend: true }));
  assert.deepEqual(first, { kind: 'no-answer', delayMs: LATENCY.noAnswer, commitFirst: true });
  const retry = decide('submit-timeout-after-commit', 'submit', context({ firstSend: false }));
  assert.deepEqual(retry, normal);
});

test('out of order: requests alternate slow and fast, so newer answers arrive first', () => {
  const delays = [0, 1, 2, 3].map((requestIndex) => {
    const decision = decide('out-of-order', 'ranking', context({ requestIndex }));
    return decision.delayMs;
  });
  assert.deepEqual(delays, [
    LATENCY.outOfOrderSlow,
    LATENCY.outOfOrderFast,
    LATENCY.outOfOrderSlow,
    LATENCY.outOfOrderFast,
  ]);
});

test('variable latency: the same seed and requests give the same delays', () => {
  const run = (seed: number) => {
    const rng = new Rng(seed);
    return Array.from({ length: 20 }, (_, requestIndex) => {
      const kind: RequestKind = requestIndex % 3 === 0 ? 'history' : 'ranking';
      return decide('variable-latency', kind, { requestIndex, rng, firstSend: false }).delayMs;
    });
  };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(8));
  for (const delay of run(7)) {
    assert.ok(delay >= LATENCY.variableMin && delay < LATENCY.variableMax, String(delay));
  }
});

test('a valid ?api= wins and is saved; otherwise the saved scenario, then normal', () => {
  const storage = createMemoryStorage();
  assert.equal(initialScenario('', storage), 'normal');
  assert.equal(initialScenario('?api=slow', storage), 'slow');
  assert.equal(storage.getItem(SCENARIO_KEY), 'slow');
  assert.equal(initialScenario('', storage), 'slow'); // saved
  assert.equal(initialScenario('?api=http-5xx', storage), 'http-5xx'); // wins over saved
  assert.equal(initialScenario('?api=not-a-scenario', storage), 'http-5xx'); // ignored
  assert.equal(storage.getItem(SCENARIO_KEY), 'http-5xx');
  storage.setItem(SCENARIO_KEY, 'garbage');
  assert.equal(initialScenario('?api=', storage), 'normal');
  assert.equal(isScenarioId('normal'), true);
  assert.equal(isScenarioId('Normal'), false);
});

test('without storage the scenario still applies to this page load', () => {
  assert.equal(initialScenario('?api=empty', null), 'empty');
  assert.equal(initialScenario('', null), 'normal');
  assert.equal(saveScenario('slow', null), false);
  const blocked = {
    ...createMemoryStorage(),
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
  } as Storage;
  assert.equal(initialScenario('?api=slow', blocked), 'slow');
  assert.equal(initialScenario('', blocked), 'normal');
  assert.equal(saveScenario('slow', blocked), false);
});

test('?apiSeed= sets the latency seed; invalid values use the default', () => {
  assert.equal(apiSeedFromQuery('?apiSeed=42'), 42);
  assert.equal(apiSeedFromQuery(''), DEFAULT_API_SEED);
  assert.equal(apiSeedFromQuery('?apiSeed=-3'), DEFAULT_API_SEED);
  assert.equal(apiSeedFromQuery('?apiSeed=abc'), DEFAULT_API_SEED);
});
