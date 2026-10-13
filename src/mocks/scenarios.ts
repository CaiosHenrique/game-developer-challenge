import type { Rng } from '../game/sim/rng.ts';

/**
 * Network scenarios of the mock API: how it answers ranking, history and match-submission
 * requests. Pure (no MSW), so the menu can list them and tests can check every decision.
 */
export const SCENARIOS = [
  { id: 'normal', label: 'Normal', description: 'Every request succeeds after 150 ms.' },
  {
    id: 'empty',
    label: 'Empty lists',
    description: 'Ranking and history answer with no matches (stored data is untouched).',
  },
  {
    id: 'many-pages',
    label: 'Many pages',
    description: 'Ranking and history include extra generated matches, read-only.',
  },
  { id: 'slow', label: 'Slow', description: 'Every request answers after 2.5 s.' },
  {
    id: 'variable-latency',
    label: 'Variable latency',
    description: 'Each request answers after 0.1 to 2 s (seeded, reproducible).',
  },
  {
    id: 'out-of-order',
    label: 'Out of order',
    description: 'Requests alternate between 1.8 s and 0.1 s, so newer answers arrive first.',
  },
  {
    id: 'timeout',
    label: 'Timeout',
    description:
      'No request is answered in time; the game reports a timeout after its retries (about 18 s).',
  },
  {
    id: 'network-error',
    label: 'Connection failure',
    description: 'Every request fails to connect.',
  },
  { id: 'http-4xx', label: 'HTTP 400', description: 'Every request is rejected (not retried).' },
  {
    id: 'http-5xx',
    label: 'HTTP 503',
    description: 'Every request fails with a server error (retried).',
  },
  { id: 'ranking-fail', label: 'Ranking fails', description: 'Only the ranking fails (503).' },
  { id: 'history-fail', label: 'History fails', description: 'Only the history fails (503).' },
  {
    id: 'submit-timeout-after-commit',
    label: 'Timeout after registering',
    description:
      'The first send of each match is stored but answered too late; the retry gets it back.',
  },
  {
    id: 'submit-unavailable',
    label: 'Registration unavailable',
    description: 'Match registration fails (503) until another scenario is chosen.',
  },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];
export const DEFAULT_SCENARIO: ScenarioId = 'normal';

export function isScenarioId(value: unknown): value is ScenarioId {
  return SCENARIOS.some((scenario) => scenario.id === value);
}

export function scenarioLabel(id: ScenarioId): string {
  return SCENARIOS.find((scenario) => scenario.id === id)!.label;
}

/** Latencies, in milliseconds. */
export const LATENCY = {
  normal: 150,
  slow: 2500,
  variableMin: 100,
  variableMax: 2000,
  outOfOrderSlow: 1800,
  outOfOrderFast: 100,
  /** Longer than any client timeout: the answer comes after the client gave up. */
  noAnswer: 30_000,
} as const;

export type RequestKind = 'ranking' | 'history' | 'submit';

/**
 * - `respond`: answer normally after `delayMs` (`data` may change what a list contains);
 * - `error`: an HTTP error response;
 * - `network-error`: the connection fails;
 * - `no-answer`: answer only after the client gave up (`commitFirst`: store the match before).
 */
export type ScenarioDecision =
  | { kind: 'respond'; delayMs: number; data: 'stored' | 'empty' | 'many-pages' }
  | { kind: 'error'; delayMs: number; status: number; code: string; message: string }
  | { kind: 'network-error'; delayMs: number }
  | { kind: 'no-answer'; delayMs: number; commitFirst: boolean };

const respond = (delayMs: number = LATENCY.normal): ScenarioDecision => ({
  kind: 'respond',
  delayMs,
  data: 'stored',
});

const unavailable: ScenarioDecision = {
  kind: 'error',
  delayMs: LATENCY.normal,
  status: 503,
  code: 'unavailable',
  message: 'The server is unavailable (simulated).',
};

/**
 * How the mock API answers one request.
 * @param requestIndex 0 for the first request of this page load, then 1, 2…
 * @param rng seeded generator, drawn from in request order (only by `variable-latency`)
 * @param firstSend whether this is the first send of this match in this page load
 */
export function decide(
  scenario: ScenarioId,
  kind: RequestKind,
  { requestIndex, rng, firstSend }: { requestIndex: number; rng: Rng; firstSend: boolean },
): ScenarioDecision {
  switch (scenario) {
    case 'normal':
      return respond();
    case 'empty':
      return kind === 'submit'
        ? respond()
        : { kind: 'respond', delayMs: LATENCY.normal, data: 'empty' };
    case 'many-pages':
      return kind === 'submit'
        ? respond()
        : { kind: 'respond', delayMs: LATENCY.normal, data: 'many-pages' };
    case 'slow':
      return respond(LATENCY.slow);
    case 'variable-latency':
      return respond(
        LATENCY.variableMin + Math.floor(rng.next() * (LATENCY.variableMax - LATENCY.variableMin)),
      );
    case 'out-of-order':
      return respond(requestIndex % 2 === 0 ? LATENCY.outOfOrderSlow : LATENCY.outOfOrderFast);
    case 'timeout':
      return { kind: 'no-answer', delayMs: LATENCY.noAnswer, commitFirst: false };
    case 'network-error':
      return { kind: 'network-error', delayMs: LATENCY.normal };
    case 'http-4xx':
      return {
        kind: 'error',
        delayMs: LATENCY.normal,
        status: 400,
        code: 'bad_request',
        message: 'The request was rejected (simulated).',
      };
    case 'http-5xx':
      return unavailable;
    case 'ranking-fail':
      return kind === 'ranking' ? unavailable : respond();
    case 'history-fail':
      return kind === 'history' ? unavailable : respond();
    case 'submit-timeout-after-commit':
      return kind === 'submit' && firstSend
        ? { kind: 'no-answer', delayMs: LATENCY.noAnswer, commitFirst: true }
        : respond();
    case 'submit-unavailable':
      return kind === 'submit' ? unavailable : respond();
  }
}
