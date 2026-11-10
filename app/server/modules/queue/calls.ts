import type { PoolClient } from 'pg';
import { clock } from '../../clock.js';
import { write } from '../../events.js';
import { getClinic } from '../../settings.js';
import { getVisit, type VisitRow } from '../visits/visits.js';
import { refreshEstimates, waiting } from './queue.js';

export class ConflictError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}
export class NotAllowedError extends Error {}

async function lockVersion(c: PoolClient, professionalId: string, day: string): Promise<number> {
  await c.query('INSERT INTO queue_version (professional_id, day, version) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING', [professionalId, day]);
  const r = await c.query('SELECT version FROM queue_version WHERE professional_id = $1 AND day = $2 FOR UPDATE', [professionalId, day]);
  return r.rows[0].version;
}

async function afterQueueChange(c: PoolClient, professionalId: string, day: string) {
  const clinic = await getClinic(c);
  return refreshEstimates(c, professionalId, day, clock.now(), clinic);
}

/** WR-14 "Next patient" and WR-15 calling any waiting patient. A stale version calls nobody (409). */
export async function call(c: PoolClient, opts: { professionalId: string; day: string; version: number; visitId?: string; actor: string }) {
  const current = await lockVersion(c, opts.professionalId, opts.day);
  if (current !== opts.version) throw new ConflictError('stale_queue_version');
  const now = clock.now();
  const queue = await waiting(c, opts.professionalId, opts.day, now);
  if (!queue.length) throw new ConflictError('nobody_waiting');
  const index = opts.visitId ? queue.findIndex((q) => q.visitId === opts.visitId) : 0;
  if (index < 0) throw new ConflictError('not_waiting');
  const target = queue[index];
  const visit = (await getVisit(c, target.visitId, true))!;
  await c.query("UPDATE visit SET status = 'called', called_at = $2, requeue_after_visit = NULL WHERE id = $1", [visit.id, now]);
  const withinRange = visit.shown_from && visit.shown_to ? now >= visit.shown_from && now <= visit.shown_to : null;
  const changed = await afterQueueChange(c, opts.professionalId, opts.day);
  const res = await write(c, {
    type: 'called',
    actor: opts.actor,
    visit,
    details: { out_of_order: index > 0, skipped_places: index, within_range: withinRange, emergency: visit.emergency },
    queue: { professionalId: opts.professionalId, day: opts.day },
    notifyVisits: [visit.id, ...changed],
  });
  return { visitId: visit.id, name: visit.patient_name, version: res.queueVersion! };
}

/** WR-14: a call can be undone within 30 seconds; the patient returns to their place. */
export async function undoCall(c: PoolClient, visitId: string, actor: string) {
  const v = await getVisit(c, visitId, true);
  if (!v || v.status !== 'called' || !v.called_at) throw new ConflictError('not_called');
  if (clock.now().getTime() - v.called_at.getTime() > 30_000) throw new NotAllowedError('Undo is only possible within 30 seconds');
  await c.query("UPDATE visit SET status = 'arrived', called_at = NULL WHERE id = $1", [visitId]);
  const changed = await afterQueueChange(c, v.professional_id, v.day);
  return write(c, { type: 'call_undone', actor, visit: v, queue: { professionalId: v.professional_id, day: v.day }, notifyVisits: [visitId, ...changed] });
}

/**
 * WR-16 "Not here, skip": records a missed call and puts the patient back right after the
 * next person in line. A second skip marks them "missed".
 */
export async function skip(c: PoolClient, visitId: string, actor: string) {
  const v = await getVisit(c, visitId, true);
  if (!v || !['arrived', 'called'].includes(v.status)) throw new ConflictError('not_waiting');
  const now = clock.now();
  const skips = v.skip_count + 1;
  if (skips >= 2) {
    await c.query("UPDATE visit SET status = 'missed', called_at = NULL, skip_count = $2, requeue_after_visit = NULL WHERE id = $1", [visitId, skips]);
  } else {
    const queue = (await waiting(c, v.professional_id, v.day, now)).filter((q) => q.visitId !== visitId);
    const next = queue[0]?.visitId ?? null;
    await c.query("UPDATE visit SET status = 'arrived', called_at = NULL, skip_count = $2, requeue_after_visit = $3 WHERE id = $1", [visitId, skips, next]);
  }
  const changed = await afterQueueChange(c, v.professional_id, v.day);
  return write(c, {
    type: skips >= 2 ? 'missed' : 'skipped',
    actor,
    visit: v,
    details: { skip_count: skips },
    queue: { professionalId: v.professional_id, day: v.day },
    notifyVisits: [visitId, ...changed],
  });
}

/** WR-16: reception can return a missed patient to the queue. */
export async function returnToQueue(c: PoolClient, visitId: string, actor: string) {
  const v = await getVisit(c, visitId, true);
  if (!v || v.status !== 'missed') throw new ConflictError('not_missed');
  await c.query("UPDATE visit SET status = 'arrived', requeue_after_visit = NULL WHERE id = $1", [visitId]);
  const changed = await afterQueueChange(c, v.professional_id, v.day);
  return write(c, { type: 'returned_to_queue', actor, visit: v, queue: { professionalId: v.professional_id, day: v.day }, notifyVisits: [visitId, ...changed] });
}

/** WR-13: set or clear the emergency flag on a waiting patient. */
export async function setEmergency(c: PoolClient, visitId: string, on: boolean, actor: string) {
  const v = await getVisit(c, visitId, true);
  if (!v || !['booked', 'arrived'].includes(v.status)) throw new ConflictError('not_waiting');
  if (v.emergency === on) return null;
  await c.query('UPDATE visit SET emergency = $2 WHERE id = $1', [visitId, on]);
  const changed = await afterQueueChange(c, v.professional_id, v.day);
  return write(c, {
    type: on ? 'flag_set' : 'flag_cleared',
    actor,
    visit: v,
    queue: { professionalId: v.professional_id, day: v.day },
    notifyVisits: [visitId, ...changed],
  });
}

export type { VisitRow };
