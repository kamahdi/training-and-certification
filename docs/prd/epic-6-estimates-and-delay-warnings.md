# Epic 6: Estimates and delay warnings

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 6.1: See my estimated call time (WR-17, P0)

As a waiting patient, I want to see roughly when I'll be called, so that I can stop watching the door.

### Acceptance Criteria

1. The estimate = now + (patients ahead × average consultation length of the professional's last 5 calls today).
2. It is shown as a range, from 5 minutes before to 10 minutes after the estimate, rounded to 5 minutes: "around 10:30–10:45". These are starting values, tuned with pilot data.
3. It never shows a rank or a countdown.
4. It updates within 30 seconds of any call, skip or reorder.
5. Before the professional's first call of the day, the page shows the appointment time and "We'll update this once the clinic starts calling patients."
6. Once called, the page shows "You're being called".

**Success measure:** at least 80% of patients are called within the last range their page showed. This is Gate 3 in the PRD.

Story file: [docs/stories/6.1.see-my-estimated-call-time.md](../stories/6.1.see-my-estimated-call-time.md)

## Story 6.2: Be told why my estimate slipped (WR-18, P0)

As a waiting patient, I want to know why my time got later, so that I don't feel skipped.

### Acceptance Criteria

1. When the estimate moves 10 minutes or more later, the page shows a reason with the new range.
2. Reasons are generic: "A patient coming from emergency has been prioritised" or "Consultations are running longer than planned".
3. The message never names or describes another patient.

**Success measure:** 100% of slips of 10 minutes or more show a reason, checked against the event log.

Story file: [docs/stories/6.2.be-told-why-my-estimate-slipped.md](../stories/6.2.be-told-why-my-estimate-slipped.md)

## Story 6.3: Delay warning before leaving home (WR-19, P0)

As a patient booked later in the day, I want to know the clinic is running late before I leave, so that I don't wait there for nothing.

### Acceptance Criteria

1. Lateness = the average gap between appointment time and call time over the professional's last 3 calls.
2. When lateness is 15 minutes or more, patients booked 60–90 minutes later who haven't checked in get one text with a suggested arrival time.
3. Suggested arrival time = appointment time + lateness, rounded down to 5 minutes.
4. At most one warning per visit, plus one correction if lateness then changes by 20 minutes or more.
5. Patients already checked in get no warning.

**Success measure:** on late days, warned patients wait at least 30% less from arrival to call than patients who got no warning.

Story file: [docs/stories/6.3.delay-warning-before-leaving-home.md](../stories/6.3.delay-warning-before-leaving-home.md)
