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
- **Closed in M7: test report and public deployment.** The HTML report of the end-to-end run
  on `041e795` is kept in [reports/e2e-041e795.html](reports/e2e-041e795.html), recorded in
  [TESTING.md](TESTING.md#recorded-run); the performance results stay in `docs/perf/`. The
  production deployment (https://game-developer-challenge-azure.vercel.app) is documented and
  was checked on 13 October 2026, with the caveats listed in the
  [README](../README.md#production): which deployment the domain points to was not checked
  in the Vercel dashboard.
- **Open (M7): no CI workflow.** The repository has none; the visual baselines would need
  their own Linux versions first (see [TESTING.md](TESTING.md#no-continuous-integration)).
- **Open: asset license and redistribution, to confirm with Jungle Gaming.** The challenge
  repository states no license for its assets. The game art appears to derive from Kenney's
  Pirate Pack (CC0 1.0), but the license of the repainted art distributed with the challenge,
  and of the UI art, is not confirmed, and neither is permission to redistribute them in the
  public deployment. Nothing here is resolved; see
  [README](../README.md#assets-and-attribution).

## M5 — Audio and visual polish

- **Done (M5-P1a, commit `742262c`, deployed): sound effects with a mute switch.** 19 of the
  challenge's WAV files are played (no ambient loops). Their author and license are **not
  confirmed**, like the rest of the asset pack.
- **Use of the sounds confirmed by the project owner.** The owner confirmed directly with
  Jungle Gaming that the challenge's audio files may be used. The confirmation was verbal: no
  written license or statement is recorded, and the author and license of the WAV files remain
  unidentified. Publishing (every push to `main` deploys to production) is the owner's
  decision. The art and UI license question above is still open.
- **Open (decision): the mute switch is in the pause dialog, not in the HUD.** A HUD button
  would change the two arena baselines of the visual regression tests; moving it there means
  regenerating them deliberately.
