# Epic 4: Professional queue

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 4.1: Sign in on the clinic PC (WR-11, P0)

As a medical professional, I want to sign in on the clinic PC, so that only I see my queue and my patients' answers.

### Acceptance Criteria

1. Each professional has their own account; reception has a reception account that sees all of today's queues; the clinic manager has a manager account for summaries and data requests.
2. A professional sees only patients booked with them, plus walk-ins assigned to them.
3. The screen locks after 15 minutes without activity and needs the password again.
4. Signing out from one PC does not affect another.

**Success measure:** no professional can open another professional's queue, checked in a pre-launch access test.

Story file: [docs/stories/4.1.sign-in-on-the-clinic-pc.md](../stories/4.1.sign-in-on-the-clinic-pc.md)

## Story 4.2: See my queue in priority order (WR-12, P0)

As a medical professional, I want my waiting patients in the order I should call them, so that I don't need to ask reception who's next.

### Acceptance Criteria

1. Each row shows: name, appointment time or "walk-in", arrival time, minutes waiting, form done or not, reason for visit, emergency flag.
2. Order: patients coming from emergency first, then booked patients by appointment time, then walk-ins in the gaps.
3. Arriving early does not move a patient up the list.
4. The list updates within 5 seconds of any check-in, flag or call, without reloading the page.
5. With nobody waiting, the screen says "No patients waiting".

**Success measure:** fewer than 20% of calls are out of order, a sign the default order is trusted.

Story file: [docs/stories/4.2.see-my-queue-in-priority-order.md](../stories/4.2.see-my-queue-in-priority-order.md)

## Story 4.3: Flag a patient coming from emergency (WR-13, P0)

As a receptionist or medical professional, I want to flag a patient sent from the emergency department, so that they are seen first.

### Acceptance Criteria

1. Reception and the professional can each set or clear the flag on any waiting patient.
2. A flagged patient moves to the top of the queue within 5 seconds.
3. Several flagged patients are ordered by arrival time.
4. Clearing the flag returns the patient to their normal place.
5. The flag never appears on any patient's visit page.

**Success measure:** flagged patients are the next person called in at least 95% of cases.

Story file: [docs/stories/4.3.flag-a-patient-coming-from-emergency.md](../stories/4.3.flag-a-patient-coming-from-emergency.md)
