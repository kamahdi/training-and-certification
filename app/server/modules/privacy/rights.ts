import type { PoolClient } from 'pg';
import { formatDay } from '../../../shared/format.js';
import { localDate, localTime } from '../../../shared/time.js';
import { clock } from '../../clock.js';
import { fourDigitCode, hash } from '../../crypto.js';
import { write } from '../../events.js';
import { cancelJobsForVisits } from '../../jobs.js';
import { getClinic } from '../../settings.js';
import { normalizePhone } from '../appointments/phone.js';
import { sendCodeNow } from '../messaging/messages.js';
import { answersForPatient } from './form.js';
import { VISIT_SELECT, type VisitRow } from '../visits/visits.js';

export class RightsError extends Error {}

async function visitsForPhone(c: PoolClient, phone: string): Promise<VisitRow[]> {
  const r = await c.query(`${VISIT_SELECT} WHERE a.phone = $1 ORDER BY COALESCE(a.starts_at, a.created_at)`, [phone]);
  return r.rows;
}

/** WR-31 / WR-32: what the manager sees for a phone number. */
export async function findPatient(c: PoolClient, phoneInput: string) {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new RightsError('Invalid phone number');
  const visits = await visitsForPhone(c, phone);
  return {
    phone,
    visits: visits.map((v) => ({
      visitId: v.id,
      name: v.patient_name,
      date: formatDay(v.starts_at ?? v.created_at, clinic.time_zone),
      time: v.starts_at ? localTime(v.starts_at, clinic.time_zone) : null,
      professional: v.professional_name,
      status: v.status,
    })),
  };
}

/**
 * WR-31: erase everything we hold about one patient. Events stay, keyed by trail_id only.
 * An erasure list (phone hash + appointment times) stops re-imports and is re-applied after restores.
 */
export async function erasePatient(c: PoolClient, phoneInput: string, confirmLast4: string, staff: { id: string }) {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new RightsError('Invalid phone number');
  if (phone.replace(/\D/g, '').slice(-4) !== confirmLast4.replace(/\D/g, '')) throw new RightsError('The last 4 digits do not match');
  const now = clock.now();
  const today = localDate(now, clinic.time_zone);
  const visits = await visitsForPhone(c, phone);
  if (visits.some((v) => v.day === today && ['arrived', 'called'].includes(v.status))) {
    throw new RightsError("Finish or cancel today's visit first");
  }
  const requestedAt = now;
  for (const v of visits) {
    await c.query('INSERT INTO erasure_list (phone_hash, starts_at, created_at) VALUES ($1, $2, $3)', [hash(phone), v.starts_at, now]);
  }
  // Always keep one entry per phone, so even walk-ins are remembered.
  if (!visits.length) await c.query('INSERT INTO erasure_list (phone_hash, starts_at, created_at) VALUES ($1, NULL, $2)', [hash(phone), now]);
  const visitIds = visits.map((v) => v.id);
  await cancelJobsForVisits(c, visitIds);
  // One event that names nobody; the patient's own trail of events is left as it was.
  await write(c, { type: 'patient_erased', actor: `staff:${staff.id}`, details: { visits: visits.length } });
  for (const pro of new Set(visits.filter((v) => v.day === today).map((v) => v.professional_id))) {
    await write(c, { type: 'queue_refreshed', actor: 'system', queue: { professionalId: pro, day: today } });
  }
  // Delete: events keep trail_id, but visit_id becomes NULL via ON DELETE SET NULL.
  await c.query('DELETE FROM appointment WHERE id = ANY($1)', [visits.map((v) => v.appointment_id)]);
  await c.query('DELETE FROM message WHERE to_phone = $1', [phone]);
  await c.query("DELETE FROM text_code WHERE phone_hash = $1", [hash(phone)]);
  await c.query('INSERT INTO data_request (kind, requested_at, completed_at, staff_user_id) VALUES ($1, $2, $3, $4)', ['erasure', requestedAt, clock.now(), staff.id]);
  return { erasedVisits: visits.length };
}

