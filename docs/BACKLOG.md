# Backlog

Known issues and follow-ups recorded during development, with the milestone where they
should be reviewed.

## M3 — Ranking and match history

- **The mock API (MSW) does not start when `localStorage` is unavailable.** When storage
  access throws (blocked by privacy settings, `SecurityError`), `worker.start()` fails.
  `src/main.tsx` already handles it: it logs a warning ("Mock API unavailable; ranking and
  history are offline.") and the app keeps working (game, Options, Result). Ranking and
  Match History would be offline in that situation. Review in M3: confirm whether MSW itself
  needs storage, and how the tabs and the pending-submission queue should behave without it.
  Covered today by `e2e/result.spec.ts` ("without storage the result is shown for the
  session, never as saved"), which requires that specific warning and nothing else.
