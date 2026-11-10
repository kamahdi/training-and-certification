# Epic 2: Pre-visit form

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 2.1: Fill in the pre-visit form at home (WR-05, P0)

As a patient, I want to give my details before I arrive, so that I don't fill in paperwork in the waiting room.

### Acceptance Criteria

1. Fields: reason for visit (up to 200 characters), current medications, health insurance fund (mutualité / ziekenfonds) and number, contact phone.
2. Before submitting, the patient sees what the data is used for and who sees it, and must accept to continue.
3. The patient can change answers until they are called in; after that, the form is read-only.
4. A patient who skips the form can still check in and be seen; their queue row shows "Form not done".
5. Answers are never included in a text message.

**Success measure:** at least 60% of booked patients complete the form before arriving, with a median completion time of 3 minutes or less.

Story file: [docs/stories/2.1.fill-in-the-pre-visit-form-at-home.md](../stories/2.1.fill-in-the-pre-visit-form-at-home.md)

## Story 2.2: See form answers in the queue (WR-06, P0)

As a medical professional, I want each patient's reason for visit in my queue, so that I can prioritise and prepare before calling them in.

### Acceptance Criteria

1. The queue row shows the reason for visit; clicking the row opens the full answers.
2. Only the professional the patient is booked with, and reception, can see the answers.
3. A form changed after check-in shows "updated" with the time of the change.

**Success measure:** in the pilot survey, at least 4 in 5 professionals say the reason for visit saves them time.

Story file: [docs/stories/2.2.see-form-answers-in-the-queue.md](../stories/2.2.see-form-answers-in-the-queue.md)
