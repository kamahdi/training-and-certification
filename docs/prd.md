# Clinic Waiting Room Product Requirements Document (PRD)

Nov 10, 2026 · @KAMEL

A text-message and web-page service that tells patients when they will really be seen, from booking to the moment a medical professional calls them in, with no app to install.

Epics: [docs/prd/](prd/index.md) · Stories: [docs/stories/](stories/)

Architecture: [docs/architecture.md](architecture.md) · UX: [docs/front-end-spec.md](front-end-spec.md)

Test strategy: [docs/qa/test-strategy.md](qa/test-strategy.md)

## Problem statement

A patient who has checked in waits about 40 minutes without knowing when they will be called. Much of that wait starts before arrival: the patient comes on time to a clinic that is already running late. Nobody can tell them how long is left, because the clinic itself does not record when each patient is called in.

The cost of not solving it:

- **Patients** lose time they could have spent elsewhere, and the uncertainty makes the visit feel worse than it is.
- **Reception** is interrupted by "how much longer?" questions while handling phones, check-ins and paperwork.
- **Medical professionals** start consultations with intake details still missing, which makes each visit longer and pushes the queue back further.

Evidence so far is the client's description of the problem. The pilot in phase 0 will measure the real figures.

## Goals

**For patients**

1. **Less time spent in the waiting room.** Average time from arrival to being called in falls by 30% against the pilot baseline.
2. **An estimate they can trust.** At least 80% of patients are called in within the time range their visit page showed.

**For the clinic**

3. **Fewer interruptions at reception.** "How much longer?" questions at the desk fall by 50%.
4. **Visits start with intake done.** At least 60% of patients complete the pre-visit form before arriving.
5. **The data is reliable.** At least 90% of patients are called in through "Next patient", so the timestamps behind every estimate exist.

## Non-goals

- **No native app.** Nobody installs an app for one clinic visit; text messages and a web page reach every patient with a phone.
- **No automatic call-in.** A medical professional still calls each patient aloud. The system records the call; it does not replace it.
- **No leave-and-come-back alerts in v1.** Telling a patient "you're 2 away, head back" needs precise estimates. It waits until pilot data shows they are accurate (P2).
- **No integration with the clinic's scheduling or medical-records system.** Each system needs its own integration; the demo and v1 load appointments from a sample file, and the online agenda's API follows in P2.
- **No clinical data in the form.** Medical history and symptoms are sensitive health data under the GDPR and add legal work. v1 collects administrative details and a short reason for the visit only.
- **No shared queue across doctors.** Each professional has their own queue; pooling patients across doctors is a v2 problem.

## Patient journey

Each visit has one text-message thread and one live visit page. Staff take a single action, "Next patient"; every estimate is computed from its timestamps.

| Step | When | What the patient gets | What staff do |
| --- | --- | --- | --- |
| 1. Booking | At booking | Confirmation text with a link to their visit page | Enter the appointment |
| 2. Pre-visit form | The day before | Reminder text with a short form: reason for visit, current medications, insurance | Nothing |
| 3. Delay warning | 1 hour before, only if running 15+ min late | "Running about 30 min late, come at 10:30" | Nothing: lateness is computed from call times |
| 4. Arrival | At the clinic | Scans the one QR code at the entrance and is recognised from their visit link, or confirms with a text code | Tap "Arrived" for patients who can't check in themselves |
| 5. Waiting | In the waiting room | Visit page shows an estimated call time as a range ("around 10:30–10:45") and explains when it slips | Nothing |
| 6. Called in | Start of the consultation | Called aloud by the medical professional; optional text "You're being called, room 3" | Press "Next patient", then call the name shown |

## User stories

**Patient**

- As a patient, I want to be told before I leave home that the clinic is running late, so that I arrive closer to when I will be seen.
- As a patient, I want to check in by scanning a code at the entrance, so that I don't queue at the front desk.
- As a patient, I want to see roughly when I will be called, so that I can stop watching the door.
- As a patient, I want to be told why my estimate got later, so that I don't feel skipped.
- As a patient, I want to fill in admin details at home, so that I don't do it on a clipboard in the waiting room.
- As a patient without a smartphone, I want reception to check me in, so that I still keep my place.

**Medical professional**

- As a doctor or nurse, I want to see who has arrived, in priority order, with their reason for visit, so that I know who to call next and why they are here.
- As a doctor or nurse, I want to call any patient out of order, so that my clinical judgement overrides the default order.

**Receptionist**

- As a receptionist, I want to flag a patient coming from emergency at check-in, so that the professional sees them first.
- As a receptionist, I want to mark a patient as not here when they don't answer the call, so that the queue keeps moving.

**Clinic manager**

- As a clinic manager, I want to see actual wait times per day, so that I can tell whether scheduling or staffing is the cause of delays.

## Requirements

### P0: must have for launch

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

### P1: fast follow

- **Backup text when called:** "You're being called, room 3", for patients who stepped out or don't hear well.
- **One-question satisfaction text** after the visit.
- **Daily summary for the clinic manager:** average wait, share of patients called on time, delay texts sent.
- **Texts and visit page in the patient's language**, chosen at booking.

### P2: design for, don't build

- **Leave and come back:** "You're 2 away, head back." Ship only after the estimates meet goal 2.
- **Shared queue across professionals**, where any available doctor takes the next patient.
- **Integration with the clinic's scheduling or medical-records system**, replacing the sample appointments file with the online agenda's API.
- **Clinical questions in the form**, once the GDPR review covers clinical data.

## Success metrics

The number everything else depends on is the call-recording rate. Below 90%, the estimates drift and patients stop trusting the visit page. Baselines come from the phase 0 pilot.

