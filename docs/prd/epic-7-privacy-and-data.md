# Epic 7: Privacy and data

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 7.1: Every step recorded with a timestamp (WR-20, P0)

As a clinic manager, I want every step of each visit recorded, so that estimates work and we can measure whether waiting improved.

### Acceptance Criteria

1. Events recorded: import, text sent / delivered / failed, form submitted, check-in and its method, call (normal or out of order), skip, flag set or cleared.
2. Each event carries the time to the second, in Brussels time.
3. Data is stored in the EU.
4. The manager can export a day's events as CSV, with names and phone numbers left out.

**Success measure:** 100% of pilot visits have a complete trail from import to call.

Story file: [docs/stories/7.1.every-step-recorded-with-a-timestamp.md](../stories/7.1.every-step-recorded-with-a-timestamp.md)

## Story 7.2: Automatic deletion after the retention period (WR-21, P0)

As a clinic manager, I want visit data deleted automatically, so that we keep personal data no longer than the GDPR allows.

### Acceptance Criteria

1. The retention period is a setting. Its value is set after the legal review (open question in the PRD).
2. When it ends, names, phone numbers and form answers are deleted; timestamps are kept without anything identifying the patient.
3. Deletion runs daily and records how many visits it removed.

**Success measure:** a monthly check finds 0 identifiable records older than the retention period.

Story file: [docs/stories/7.2.automatic-deletion-after-the-retention-period.md](../stories/7.2.automatic-deletion-after-the-retention-period.md)

## Story 7.3: Log of who viewed form answers (WR-22, P0)

As a clinic manager, I want to know who opened each patient's form answers, so that we can answer a patient's or the regulator's access request.

### Acceptance Criteria

1. Every opening of a patient's answers records who, when and which patient.
2. The manager can search the log by patient or by staff member.
3. Nobody can edit or delete log entries.

**Success measure:** 100% of form views appear in the log during a pre-launch audit test.

Story file: [docs/stories/7.3.log-of-who-viewed-form-answers.md](../stories/7.3.log-of-who-viewed-form-answers.md)

## Story 7.4: Erase a patient's data on request (WR-31, P0)

As a clinic manager, I want to erase everything we hold about one patient when they ask, so that the clinic honours the right to erasure (GDPR article 17) within the one-month legal deadline.

### Acceptance Criteria

1. Only the clinic manager role can erase. The manager finds the patient by phone number and sees every appointment and visit held for it.
2. Before erasing, the manager confirms by typing the last 4 digits of the phone number.
3. Erasure deletes, across all that patient's visits: names, phone numbers, form answers, recognised phones, text codes, message records and visit links. The visit page then shows "This visit has ended".
4. Events are kept only in anonymous form, with the patient's identity removed, so wait statistics stay correct (ADR-005).
5. A visit that is in progress today cannot be erased; the screen says "Finish or cancel today's visit first".
6. No text is sent to the number after erasure, including queued reminders and delay warnings.
7. An erasure list, holding only a hash of the phone number and the appointment times, stops a later re-import of the same appointments. Skipped rows are reported as "erased on request".
8. After any restore from backup, the erasure list is applied again before the service reopens.
9. Each request is recorded with the request date, completion date and the staff member who did it, without the patient's identity.

**Success measure:** in the pre-launch test, an erased test patient leaves 0 identifiable records in the database, and every real request is completed within 2 working days, well inside the one-month deadline.

Story file: [docs/stories/7.4.erase-a-patients-data-on-request.md](../stories/7.4.erase-a-patients-data-on-request.md)

## Story 7.5: Export a patient's data on request (WR-32, P0)

As a clinic manager, I want to give a patient a copy of everything we hold about them, so that the clinic answers a right-of-access request (GDPR article 15) within the one-month legal deadline.

### Acceptance Criteria

1. Only the clinic manager role can export. The manager finds the patient by phone number and sees every appointment and visit held for it.
2. Before exporting, a text code goes to the phone number on file; the patient reads it out or forwards it, and the manager enters it. This confirms the requester owns the number.
3. The export covers all that patient's visits: personal details, form answers, the texts sent to them (date and type), check-in and call times, and when staff opened their form answers and in which role.
4. It comes as a PDF the patient can read and a machine-readable file (JSON) for data portability (article 20).
5. It contains nothing about any other patient.
6. The file is created on demand, downloaded only by the manager and never sent by text. It is not kept on the server, and the download is logged.
7. Each request is recorded with the request date, completion date and the staff member who did it.

**Success measure:** in the pre-launch test, an export of a test patient contains 100% of the records held for them and 0 records of other patients; every real request is completed within 2 working days.

Story file: [docs/stories/7.5.export-a-patients-data-on-request.md](../stories/7.5.export-a-patients-data-on-request.md)
