# Patient journey

Each visit has one text-message thread and one live visit page. Staff take a single action, "Next patient"; every estimate is computed from its timestamps.

| Step | When | What the patient gets | What staff do |
| --- | --- | --- | --- |
| 1. Booking | At booking | Confirmation text with a link to their visit page | Enter the appointment |
| 2. Pre-visit form | The day before | Reminder text with a short form: reason for visit, current medications, insurance | Nothing |
| 3. Delay warning | 1 hour before, only if running 15+ min late | "Running about 30 min late, come at 10:30" | Nothing: lateness is computed from call times |
| 4. Arrival | At the clinic | Scans the one QR code at the entrance and is recognised from their visit link, or confirms with a text code | Tap "Arrived" for patients who can't check in themselves |
| 5. Waiting | In the waiting room | Visit page shows an estimated call time as a range ("around 10:30–10:45") and explains when it slips | Nothing |
| 6. Called in | Start of the consultation | Called aloud by the medical professional; optional text "You're being called, room 3" | Press "Next patient", then call the name shown |
