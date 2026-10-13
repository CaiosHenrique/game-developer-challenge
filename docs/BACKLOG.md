# Backlog

Known issues and follow-ups recorded during development, with the milestone where they
should be reviewed.

## M3 — Ranking and match history

- **Resolved in M3a: the mock API (MSW) now starts when `localStorage` is unavailable.**
  MSW reads `localStorage` once, while its module loads (its cookie store), and failed when
  storage access threw. `src/mocks/storageFallback.ts` gives MSW an in-memory storage only
  while it loads and restores the real one right after, so the app still treats storage as
  unavailable (the Result screen never claims the match was saved). The mock data then lives
  in memory and the menu says it resets on reload. If the property cannot be replaced (a
  browser where it is not configurable), MSW fails as before: the app warns and the tabs show
  that ranking and history are offline. Covered by `e2e/records.spec.ts` and
  `e2e/result.spec.ts`.

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
