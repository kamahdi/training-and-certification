# Source Tree

Proposed layout. Files named in the ADR-002 solution design are listed under their folders.

```
shared/
  live-events.ts          payload types shared by server and client
server/
  modules/
    appointments/         CSV import, validation, AppointmentSource interface
    visits/               visit links, check-in, recognized phones, text codes, walk-ins
    queue/                order rule, emergency flag, next / out-of-order / skip
    estimates/            lateness, ranges, slip reasons (pure functions)
    messaging/            templates (FR/NL/EN), provider adapter, delivery reports
    privacy/              field encryption, access log, retention, erasure, export
    events/               append-only event log and the shared write function
  live/
    listener.ts           LISTEN connection and reconnects
    registry.ts           open streams by professional and by visit
    snapshots.ts          queue and estimate snapshots
  routes/
    stream.ts             the two stream endpoints
  worker/                 reminders, delay checks, retention, daily summary
  clock.ts                the only place that reads the time
web/
  hooks/useLiveStream.ts  EventSource hook with polling fallback
  patient/                visit page, check-in, form
  staff/                  reception and professional screens
test/
  fixtures/demo-appointments.csv   synthetic data only
```
