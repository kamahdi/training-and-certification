# Epic 3: Check-in

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 3.1: Check in by QR on a recognised phone (WR-07, P0)

As a patient who has opened my visit link, I want to check in by scanning the code at the entrance, so that I don't queue at the front desk.

### Acceptance Criteria

1. One printed QR code at the entrance opens the check-in page for that clinic.
2. Given the phone has opened the patient's visit link during its 3-hour window before the appointment, when they scan, then they see "Hi Sara, tap to confirm you're here".
3. One tap checks them in, records the time and moves them to the professional's queue within 5 seconds.
4. Check-in opens 60 minutes before the appointment. Earlier, the page says "Check-in opens at 9:00".
5. A patient who is already checked in sees "You're checked in" and their estimate, not a second check-in.

**Success measure:** at least 60% of arrivals check themselves in by QR code.

Story file: [docs/stories/3.1.check-in-by-qr-on-a-recognised-phone.md](../stories/3.1.check-in-by-qr-on-a-recognised-phone.md)

## Story 3.2: Check in by QR with a text code (WR-08, P0)

As a patient on a phone the system doesn't recognise, I want to check in with my phone number, so that I can still skip the front desk.

### Acceptance Criteria

1. Given an unrecognised phone, when the patient enters their number, then a 4-digit code is texted to it.
2. The code works for 10 minutes. After 3 wrong attempts the page says "Please see reception".
3. A number with no appointment today shows "Please see reception" and records nothing.
4. A number with two appointments today asks the patient to pick which one.

**Success measure:** at least 90% of code check-ins succeed on the first code.

Story file: [docs/stories/3.2.check-in-by-qr-with-a-text-code.md](../stories/3.2.check-in-by-qr-with-a-text-code.md)

## Story 3.3: Reception marks a patient as arrived (WR-09, P0)

As a receptionist, I want to check in a patient myself, so that patients without a smartphone keep their place.

### Acceptance Criteria

1. Reception sees today's appointments and can search them by name or phone number.
2. One click on "Arrived" checks the patient in and records the time.
3. "Arrived" can be undone within 1 minute, for a wrong click.

**Success measure:** a manual check-in takes 10 seconds or less, timed in the pilot.

Story file: [docs/stories/3.3.reception-marks-a-patient-as-arrived.md](../stories/3.3.reception-marks-a-patient-as-arrived.md)

## Story 3.4: Register a walk-in (WR-10, P0)

As a receptionist, I want to add a patient who arrives without an appointment, so that they join the right queue.

### Acceptance Criteria

1. Reception enters a name, a phone number (optional) and the professional.
2. The walk-in is checked in at once and placed in the first gap between booked patients.
3. With a phone number, the walk-in gets a visit link by text and sees their estimate like any other patient.

**Success measure:** a walk-in is registered in 30 seconds or less.

Story file: [docs/stories/3.4.register-a-walk-in.md](../stories/3.4.register-a-walk-in.md)
