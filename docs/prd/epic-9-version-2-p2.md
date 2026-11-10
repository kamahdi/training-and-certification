# Epic 9: Version 2 (P2)

These are designed for now but built only once their gate in the PRD is met.

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 9.1: Leave and come back (WR-27, P2)

As a checked-in patient, I want to leave the waiting room and be told when to return, so that I can use the time elsewhere.

### Acceptance Criteria

1. Offered only after the estimates meet Gate 3 (80% of patients called within the range shown).
2. The patient opts in after check-in and is texted when 2 patients are ahead of them.
3. The patient taps "I'm back"; the professional's queue shows who is out.

**Success measure:** at least 95% of patients who leave are back before they are called.

Story file: [docs/stories/9.1.leave-and-come-back.md](../stories/9.1.leave-and-come-back.md)

## Story 9.2: Shared queue across professionals (WR-28, P2)

As a receptionist, I want patients who can see any professional in a shared queue, so that whoever is free takes the next patient.

### Acceptance Criteria

1. The clinic chooses which professionals share a queue.
2. "Next patient" for any of them takes the top of the shared list.
3. Patients booked with a named professional stay in that professional's queue.

**Success measure:** average wait falls by at least 15% on days with 2 or more professionals in a shared queue.

Story file: [docs/stories/9.2.shared-queue-across-professionals.md](../stories/9.2.shared-queue-across-professionals.md)

## Story 9.3: Sync appointments from the online agenda (WR-29, P2)

As a receptionist, I want appointments to come straight from the online agenda, so that nobody uploads a file each day.

### Acceptance Criteria

1. New, changed and cancelled appointments appear within 5 minutes of the change in the agenda.
2. A cancelled appointment stops all its texts.
3. The file import stays available as a fallback.
4. Depends on which agenda product the clinic uses and its API (open question).

**Success measure:** no manual file import in the 4 weeks after go-live.

Story file: [docs/stories/9.3.sync-appointments-from-the-online-agenda.md](../stories/9.3.sync-appointments-from-the-online-agenda.md)

## Story 9.4: Clinical questions in the form (WR-30, P2)

As a medical professional, I want patients to answer clinical questions before the visit, so that the consultation starts with the history already in hand.

### Acceptance Criteria

1. Built only after the GDPR review covers clinical data.
2. Each professional chooses their own questions.
3. Answers are visible only to the professional the patient is booked with, and every view is logged (WR-22).

**Success measure:** at least half of professionals say they use the answers during the consultation.

Story file: [docs/stories/9.4.clinical-questions-in-the-form.md](../stories/9.4.clinical-questions-in-the-form.md)
