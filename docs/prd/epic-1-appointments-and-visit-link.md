# Epic 1: Appointments and visit link

## Definition of done for every story

A story is done only when its own criteria pass and all of these hold:

- Patient pages work on the latest two versions of Safari (iOS) and Chrome (Android). Staff screens work in Chrome and Edge on the clinic PC.
- No text message contains health data: only names, times, the clinic name and links.
- Every patient or staff action writes a timestamped event (WR-20).
- Patient-facing wording has been approved by the clinic.
- The story has been tested end to end with the demo appointments file.

## Story 1.1: Import appointments from the demo file (WR-01, P0)

As a receptionist, I want to load the day's appointments from a file, so that every patient gets a visit page without anyone retyping them.

### Acceptance Criteria

1. The file is a CSV with the columns: patient name, phone number, professional, date, time.
2. Given a file of valid rows, when it is uploaded, then each row becomes an appointment and the screen shows how many were imported.
3. Given a row with a missing field or an invalid phone number, then that row is skipped and listed with its row number and the reason.
4. Belgian numbers are stored in international format: 0470 12 34 56 becomes +32 470 12 34 56.
5. Uploading the same file twice creates no duplicates. The same phone, professional, date and time count as one appointment.

**Success measure:** 100% of valid rows imported and 0 duplicates across 5 uploads of the demo file.

Story file: [docs/stories/1.1.import-appointments-from-the-demo-file.md](../stories/1.1.import-appointments-from-the-demo-file.md)

## Story 1.2: Private visit page (WR-02, P0)

As a patient, I want a private link for my visit, so that I can follow it without creating an account.

### Acceptance Criteria

1. Each appointment gets its own link that cannot be guessed from another patient's link.
2. The page shows the patient's first name, the appointment date and time, the professional's name and the clinic address.
3. The page never shows another patient's name, time or details.
4. The link works from 3 hours before to 3 hours after the appointment. Before that, it shows only the time it opens; after, it shows "This visit has ended".
5. Opening the link needs no login, password or app.

**Success measure:** at least 70% of patients open their visit page before arriving.

Story file: [docs/stories/1.2.private-visit-page.md](../stories/1.2.private-visit-page.md)

## Story 1.3: Confirmation text (WR-03, P0)

As a patient, I want a text confirming my appointment, so that I know it is booked and have my visit link.

### Acceptance Criteria

1. Given an imported appointment, then a text goes out within 1 minute of the import.
2. The text holds the clinic name, date, time, professional and visit link, and nothing about the reason for the visit.
3. A re-imported appointment does not get a second confirmation.
4. A failed send appears on the reception screen with the patient's name and the reason, such as an invalid number.

**Success measure:** at least 98% of confirmation texts delivered, per the text provider's delivery reports.

Story file: [docs/stories/1.3.confirmation-text.md](../stories/1.3.confirmation-text.md)

## Story 1.4: Day-before reminder (WR-04, P0)

As a patient, I want a reminder the day before, so that I don't forget and can fill in the form at home.

### Acceptance Criteria

1. The reminder goes out between 17:00 and 19:00 Brussels time on the day before the appointment.
2. It holds the time and a link to the pre-visit form. The form link is separate from the visit link and works from the reminder until the patient is called in.
3. If the form is already done, the reminder leaves out the form request.
4. An appointment removed from the file before 17:00 gets no reminder.
5. An appointment booked for the same day gets no reminder.

**Success measure:** at least 98% of reminders delivered inside the 17:00–19:00 window.

Story file: [docs/stories/1.4.day-before-reminder.md](../stories/1.4.day-before-reminder.md)
