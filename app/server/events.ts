import type { PoolClient } from 'pg';
import { clock } from './clock.js';

export interface VisitRef {
  id: string;
  trail_id: string;
  professional_id: string;
  day: string;
}

export interface WriteInput {
  type: string;
  actor: string;
  visit?: VisitRef | null;
  professionalId?: string | null;
  details?: Record<string, unknown>;
  /** Set when the change affects a professional's queue: bumps its version and notifies screens. */
  queue?: { professionalId: string; day: string } | null;
  /** Visit pages to notify (defaults to the event's visit). */
  notifyVisits?: string[];
}

/**
 * The shared write function (ADR-005). Call it inside the transaction that changed the state:
 * it appends the event, bumps the queue version when the queue changed, and sends a
 * Postgres notification that is delivered only when the transaction commits.
 */
export async function write(c: PoolClient, input: WriteInput): Promise<{ eventId: number; queueVersion?: number }> {
  const professionalId = input.professionalId ?? input.visit?.professional_id ?? input.queue?.professionalId ?? null;
  const r = await c.query(
    `INSERT INTO event (trail_id, visit_id, professional_id, type, actor, at, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.visit?.trail_id ?? null, input.visit?.id ?? null, professionalId, input.type, input.actor, clock.now(), input.details ?? {}],
  );
  const eventId = Number(r.rows[0].id);
  let queueVersion: number | undefined;
  if (input.queue) {
    const v = await c.query(
      `INSERT INTO queue_version (professional_id, day, version) VALUES ($1, $2, 1)
       ON CONFLICT (professional_id, day) DO UPDATE SET version = queue_version.version + 1
       RETURNING version`,
      [input.queue.professionalId, input.queue.day],
    );
    queueVersion = v.rows[0].version;
  }
  const visitIds = input.notifyVisits ?? (input.visit ? [input.visit.id] : []);
  if (input.queue || visitIds.length) {
    const payload = JSON.stringify({ professionalId: input.queue?.professionalId ?? professionalId, visitIds, eventId });
    await c.query('SELECT pg_notify($1, $2)', ['clinic_updates', payload]);
  }
  return { eventId, queueVersion };
}

export async function queueVersion(c: { query: PoolClient['query'] }, professionalId: string, day: string): Promise<number> {
  const r = await c.query('SELECT version FROM queue_version WHERE professional_id = $1 AND day = $2', [professionalId, day]);
  return r.rows[0]?.version ?? 0;
}
