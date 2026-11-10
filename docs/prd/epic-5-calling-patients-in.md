# Epic 5: Calling patients in

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 5.1: Call the next patient (WR-14, P0)

As a medical professional, I want one click that tells me who to call, so that recording the call costs me nothing extra.

### Acceptance Criteria

1. "Next patient" shows the name of the patient at the top of the list, to call aloud.
2. The click records the call time and takes the patient off the waiting list.
3. The call can be undone within 30 seconds; the patient returns to their place.
4. Every waiting patient's estimate updates within 30 seconds of the call.

**Success measure:** at least 90% of patients seen are called through "Next patient". This is Gate 1 in the PRD.

Story file: [docs/stories/5.1.call-the-next-patient.md](../stories/5.1.call-the-next-patient.md)

## Story 5.2: Call a patient out of order (WR-15, P0)

As a medical professional, I want to call any waiting patient, so that my clinical judgement overrides the default order.

### Acceptance Criteria

1. Clicking any name in the list offers "Call Sara B." and records the call like "Next patient".
2. The call is logged as out of order, with how many places it skipped.
3. No reason is asked for.

**Success measure:** 100% of out-of-order calls are logged, so the weekly report shows how often the default order is wrong.

Story file: [docs/stories/5.2.call-a-patient-out-of-order.md](../stories/5.2.call-a-patient-out-of-order.md)

## Story 5.3: Skip a patient who isn't there (WR-16, P0)

As a medical professional, I want to skip a patient who doesn't answer, so that the queue keeps moving.

### Acceptance Criteria

1. "Not here, skip" records a missed call and puts the patient back right after the next person in line.
2. A second skip for the same patient marks them "missed" and removes them from the list.
3. Reception can return a missed patient to the queue.

**Success measure:** missed calls stay under 5% of all calls.

Story file: [docs/stories/5.3.skip-a-patient-who-isnt-there.md](../stories/5.3.skip-a-patient-who-isnt-there.md)
