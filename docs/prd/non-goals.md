# Non-goals

- **No native app.** Nobody installs an app for one clinic visit; text messages and a web page reach every patient with a phone.
- **No automatic call-in.** A medical professional still calls each patient aloud. The system records the call; it does not replace it.
- **No leave-and-come-back alerts in v1.** Telling a patient "you're 2 away, head back" needs precise estimates. It waits until pilot data shows they are accurate (P2).
- **No integration with the clinic's scheduling or medical-records system.** Each system needs its own integration; the demo and v1 load appointments from a sample file, and the online agenda's API follows in P2.
- **No clinical data in the form.** Medical history and symptoms are sensitive health data under the GDPR and add legal work. v1 collects administrative details and a short reason for the visit only.
- **No shared queue across doctors.** Each professional has their own queue; pooling patients across doctors is a v2 problem.
