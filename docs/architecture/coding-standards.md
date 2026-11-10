# Coding Standards

Rules the developer agents must follow on every story. They come from the architecture and test strategy.

- **One clock.** Read the time only through `server/clock.ts`. `Date.now()` and `new Date()` are banned elsewhere by lint. Store UTC; show Europe/Brussels.
- **Every write emits its event.** Use the shared write function, which updates state and appends the event in one transaction (ADR-005). Tests check that no write path skips it.
- **No health data outside staff screens.** Never put a reason for visit or form answer in a text, a patient stream payload or a log line.
- **Logs carry ids, not people.** No names, phone numbers, visit tokens or answers in logs; log route patterns, not raw paths.
- **Module boundaries.** A module reads and writes only its own tables; other modules go through its functions (ADR-001).
- **Tests first, tagged.** Write failing tests named `WR-xx: <criterion>` before the code; do not change a Done story's tests without saying so in the pull request.
- **Synthetic data only** in tests, fixtures and bug reports.
- **Settings, not constants.** Estimate offsets, link and check-in windows and retention come from clinic settings.
