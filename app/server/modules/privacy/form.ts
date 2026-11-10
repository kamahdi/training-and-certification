import type { PoolClient } from 'pg';
import { clock } from '../../clock.js';
import { decrypt, encrypt } from '../../crypto.js';
import type { Db } from '../../db/pool.js';
import { write } from '../../events.js';
import type { VisitRow } from '../visits/visits.js';

export const REASON_MAX = 200;

export interface FormInput {
  reason?: string;
  medications?: string;
  fund?: string;
  member?: string;
  phone?: string;
  consent?: boolean;
}

export interface FormAnswers {
  reason: string | null;
  medications: string | null;
  fund: string | null;
  member: string | null;
  phone: string | null;
  updatedAt: string;
  updatedAfterCheckIn: boolean;
}

export type FormState = 'not_open_yet' | 'open' | 'read_only' | 'closed';

/** WR-04/WR-05: the form works from the reminder (or a same-day booking) until the patient is called in. */
export function formState(v: Pick<VisitRow, 'status' | 'form_link_active_from' | 'cancelled_at'>, now: Date): FormState {
  if (v.cancelled_at || v.status === 'cancelled') return 'closed';
  if (['called', 'done', 'missed'].includes(v.status)) return 'read_only';
  if (!v.form_link_active_from || now < v.form_link_active_from) return 'not_open_yet';
  return 'open';
}

export class FormError extends Error {}

/** WR-05: save answers, encrypted field by field; consent is required. */
export async function submitForm(c: PoolClient, v: VisitRow, input: FormInput) {
  const now = clock.now();
  const state = formState(v, now);
  if (state !== 'open') throw new FormError(state === 'read_only' ? 'The form is read-only once you have been called in' : 'The form is not open');
  if (!input.consent) throw new FormError('Please accept how your answers are used before saving');
  const reason = (input.reason ?? '').trim();
  if (reason.length > REASON_MAX) throw new FormError(`The reason for your visit can be at most ${REASON_MAX} characters`);
  const existing = await c.query('SELECT 1 FROM form_answers WHERE visit_id = $1', [v.id]);
  await c.query(
    `INSERT INTO form_answers (visit_id, reason_enc, medications_enc, fund_enc, member_enc, phone_enc, consent_at, updated_at, submitted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
     ON CONFLICT (visit_id) DO UPDATE SET reason_enc = EXCLUDED.reason_enc, medications_enc = EXCLUDED.medications_enc,
       fund_enc = EXCLUDED.fund_enc, member_enc = EXCLUDED.member_enc, phone_enc = EXCLUDED.phone_enc,
       consent_at = EXCLUDED.consent_at, updated_at = EXCLUDED.updated_at`,
    [v.id, encrypt(reason), encrypt(input.medications?.trim()), encrypt(input.fund?.trim()), encrypt(input.member?.trim()), encrypt(input.phone?.trim()), now],
  );
  // The event says that the form changed, never what it says.
  await write(c, {
    type: existing.rowCount ? 'form_updated' : 'form_submitted',
    actor: 'patient',
    visit: v,
    queue: v.status === 'arrived' ? { professionalId: v.professional_id, day: v.day } : null,
  });
}

function decodeAnswers(row: any, arrivedAt: Date | null): FormAnswers {
  return {
    reason: decrypt(row.reason_enc),
    medications: decrypt(row.medications_enc),
    fund: decrypt(row.fund_enc),
    member: decrypt(row.member_enc),
    phone: decrypt(row.phone_enc),
    updatedAt: row.updated_at.toISOString(),
    updatedAfterCheckIn: !!arrivedAt && row.updated_at > arrivedAt && row.updated_at.getTime() !== row.submitted_at.getTime(),
  };
}

/** The patient's own answers, for editing on the form page. */
export async function answersForPatient(db: Db, v: VisitRow): Promise<FormAnswers | null> {
  const r = await db.query('SELECT * FROM form_answers WHERE visit_id = $1', [v.id]);
  return r.rows[0] ? decodeAnswers(r.rows[0], v.arrived_at) : null;
}

export class AccessDenied extends Error {}

/**
 * WR-06 + WR-22: full answers for staff. Only the patient's professional and reception may open them,
 * and every opening writes an append-only access-log entry.
 */
export async function answersForStaff(c: PoolClient, v: VisitRow, staff: { id: string; role: string }): Promise<FormAnswers | null> {
  const allowed = staff.role === 'reception' || (staff.role === 'professional' && staff.id === v.professional_id);
  if (!allowed) throw new AccessDenied('Not allowed to see these answers');
  const r = await c.query('SELECT * FROM form_answers WHERE visit_id = $1', [v.id]);
  if (!r.rows[0]) return null;
  await c.query('INSERT INTO access_log (staff_user_id, staff_role, trail_id, at) VALUES ($1, $2, $3, $4)', [staff.id, staff.role, v.trail_id, clock.now()]);
  return decodeAnswers(r.rows[0], v.arrived_at);
}
