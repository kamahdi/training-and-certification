import type { PoolClient } from 'pg';
import { localTime } from '../../../shared/time.js';
import { decrypt } from '../../crypto.js';
import type { Db } from '../../db/pool.js';
import { queueVersion } from '../../events.js';
import { getClinic, type ClinicSettings } from '../../settings.js';
import { averageConsultMinutes, estimateRange, isSlip } from '../estimates/estimate.js';
import { orderQueue, type QueueItem } from './order.js';

export interface WaitingRow extends QueueItem {
  name: string;
  formDone: boolean;
  reasonEnc: string | null;
  shownTo: Date | null;
  slipReason: string | null;
}

export async function waiting(db: Db, professionalId: string, day: string, now: Date): Promise<WaitingRow[]> {
  const r = await db.query(
    `SELECT v.id, v.kind, a.starts_at, v.arrived_at, v.emergency, v.requeue_after_visit, a.patient_name,
            v.shown_to, v.slip_reason, f.reason_enc, (f.visit_id IS NOT NULL) AS form_done
       FROM visit v JOIN appointment a ON a.id = v.appointment_id
       LEFT JOIN form_answers f ON f.visit_id = v.id
      WHERE v.professional_id = $1 AND v.day = $2 AND v.status = 'arrived'`,
    [professionalId, day],
  );
  const items: WaitingRow[] = r.rows.map((x) => ({
    visitId: x.id, kind: x.kind, startsAt: x.starts_at, arrivedAt: x.arrived_at, emergency: x.emergency,
    requeueAfter: x.requeue_after_visit, name: x.patient_name, formDone: x.form_done, reasonEnc: x.reason_enc,
    shownTo: x.shown_to, slipReason: x.slip_reason,
  }));
  return orderQueue(items, now);
}

export async function callTimesToday(db: Db, professionalId: string, day: string): Promise<Date[]> {
  const r = await db.query(
    `SELECT called_at FROM visit WHERE professional_id = $1 AND day = $2 AND called_at IS NOT NULL ORDER BY called_at`,
    [professionalId, day],
  );
  return r.rows.map((x) => x.called_at);
}

/**
 * Recompute and store every waiting patient's range for one professional (WR-17, WR-18).
 * Called in the same transaction as each queue change, and every minute by the worker.
 * Returns the visits whose range changed, for notifications.
 */
export async function refreshEstimates(c: PoolClient, professionalId: string, day: string, now: Date, clinic?: ClinicSettings): Promise<string[]> {
  const settings = clinic ?? (await getClinic(c));
  const queue = await waiting(c, professionalId, day, now);
  const calls = await callTimesToday(c, professionalId, day);
  const changed: string[] = [];
  if (!calls.length) {
    for (const q of queue) {
      if (q.shownTo !== null) {
        await c.query('UPDATE visit SET shown_from = NULL, shown_to = NULL, slip_reason = NULL WHERE id = $1', [q.visitId]);
        changed.push(q.visitId);
      }
    }
    return changed;
  }
  const avg = averageConsultMinutes(calls, settings.default_consult_min);
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    const range = estimateRange(now, i, avg, settings);
    let slipReason = q.slipReason;
    if (isSlip(q.shownTo, range.to)) {
      slipReason = queue.slice(0, i).some((o) => o.emergency) ? 'emergency' : 'running_long';
    } else if (q.shownTo && range.to.getTime() < q.shownTo.getTime()) {
      slipReason = null;
    }
    if (!q.shownTo || q.shownTo.getTime() !== range.to.getTime() || slipReason !== q.slipReason) {
      await c.query('UPDATE visit SET shown_from = $2, shown_to = $3, slip_reason = $4 WHERE id = $1', [q.visitId, range.from, range.to, slipReason]);
      changed.push(q.visitId);
    }
  }
  return changed;
}

export interface QueueSnapshotPatient {
  visitId: string;
  name: string;
  kind: 'booked' | 'walk_in';
  appointmentTime: string | null;
  arrivedAt: string;
  arrivedTime: string;
  waitingMinutes: number;
  formDone: boolean;
  reason: string | null;
  emergency: boolean;
}

/** The professional's queue as staff screens show it (WR-12). */
export async function queueSnapshot(db: Db, professionalId: string, day: string, now: Date, tz: string) {
  const queue = await waiting(db, professionalId, day, now);
  const version = await queueVersion(db, professionalId, day);
  const patients: QueueSnapshotPatient[] = queue.map((q) => ({
    visitId: q.visitId,
    name: q.name,
    kind: q.kind,
    appointmentTime: q.startsAt ? localTime(q.startsAt, tz) : null,
    arrivedAt: q.arrivedAt.toISOString(),
    arrivedTime: localTime(q.arrivedAt, tz),
    waitingMinutes: Math.max(0, Math.floor((now.getTime() - q.arrivedAt.getTime()) / 60000)),
    formDone: q.formDone,
    reason: decrypt(q.reasonEnc),
    emergency: q.emergency,
  }));
  return { professionalId, version, patients };
}
