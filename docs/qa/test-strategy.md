# Test strategy

Most tests sit on the pure logic patients rely on (queue order, estimates, timing rules) and on the database layer where privacy is enforced; a small set of browser journeys proves the whole flow. Every acceptance criterion in the backlog maps to at least one test tagged with its story id, so the developer agents and Kamel can see what is covered.

## Test layers

| Layer | What it covers | Tools | Rough size | Runs |
| --- | --- | --- | --- | --- |
| Unit | Pure logic: queue order, estimates, lateness, delay-warning rule, CSV row checks, phone formats, text templates | Vitest | About 300 tests, under 30 s | On every save and every push |
| Integration | API and Postgres together: transactions, events, notifications, jobs, roles, erasure and export | Vitest, Testcontainers with the production Postgres version, a fake text provider | About 120 tests, under 4 min | Every push |
| Component | React screens in each state: loading, empty, error, live, reconnecting | Vitest, React Testing Library, axe-core | About 80 tests, under 1 min | Every push |
| End to end | Whole journeys in a real browser against the running stack | Playwright, with a phone profile for patients and desktop Chrome and Edge for staff | About 7 journeys, under 10 min | Nightly and before each release |
| Load and resilience | 200 patient streams and 10 staff streams; dropped database listener | k6 or a Node script | 2–3 scenarios | Weekly and before each release |

## Coverage targets

- **Estimates, queue order, delay rules, erasure and export:** 100% branch coverage and a mutation score of at least 80% (Stryker). Every promise made to a patient, and every GDPR duty, runs through this code.
- **Other server modules:** at least 85% line coverage.
- **React screens:** no line target. Every screen state has a component test, and axe-core reports no violations.
- **Acceptance criteria:** every P0 criterion in the backlog has at least one test tagged with its story id before the phase 1 release; P1 criteria before phase 2.

## Test plan by area

| Area | Stories | Test types | Must cover |
| --- | --- | --- | --- |
| Appointment import | WR-01 | Unit, integration | Valid and invalid rows; Belgian phone formats (0470…, +32…, 0032…); re-import without duplicates; a 500-row file; columns in another order; accented names (é, ë, ç) |
| Visit links | WR-02 | Integration, end to end | Link opens 3 h before and closes 3 h after the appointment; unknown token gives 404; only the token's hash is in the database; no other patient's data on the page |
| Texts and timing | WR-03, WR-04, WR-19, WR-23 | Unit for rules, integration for jobs with a controlled clock | Confirmation within 1 min; reminders only 17:00–19:00 Brussels time; no reminder for same-day bookings; daylight-saving days; failures shown to reception; every template in French, Dutch and English checked for health data |
| Pre-visit form | WR-05, WR-06 | Component, integration | Consent required; 200-character limit; editable until called, read-only after; answers not readable as plain text in the database; every view writes an access-log entry |
| Check-in | WR-07 to WR-10 | Integration, end to end | One tap on a recognized phone; text code expires after 10 min and locks after 3 tries; rate limits; two appointments on one number; check-in window; walk-ins placed in the first gap |
| Queue and priority | WR-11 to WR-13 | Unit for order, integration for roles | Order rule including emergency flags; early arrival never moves a patient up; a professional gets 403 on another's queue; idle lock at 15 min |
| Calling | WR-14 to WR-16 | Integration | Stale queue version gives 409 and calls nobody; undo within 30 s; second skip marks "missed"; out-of-order calls logged |
| Estimates | WR-17, WR-18 | Unit, property-based (fast-check) | Range rounding; state before the first call; slip reason at 10 min or more; an estimate never earlier than now |
| Live updates | ADR-002 | Integration, load | The 7 tests listed in the live-updates solution design |
| Privacy | WR-20 to WR-22, WR-31, WR-32 | Integration | Every write endpoint emits an event; retention deletion leaves events anonymous; erasure leaves 0 identifiable rows in any table; erased appointments cannot be re-imported; export is complete and holds no other patient; logs hold no tokens, phone numbers or answers |
| Accessibility | All screens | Component (axe-core), manual check | No axe violations; patient pages usable at 200% text size, since many patients are older |

## End-to-end journeys

Each journey runs with the demo appointments file, a controlled clock and the fake text provider.

1. **Booked patient, recognized phone:** import, confirmation text, form filled the day before, visit link opened on the day, one-tap QR check-in, "Next patient", visit page shows "You're being called".
2. **Unrecognized phone:** QR check-in with a text code, then the estimate appears.
3. **Emergency patient:** reception flags them, they jump to the top, and the patients behind see the slip reason.
4. **Clinic running late:** three late calls trigger delay texts for patients booked 60–90 minutes later.
5. **No smartphone and a walk-in:** reception checks in one patient and registers the other; both appear in the right order.
6. **Erasure:** the manager erases a patient; their link shows "This visit has ended" and a re-import skips their row.
7. **Network drop:** the staff screen shows "Reconnecting…", falls back to polling, then returns to live.

## Example test cases

Worked examples for the logic where a mistake costs most. The developer agents should write the rest in the same form.

**T-01 · Queue order (WR-12, WR-13)**