/** WR-31: after any restore from backup, apply the erasure list again before the service reopens. */
export async function reapplyErasures(c: PoolClient): Promise<number> {
  const r = await c.query(
    `SELECT a.id FROM appointment a
      WHERE a.phone IS NOT NULL AND EXISTS (
        SELECT 1 FROM erasure_list e
         WHERE e.phone_hash = encode(digest(a.phone, 'sha256'), 'hex')
           AND a.created_at <= e.created_at
           AND (e.starts_at IS NULL OR e.starts_at = a.starts_at OR a.starts_at IS NULL))`,
  );
  if (r.rowCount) await c.query('DELETE FROM appointment WHERE id = ANY($1)', [r.rows.map((x) => x.id)]);
  return r.rowCount ?? 0;
}

/** WR-32: text a code to the number on file to confirm the requester owns it. */
export async function requestExportCode(c: PoolClient, phoneInput: string) {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new RightsError('Invalid phone number');
  const visits = await visitsForPhone(c, phone);
  if (!visits.length) throw new RightsError('No data is held for this number');
  const now = clock.now();
  const code = fourDigitCode();
  // Only the newest code works: earlier unused codes for this number stop working.
  await c.query("UPDATE text_code SET used_at = $2 WHERE phone_hash = $1 AND purpose = 'export' AND used_at IS NULL", [hash(phone), now]);
  await c.query(
    "INSERT INTO text_code (phone_hash, code_hash, purpose, expires_at, created_at) VALUES ($1, $2, 'export', $3, $4)",
    [hash(phone), hash(`${phone}:${code}`), new Date(now.getTime() + 10 * 60000), now],
  );
  await sendCodeNow(c, { to: phone, template: 'export_code', vars: { clinic: clinic.name, code }, language: clinic.default_language });
}

export interface PatientExport {
  generatedAt: string;
  clinic: string;
  phone: string;
  visits: Array<{
    name: string;
    professional: string;
    appointment: string | null;
    status: string;
    checkedIn: string | null;
    called: string | null;
    form: null | { reason: string | null; medications: string | null; fund: string | null; member: string | null; phone: string | null; updatedAt: string };
    textsSent: Array<{ type: string; at: string | null; status: string }>;
    formViewedByStaff: Array<{ role: string; at: string }>;
  }>;
}

/** WR-32: everything held about the patient, and nothing about anyone else. */
export async function exportPatient(c: PoolClient, phoneInput: string, code: string, staff: { id: string }): Promise<PatientExport> {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new RightsError('Invalid phone number');
  const now = clock.now();
  const r = await c.query(
    `SELECT * FROM text_code WHERE phone_hash = $1 AND purpose = 'export' AND used_at IS NULL AND expires_at > $2
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [hash(phone), now],
  );
  const row = r.rows[0];
  if (!row || row.attempts >= 3) throw new RightsError('Request a new code');
  if (row.code_hash !== hash(`${phone}:${code.trim()}`)) {
    await c.query('UPDATE text_code SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw new RightsError('Wrong code');
  }
  await c.query('UPDATE text_code SET used_at = $2 WHERE id = $1', [row.id, now]);
  const tz = clinic.time_zone;
  const iso = (d: Date | null) => (d ? `${localDate(d, tz)} ${localTime(d, tz)}` : null);
  const visits = await visitsForPhone(c, phone);
  const out: PatientExport = { generatedAt: iso(now)!, clinic: clinic.name, phone, visits: [] };
  for (const v of visits) {
    const form = await answersForPatient(c, v);
    const msgs = await c.query('SELECT template, sent_at, status FROM message WHERE visit_id = $1 ORDER BY created_at', [v.id]);
    const views = await c.query('SELECT staff_role, at FROM access_log WHERE trail_id = $1 ORDER BY at', [v.trail_id]);
    out.visits.push({
      name: v.patient_name,
      professional: v.professional_name,
      appointment: iso(v.starts_at),
      status: v.status,
      checkedIn: iso(v.arrived_at),
      called: iso(v.called_at),
      form: form && { reason: form.reason, medications: form.medications, fund: form.fund, member: form.member, phone: form.phone, updatedAt: form.updatedAt },
      textsSent: msgs.rows.map((m) => ({ type: m.template, at: iso(m.sent_at), status: m.status })),
      formViewedByStaff: views.rows.map((x) => ({ role: x.staff_role, at: iso(x.at)! })),
    });
  }
  await c.query('INSERT INTO data_request (kind, requested_at, completed_at, staff_user_id) VALUES ($1, $2, $3, $4)', ['export', now, clock.now(), staff.id]);
  await write(c, { type: 'data_exported', actor: `staff:${staff.id}`, details: { visits: visits.length } });
  return out;
}
