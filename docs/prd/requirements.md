# Requirements

## P0: must have for launch

**R1. Visit link and texts.** Each appointment gets a private visit page and a text thread.

- A confirmation text with the visit link is sent within 1 minute of booking.
- A reminder with the form link is sent the day before, between 17:00 and 19:00.
- The visit link works on any phone browser, with no login and no install.
- The visit page never shows another patient's name or details.
- For the demo, appointments come from a sample file with one row per appointment: patient name, phone number, professional, date and time. Confirmation texts go out when the file is loaded.

**R2. Pre-visit form.** A short form the patient completes from the reminder or the visit page.

- Fields: reason for visit (free text, max 200 characters), current medications, insurance details, contact phone.
- No clinical history or symptom questionnaire in v1.
- Answers are shown to staff only: on the professional's queue and at reception.
- A patient who skips the form can still check in and be seen.

**R3. Check-in with one shared QR code.** One printed code at the entrance opens the check-in page.

- Given the phone has opened the visit link before, when the patient scans, then they see "Hi Sara, tap to confirm you're here" and check in with one tap.
- Given the phone is not recognised, when the patient enters their phone number, then they get a 4-digit code by text and are checked in once it is entered.
- Given the number matches no appointment today, then the page says "Please see reception" and nothing is recorded.
- Reception can tap "Arrived" for any patient on today's list.

**R4. Professional's queue with priority.** Each medical professional sees their own list of arrived patients.

- Each row shows: name, appointment time (or walk-in), arrival time, minutes waiting, form done or not, reason for visit, emergency flag.
- Default order: patients coming from emergency first, then booked patients by appointment time, then walk-ins in the gaps. Arriving early does not move a patient up.
- Reception or the professional can set or clear the emergency flag.
- The list updates within 5 seconds of any check-in or flag change.

**R5. "Next patient" records the call.** The professional presses one button before calling a patient aloud.

- "Next patient" shows the name at the top of the list to call, and records the call time.
- The professional can tap any other name instead; the out-of-order pick is recorded.
- "Not here, skip" puts the patient back in the list and records a missed call.
- Runs in a browser on the professional's clinic PC, alongside the web app they already use.

**R6. Estimated call time on the visit page.** The patient sees a range, not a countdown or a rank.

- Shown as "around 10:30–10:45" and updated within 30 seconds of any call or reorder.
- When the estimate moves later by 10 minutes or more, the page says why in generic words: "An urgent case has been prioritised. New estimate: around 10:50."
- Before any call has been recorded that day, the page shows the appointment time and "We'll update this once the clinic starts calling patients."

**R7. Delay warning before leaving home.** Patients are warned when the clinic runs late.

- Lateness = the average gap between appointment time and call time over the last 3 calls for that professional.
- When lateness is 15 minutes or more, patients booked in the next 60–90 minutes who haven't arrived get one text with a suggested arrival time.
- At most one delay text per patient per visit, plus one correction if lateness changes by 20 minutes or more.

**R8. Erase a patient's data on request.** The clinic can honour the GDPR right to erasure (article 17).

- The clinic manager finds a patient by phone number and erases all their personal data within 2 working days of the request.
- Wait statistics are kept in anonymous form.
- Erased appointments cannot come back through a re-import or a restore from backup.

**R9. Give a patient a copy of their data.** The clinic can answer the GDPR right of access (article 15).

- The clinic manager exports all of one patient's data, found by phone number, after confirming the requester with a text code sent to that number.
- The copy comes as a readable PDF and a machine-readable file, within 2 working days of the request.

## P1: fast follow

- **Backup text when called:** "You're being called, room 3", for patients who stepped out or don't hear well.
- **One-question satisfaction text** after the visit.
- **Daily summary for the clinic manager:** average wait, share of patients called on time, delay texts sent.
- **Texts and visit page in the patient's language**, chosen at booking.

## P2: design for, don't build

- **Leave and come back:** "You're 2 away, head back." Ship only after the estimates meet goal 2.
- **Shared queue across professionals**, where any available doctor takes the next patient.
- **Integration with the clinic's scheduling or medical-records system**, replacing the sample appointments file with the online agenda's API.
- **Clinical questions in the form**, once the GDPR review covers clinical data.
