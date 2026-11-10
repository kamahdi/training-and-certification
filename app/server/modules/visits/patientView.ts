import { formatDay } from '../../../shared/format.js';
import { localTime } from '../../../shared/time.js';
import type { VisitView } from '../../../shared/live-events.js';
import { clock } from '../../clock.js';
import type { Db } from '../../db/pool.js';
import type { ClinicSettings } from '../../settings.js';
import { callTimesToday } from '../queue/queue.js';
import { checkinOpensAt } from './checkin.js';
import { firstName, linkWindow, type VisitRow } from './visits.js';

/**
 * Everything the visit page shows (WR-02, WR-17, WR-18). Never another patient's data,
 * never the reason for visit or the emergency flag.
 */
export async function patientView(db: Db, v: VisitRow, clinic: ClinicSettings): Promise<VisitView> {
  const tz = clinic.time_zone;
  const now = clock.now();
  const win = linkWindow(v, clinic);
  if (v.status === 'cancelled' || now > win.closesAt) return { state: 'ended' };
  if (now < win.opensAt) {
    return { state: 'not_open', opensAt: localTime(win.opensAt, tz), opensOn: formatDay(win.opensAt, tz) };
  }
  const base = {
    firstName: firstName(v.patient_name),
    clinicName: clinic.name,
    clinicAddress: clinic.address,
    professional: v.professional_name,
    date: v.starts_at ? formatDay(v.starts_at, tz) : formatDay(v.created_at, tz),
    time: v.starts_at ? localTime(v.starts_at, tz) : null,
    formDone: v.form_done,
    checkedInAt: v.arrived_at ? localTime(v.arrived_at, tz) : null,
    updatedAt: localTime(now, tz),
  };
  switch (v.status) {
    case 'booked': {
      const opens = checkinOpensAt(v, clinic);
      return { state: 'booked', ...base, checkinOpensAt: opens ? localTime(opens, tz) : null };
    }
    case 'arrived': {
      const started = (await callTimesToday(db, v.professional_id, v.day)).length > 0;
      if (!started || !v.shown_from || !v.shown_to) return { state: 'not_started', ...base };
      return {
        state: 'waiting',
        ...base,
        from: localTime(v.shown_from, tz),
        to: localTime(v.shown_to, tz),
        slip: v.slip_reason ? { reason: v.slip_reason as 'emergency' | 'running_long' } : null,
      };
    }
    case 'called':
      return { state: 'called', ...base, room: v.room, calledAt: v.called_at ? localTime(v.called_at, tz) : null };
    case 'missed':
      return { state: 'missed', ...base };
    default:
      return { state: 'ended' };
  }
}