| Metric | Type | How it's measured | Success | Stretch | Check at |
| --- | --- | --- | --- | --- | --- |
| Patients called through "Next patient" | Leading | Recorded calls ÷ patients seen | 90% | 98% | Week 1 |
| Patients self-checking in by QR code | Leading | QR check-ins ÷ arrivals | 60% | 80% | Week 2 |
| Pre-visit form completed before arrival | Leading | Forms done ÷ booked patients | 60% | 75% | Week 2 |
| Called within the range shown | Leading | Call time inside the last range shown ÷ calls | 80% | 90% | Week 2 |
| Arrival-to-call time | Lagging | Average minutes, against the pilot baseline | −30% | −50% | Month 1 |
| "How much longer?" questions at the desk | Lagging | Reception tally per day, against the pilot | −50% | −75% | Month 1 |
| Satisfaction with the wait | Lagging | Post-visit text, 1–5 scale | 4.0 | 4.5 | Month 2 |

## Open questions

**Blocking: answer before the build starts**

- **What does "priority" mean at this clinic, and who sets it?** Answered: patients coming from the emergency department go first. Still open: who sets the flag, reception at check-in or the professional? Until confirmed, both can. *Clinic (stakeholder)*
- **Does the professional have a phone or tablet within reach when calling a patient?** Answered: yes. They use a clinic-provided web app on their PC, so the queue and "Next patient" run in the browser there. *Clinic (stakeholder)*
- **Which country's health-data rules apply, and does a reason for visit count as health data there?** Answered: Belgium, under the EU GDPR. A reason for visit is health data (GDPR article 9), so v1 needs a data processing agreement with the clinic, a data protection impact assessment and EU hosting. Texts never include the reason. Still to do: confirm with a Belgian privacy lawyer. *Legal*
- **How are appointments entered today?** Answered: an online doctor-agenda system. The demo loads appointments from a sample file; a later phase connects to the agenda's API. *Clinic (stakeholder), engineering*

**Non-blocking: resolve during the build**

- Which text-message provider, and what does each message cost in the clinic's country? *Engineering*
- How many walk-ins does a typical day have, and how should they be placed between booked slots? *Data, from the pilot*
- What wording on the visit page explains a slipped estimate without alarming patients? *Design*
- How long is visit data kept, and who can see past days? *Legal*

## Timeline and phasing

No hard deadlines have been set yet. The only fixed length is phase 0, the one-week manual pilot.

| Phase | Scope | Gate to the next phase |
| --- | --- | --- |
| 0 · Manual pilot | 1 week, 1 doctor; texts sent by hand; spreadsheet queue | **Gate 1:** 90% of calls recorded; patients open the links |
| 1 · MVP launch (this PRD) | Requirements R1–R9; one clinic; per-doctor queues | **Gate 2:** week-2 success targets met at the clinic |
| 2 · Fast follow (P1) | Backup call text; satisfaction text; manager summary; patient languages | **Gate 3:** 80% of patients called within the range shown |
| 3 · Version 2 (P2) | Leave and come back; shared queue; agenda integration; clinical form | — |

Gate 3 matters most: leave-and-come-back alerts send patients away, so they only ship once estimates prove accurate. The four blocking open questions must be answered before phase 1 starts.

## Technical Assumptions

Stack, hosting and decisions are in [architecture.md](architecture.md): TypeScript (Node.js LTS) and React, Postgres, one modular application hosted in the EU, server-sent events for live updates.

## User Interface Design Goals

Screens, design system and accessibility choices are in [front-end-spec.md](front-end-spec.md); static prototype screens are in [ux/prototype/](ux/prototype/index.html).

## Epic List

Each epic is sharded in `docs/prd/` and each story has its own file in `docs/stories/`.

- **Epic 1: Appointments and visit link** — 1.1 Import appointments from the demo file, 1.2 Private visit page, 1.3 Confirmation text, 1.4 Day-before reminder
- **Epic 2: Pre-visit form** — 2.1 Fill in the pre-visit form at home, 2.2 See form answers in the queue
- **Epic 3: Check-in** — 3.1 Check in by QR on a recognised phone, 3.2 Check in by QR with a text code, 3.3 Reception marks a patient as arrived, 3.4 Register a walk-in
- **Epic 4: Professional queue** — 4.1 Sign in on the clinic PC, 4.2 See my queue in priority order, 4.3 Flag a patient coming from emergency
- **Epic 5: Calling patients in** — 5.1 Call the next patient, 5.2 Call a patient out of order, 5.3 Skip a patient who isn't there
- **Epic 6: Estimates and delay warnings** — 6.1 See my estimated call time, 6.2 Be told why my estimate slipped, 6.3 Delay warning before leaving home
- **Epic 7: Privacy and data** — 7.1 Every step recorded with a timestamp, 7.2 Automatic deletion after the retention period, 7.3 Log of who viewed form answers, 7.4 Erase a patient's data on request, 7.5 Export a patient's data on request
- **Epic 8: Fast follow (P1)** — 8.1 Backup text when called, 8.2 Satisfaction question after the visit, 8.3 Daily wait summary for the manager, 8.4 Texts and pages in French, Dutch or English
- **Epic 9: Version 2 (P2)** — 9.1 Leave and come back, 9.2 Shared queue across professionals, 9.3 Sync appointments from the online agenda, 9.4 Clinical questions in the form

## Change Log

| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2026-11-10 | 1.0 | First version, from the Claude Docs PRD (https://claude.ai/artifact/NeM4fi6P1N9jRVjSGXNKoa) | Kamel |
