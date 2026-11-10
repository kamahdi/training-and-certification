# Epic 8: Fast follow (P1)

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 8.1: Backup text when called (WR-23, P1)

As a patient who stepped out or doesn't hear well, I want a text when I'm called, so that I don't miss my turn.

### Acceptance Criteria

1. The text goes out within 10 seconds of the call: "You're being called, room 3".
2. The room comes from a setting on each professional's account.
3. A call undone within 30 seconds sends no text, or a "Sorry, not yet" if one already went out.

**Success measure:** missed calls fall by half compared with phase 1.

Story file: [docs/stories/8.1.backup-text-when-called.md](../stories/8.1.backup-text-when-called.md)

## Story 8.2: Satisfaction question after the visit (WR-24, P1)

As a clinic manager, I want patients to rate their wait, so that I can tell whether the service makes the visit better.

### Acceptance Criteria

1. One text 1 hour after the call, with a link to a single question: "How was your wait today?" from 1 to 5.
2. A patient gets the question at most once every 30 days.
3. Answers are stored without the patient's name.

**Success measure:** at least 30% of patients answer, with an average of 4.0 or higher.

Story file: [docs/stories/8.2.satisfaction-question-after-the-visit.md](../stories/8.2.satisfaction-question-after-the-visit.md)

## Story 8.3: Daily wait summary for the manager (WR-25, P1)

As a clinic manager, I want a summary of each day's waits, so that I can see whether scheduling or staffing causes delays.

### Acceptance Criteria

1. Ready at 19:00 each clinic day, per professional and for the clinic.
2. Shows: average arrival-to-call time, share called within the range shown, share called through "Next patient", delay texts sent, missed calls.
3. Contains no patient names.

**Success measure:** the manager opens the summary on at least 3 clinic days a week.

Story file: [docs/stories/8.3.daily-wait-summary-for-the-manager.md](../stories/8.3.daily-wait-summary-for-the-manager.md)

## Story 8.4: Texts and pages in French, Dutch or English (WR-26, P1)

As a patient, I want messages in my language, so that I understand them at a glance.

### Acceptance Criteria

1. Supported languages: French, Dutch, English.
2. The language comes from a column in the appointments file, or the clinic's default when it's empty.
3. The patient can switch language on the visit page; later texts follow the choice.

**Success measure:** 100% of texts go out in the patient's chosen language, checked in pre-launch testing.

Story file: [docs/stories/8.4.texts-and-pages-in-french-dutch-or-english.md](../stories/8.4.texts-and-pages-in-french-dutch-or-english.md)
