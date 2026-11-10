import type { PoolClient } from 'pg';
import { addDays, localTime, zonedToUtc } from '../../../shared/time.js';
import { clock } from '../../clock.js';
import { write } from '../../events.js';
import { getClinic } from '../../settings.js';
import { queueText } from '../messaging/messages.js';
import { getVisit } from '../visits/visits.js';

/** WR-04: the day-before reminder, only between 17:00 and 19:00 clinic time. */
export async function sendReminderJob(payload: { visitId: string }, c: PoolClient) {
  const visit = await getVisit(c, payload.visitId, true);
  if (!visit || visit.cancelled_at || visit.status === 'cancelled' || !visit.starts_at || !visit.phone) return;
  const clinic = await getClinic(c);
  const tz = clinic.time_zone;
  const dayBefore = addDays(visit.day, -1);
  const now = clock.now();
  const start = zonedToUtc(dayBefore, '17:00', tz);
  const end = zonedToUtc(dayBefore, '19:00', tz);
  if (now < start) throw new Error('Reminder job ran before its window'); // retried later by the runner
  if (now >= end) {
    await write(c, { type: 'reminder_failed', actor: 'worker', visit, details: { reason: 'window_missed' } });
    return;
  }
  if (!visit.form_link_active_from) {
    await c.query('UPDATE visit SET form_link_active_from = $2 WHERE id = $1', [visit.id, now]);
  }
  await queueText(c, {
    visitId: visit.id,
    to: visit.phone,
    language: visit.language ?? clinic.default_language,
    template: visit.form_done ? 'reminder_form_done' : 'reminder',
    vars: { clinic: clinic.name, professional: visit.professional_name, time: localTime(visit.starts_at, tz) },
    dedupeKey: `reminder-text:${visit.id}`,
  });
}
