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

## M4 — Playwright suite

- **Redundant touch release is only covered as a whole.** A held touch is released in three
  places: when the match pauses (`GameRuntime.pause`), when it resumes
  (`GameRuntime.resume`) and when the touch controls unmount (`TouchControls` cleanup).
  `e2e/touch.mobile.spec.ts` ("a touch held through a pause or the end of the match stops
  acting") checks the observable result — after Resume, a finger still on the screen no
  longer sails — so removing all three releases fails it, but removing any single one does
  not (mutation testing in M2b), because the others still release it. The release at the end
  of the match is likewise hygiene: an ended simulation ignores input. Decided in M2b to keep
  the redundancy and not change code for it; review in M4 whether a finer-grained check is
  worth adding.