- Given Ana (booked 10:00, arrived 9:30), Ben (booked 9:45, arrived 9:50) and Dan (booked 10:15, arrived 10:05, flagged from emergency)
- When the queue is built at 10:06
- Then the order is Dan, Ben, Ana. Ana's early arrival does not move her ahead of Ben.

**T-02 · Estimate range (WR-17)**

- Given 2 patients ahead, the last 5 consultations averaging 12 minutes, and the time 10:00
- When the estimate is computed
- Then the estimate is 10:24, and the page shows "around 10:20–10:35" (5 minutes before and 10 after, rounded to 5 minutes).

**T-03 · Delay warning (WR-19)**

- Given the professional's last 3 calls came 20, 15 and 25 minutes after their appointment times, so lateness is 20 minutes
- And Eva is booked at 11:30, has not checked in, and the time is 10:15
- When the delay check runs
- Then Eva gets one text suggesting she arrive at 11:50. When the check runs again 5 minutes later, she gets no second text.

**T-04 · Two screens, one click (WR-14)**

- Given the professional's screen shows queue version 57
- And reception checks a patient in, which makes the version 58
- When the professional presses "Next patient" with version 57
- Then the server answers 409 with the fresh queue, and no call event is written.

**T-05 · Reminder on a daylight-saving day (WR-04)**

- Given an appointment on Monday 26 October 2026 at 9:00; clocks go back on Sunday 25 October
- When the reminder job runs
- Then the reminder goes out at 17:00 Brussels time, which is 16:00 UTC on 25 October. A reminder on 24 October goes out at 15:00 UTC.

**T-06 · No health data reaches patients (WR-06, ADR-002)**

- Given a waiting patient whose reason for visit is "chest pain"
- When every event type is triggered for that professional's queue
- Then no message on any patient stream contains "chest pain" or another patient's name.

**T-07 · Erasure is complete (WR-31)**

- Given a test patient with 2 visits, form answers and 4 texts sent
- When the manager erases them
- Then searching every table and column for their name and phone number, in every format, finds 0 rows. The number of events is unchanged, but none links to the patient. Re-importing the original file skips both rows as "erased on request".

**T-08 · Link window (WR-02, ADR-004)**

- Given an appointment at 14:00
- Then the link shows "opens at 11:00" at 10:59, is live from 11:00 to 17:00, and shows "This visit has ended" at 17:01.

## Time, test data and fakes

- **One clock.** All code reads the time through one injectable clock; a lint rule forbids `Date.now()` and `new Date()` anywhere else. Times are stored in UTC and shown in Brussels time.
- **Daylight-saving dates** are fixed test cases: 25 October 2026 and 28 March 2027.
- **Synthetic data only.** Tests, the demo file and bug reports use generated patients, never real ones. The demo file is committed to the repository and holds only invented names and numbers.
- **Fake text provider.** It records every message and can simulate a failed send and a late delivery report. Once the real provider is chosen, a small contract test runs against its sandbox before each release.
- **Database isolation.** Most integration tests run inside a transaction that is rolled back. Tests that need notifications use a fresh database per file instead, because Postgres sends notifications only on commit.
- **No sleeps.** Tests wait for the event they expect, with a timeout. A flaky test is quarantined within a day and gets an issue.

## Working with developer agents, and the CI pipeline

**How agents work with tests**

1. Each story is handed to an agent together with its acceptance criteria and the matching row of the test plan.
2. The agent writes failing tests first, each named after its story and criterion, for example `WR-14: undo within 30 s restores the patient`.
3. Kamel reviews the tests before the code: do they check the criterion, rather than the way it was built?
4. The agent writes the code until the tests pass.
5. A script lists every acceptance criterion with its tagged tests. A story with an untested criterion cannot be marked Done in the backlog.
6. An agent may not change a test belonging to a story that is already Done without saying so in the pull request.

**Pipeline**

| When | What runs | Gate |
| --- | --- | --- |
| Every push | Lint, type check, unit, component and integration tests; under 6 minutes | Must pass to merge |
| Nightly | End-to-end journeys, mutation tests on core modules, dependency audit | A failure opens an issue the next morning |
| Before each release | Load and resilience tests, text-provider contract test, manual accessibility check, dry run with the demo file | All must pass, signed off by Kamel |

## Gaps found while planning tests

These cannot be tested until someone decides them:

- [ ] **Walk-in placement:** WR-10 places walk-ins "in the first gap between booked patients", but "gap" is not defined. Proposal: a walk-in goes after booked patients whose appointment time has passed, and before those whose time has not. *Kamel*
- [ ] **Cancellations in a re-import:** WR-04 says a removed appointment gets no reminder, but WR-01 doesn't say what a re-import does with a missing row. Proposal: a row missing from a re-import of the same day's file counts as cancelled. *Kamel*
- [ ] **Staff accounts:** no story covers creating accounts, resetting passwords or deactivating staff, yet WR-11 depends on them. Add a story. *Kamel*
- [ ] **Clinic settings:** no story covers setting rooms, default language, retention period or the link and check-in windows. Add a story; tests read these values from settings rather than hard-coding them. *Kamel*
- [ ] **Text provider:** its delivery-report format is unknown until it is chosen, so the contract test waits for that decision. *Kamel*

Accepted without a test: someone checking in from outside the clinic, as decided in the PRD and ADR-004.
