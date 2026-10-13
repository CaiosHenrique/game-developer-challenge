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
- **Closed in M4: accepted as it is.** The observable effect is covered (a finger still on
  the screen does not act after a pause, a resume or the end of the match). A finer test
  would need to expose the internal input state only for tests, with no proportional
  benefit. The input code is unchanged.

## M6 — Accessibility, performance and documentation

- **Open: memory in a normal browser session.** The automated runs found no leak in the
  game's resources, and a slow residual heap growth that seems to come from MSW's
  service-worker messaging and the DevTools instrumentation. That attribution is a hypothesis:
  it was never checked without the DevTools protocol attached. Procedure in
  [perf/README.md](perf/README.md#pending-memory-in-a-normal-edge-session). No change to the
  game or to MSW until it is checked.
- **Open: isolated stall of unknown cause.** One headed match of the first performance run had
  15 frames of about 1 s; it never happened again in later runs and its cause was not
  determined ([perf/README.md](perf/README.md)). If it shows up again, record it with long
  animation frame attribution (already on in `e2e/perf/`) before drawing conclusions.
- **Open (accessibility, not verified with a screen reader):** the pager's status changes
  twice per page change (`Loading page N…`, then `Page N of M`) and may be announced twice; the
  match screen has no heading. Both need a real screen reader to decide whether to change
  anything. No screen reader was used in this project so far.
- **Closed before M7: the comment now documents submission of the pending queue at the end of
  every match.** The comment at the top of `App` (`src/App.tsx`) omitted that the end of every
  match also sends the whole queue (`submitAll` in `handleMatchComplete`); only the comment
  changed, not the code.
- **Open (M7):** test and profiling reports are not versioned yet (only the performance JSON in
  `docs/perf/`); the public deployment is not documented or checked yet; no CI workflow.
