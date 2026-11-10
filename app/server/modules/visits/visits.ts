import type { PoolClient } from 'pg';
import { hash } from '../../crypto.js';
import type { Db } from '../../db/pool.js';
import type { ClinicSettings } from '../../settings.js';

export interface VisitRow {
  id: string;
  trail_id: string;
  professional_id: string;
  day: string;
  kind: 'booked' | 'walk_in';
  status: string;
  emergency: boolean;
  checkin_method: string | null;
  arrived_at: Date | null;
  called_at: Date | null;
  skip_count: number;
  requeue_after_visit: string | null;
  shown_from: Date | null;
  shown_to: Date | null;
  slip_reason: string | null;
  form_link_active_from: Date | null;
  created_at: Date;
  appointment_id: string;
  starts_at: Date | null;
  patient_name: string;
  phone: string | null;
  language: string | null;
  cancelled_at: Date | null;
  professional_name: string;
  room: string | null;
  form_done: boolean;
  delay_warned_lateness: number | null;
  delay_corrections: number;
}

export const VISIT_SELECT = `
  SELECT v.*, a.starts_at, a.patient_name, a.phone, a.language, a.cancelled_at,
         s.name AS professional_name, s.room,
         EXISTS (SELECT 1 FROM form_answers f WHERE f.visit_id = v.id) AS form_done
    FROM visit v
    JOIN appointment a ON a.id = v.appointment_id
    JOIN staff_user s ON s.id = v.professional_id`;

export async function getVisit(db: Db, visitId: string, lock = false): Promise<VisitRow | null> {
  if (lock) await db.query('SELECT 1 FROM visit WHERE id = $1 FOR UPDATE', [visitId]);
  const r = await db.query(`${VISIT_SELECT} WHERE v.id = $1`, [visitId]);
  return r.rows[0] ?? null;
}

export async function findByLinkToken(db: Db, token: string): Promise<VisitRow | null> {
  const r = await db.query(`${VISIT_SELECT} WHERE v.link_token_hash = $1`, [hash(token)]);
  return r.rows[0] ?? null;
}

export async function findByFormToken(db: Db, token: string): Promise<VisitRow | null> {
  const r = await db.query(`${VISIT_SELECT} WHERE v.form_token_hash = $1`, [hash(token)]);
  return r.rows[0] ?? null;
}

/** WR-02 / ADR-004: the visit link works from N hours before to N hours after the appointment. */
export function linkWindow(v: Pick<VisitRow, 'starts_at' | 'created_at' | 'called_at' | 'kind'>, clinic: Pick<ClinicSettings, 'link_window_hours'>) {
  const h = clinic.link_window_hours * 3600_000;
  if (v.kind === 'walk_in' || !v.starts_at) {
    const base = Math.max(v.created_at.getTime(), v.called_at?.getTime() ?? 0);
    return { opensAt: v.created_at, closesAt: new Date(base + h) };
  }
  return { opensAt: new Date(v.starts_at.getTime() - h), closesAt: new Date(v.starts_at.getTime() + h) };
}

export function firstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Remember this phone for one-tap QR check-in (ADR-004). Only the cookie's hash is stored. */
export async function rememberDevice(c: PoolClient | Db, visitId: string, cookieId: string, now: Date) {
  await c.query(
    `INSERT INTO recognized_phone (cookie_hash, visit_id, last_seen_at) VALUES ($1, $2, $3)
     ON CONFLICT (cookie_hash, visit_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [hash(cookieId), visitId, now],
  );
}
