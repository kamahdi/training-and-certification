import type { PoolClient } from 'pg';
import { localDate, localTime } from '../../../shared/time.js';
import { clock } from '../../clock.js';
import { write } from '../../events.js';
import { getClinic } from '../../settings.js';
import { queueText } from '../messaging/messages.js';
import { delayDecision, latenessMinutes, suggestedArrival } from './estimate.js';

export async function professionalLateness(c: PoolClient, professionalId: string, day: string): Promise<number | null> {
  const r = await c.query(
    `SELECT a.starts_at, v.called_at FROM visit v JOIN appointment a ON a.id = v.appointment_id
      WHERE v.professional_id = $1 AND v.day = $2 AND v.kind = 'booked' AND v.called_at IS NOT NULL
      ORDER BY v.called_at DESC LIMIT 3`,
    [professionalId, day],
  );
  return latenessMinutes(r.rows.map((x) => ({ startsAt: x.starts_at, calledAt: x.called_at })));
}

/**
 * WR-19, run every 5 minutes by the worker: when a professional runs 15+ minutes late,
 * patients booked 60–90 minutes later who have not checked in get one text with a suggested arrival time.
 */
export async function runDelayCheck(c: PoolClient): Promise<number> {
  const clinic = await getClinic(c);
  const now = clock.now();
  const day = localDate(now, clinic.time_zone);
  const pros = (await c.query("SELECT id, name FROM staff_user WHERE role = 'professional' AND active")).rows;
  let sent = 0;
  for (const pro of pros) {
    const lateness = await professionalLateness(c, pro.id, day);
    const candidates = await c.query(
      `SELECT v.id, v.trail_id, v.professional_id, v.day, v.delay_warned_lateness, v.delay_corrections, a.starts_at, a.phone, a.language
         FROM visit v JOIN appointment a ON a.id = v.appointment_id
        WHERE v.professional_id = $1 AND v.day = $2 AND v.status = 'booked' AND a.phone IS NOT NULL
          AND a.starts_at BETWEEN $3 AND $4
        FOR UPDATE OF v`,
      [pro.id, day, new Date(now.getTime() + 60 * 60000), new Date(now.getTime() + 90 * 60000)],
    );
    for (const v of candidates.rows) {
      const d = delayDecision({ lateness, threshold: clinic.delay_threshold_min, warnedLateness: v.delay_warned_lateness, corrections: v.delay_corrections });
      if (!d.send || lateness === null) continue;
      const suggested = suggestedArrival(v.starts_at, lateness);
      await c.query(
        'UPDATE visit SET delay_warned_lateness = $2, delay_corrections = delay_corrections + $3 WHERE id = $1',
        [v.id, lateness, d.correction ? 1 : 0],
      );
      await queueText(c, {
        visitId: v.id,
        to: v.phone,
        template: 'delay',
        language: v.language ?? clinic.default_language,
        vars: { clinic: clinic.name, professional: pro.name, lateness: String(lateness), suggested: localTime(suggested, clinic.time_zone), time: localTime(v.starts_at, clinic.time_zone) },
        dedupeKey: `delay:${v.id}:${d.correction ? 'correction' : 'first'}`,
      });
      await write(c, { type: d.correction ? 'delay_correction_queued' : 'delay_warning_queued', actor: 'worker', visit: v, details: { lateness } });
      sent++;
    }
  }
  return sent;
}
