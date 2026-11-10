import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { localDate, localTime } from '../../../shared/time.js';
import { clock } from '../../clock.js';
import { fourDigitCode, hash, linkToken } from '../../crypto.js';
import { write } from '../../events.js';
import { getClinic, type ClinicSettings } from '../../settings.js';
import { normalizePhone } from '../appointments/phone.js';
import { queueText, sendCodeNow } from '../messaging/messages.js';
import { refreshEstimates } from '../queue/queue.js';
import { firstName, getVisit, VISIT_SELECT, type VisitRow } from './visits.js';

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 3;

export type CheckinOutcome =
  | { result: 'checked_in'; visitId: string }
  | { result: 'already_checked_in'; visitId: string }
  | { result: 'not_open_yet'; opensAt: string }
  | { result: 'not_today' };

/** WR-07: check-in opens N minutes before the appointment, on the day. */
export function checkinOpensAt(v: Pick<VisitRow, 'starts_at'>, clinic: Pick<ClinicSettings, 'checkin_open_minutes'>): Date | null {
  return v.starts_at ? new Date(v.starts_at.getTime() - clinic.checkin_open_minutes * 60000) : null;
}

export async function checkIn(c: PoolClient, visitId: string, method: 'qr' | 'text_code' | 'reception', actor: string): Promise<CheckinOutcome> {
  const clinic = await getClinic(c);
  const v = await getVisit(c, visitId, true);
  const now = clock.now();
  if (!v || v.status === 'cancelled' || v.day !== localDate(now, clinic.time_zone)) return { result: 'not_today' };
  if (v.status !== 'booked') return { result: 'already_checked_in', visitId };
  const opens = checkinOpensAt(v, clinic);
  if (opens && now < opens && method !== 'reception') return { result: 'not_open_yet', opensAt: localTime(opens, clinic.time_zone) };
  await c.query("UPDATE visit SET status = 'arrived', arrived_at = $2, checkin_method = $3 WHERE id = $1", [visitId, now, method]);
  const changed = await refreshEstimates(c, v.professional_id, v.day, now, clinic);
  await write(c, {
    type: 'checked_in',
    actor,
    visit: v,
    details: { method },
    queue: { professionalId: v.professional_id, day: v.day },
    notifyVisits: [visitId, ...changed],
  });
  return { result: 'checked_in', visitId };
}

/** WR-09: "Arrived" can be undone within 1 minute, for a wrong click. */
export async function undoArrived(c: PoolClient, visitId: string, actor: string) {
  const v = await getVisit(c, visitId, true);
  if (!v || v.status !== 'arrived' || !v.arrived_at) return false;
  if (clock.now().getTime() - v.arrived_at.getTime() > 60_000) return false;
  await c.query("UPDATE visit SET status = 'booked', arrived_at = NULL, checkin_method = NULL, shown_from = NULL, shown_to = NULL WHERE id = $1", [visitId]);
  const changed = await refreshEstimates(c, v.professional_id, v.day, clock.now());
  await write(c, { type: 'checkin_undone', actor, visit: v, queue: { professionalId: v.professional_id, day: v.day }, notifyVisits: [visitId, ...changed] });
  return true;
}

/** WR-07: visits today that this phone has opened (by cookie), for the one-tap check-in. */
export async function recognizedVisits(c: PoolClient, cookieId: string | undefined) {
  if (!cookieId) return [];
  const clinic = await getClinic(c);
  const today = localDate(clock.now(), clinic.time_zone);
  const r = await c.query(
    `${VISIT_SELECT} JOIN recognized_phone rp ON rp.visit_id = v.id
      WHERE rp.cookie_hash = $1 AND v.day = $2 AND v.status IN ('booked', 'arrived', 'called')
      ORDER BY a.starts_at NULLS LAST`,
    [hash(cookieId), today],
  );
  return r.rows.map((v: VisitRow) => describe(v, clinic));
}

function describe(v: VisitRow, clinic: ClinicSettings) {
  const opens = checkinOpensAt(v, clinic);
  return {
    visitId: v.id,
    firstName: firstName(v.patient_name),
    time: v.starts_at ? localTime(v.starts_at, clinic.time_zone) : null,
    professional: v.professional_name,
    status: v.status,
    checkinOpensAt: opens ? localTime(opens, clinic.time_zone) : null,
    checkinOpen: !opens || clock.now() >= opens,
  };
}

async function todaysVisitsForPhone(c: PoolClient, phone: string, clinic: ClinicSettings) {
  const today = localDate(clock.now(), clinic.time_zone);
  const r = await c.query(`${VISIT_SELECT} WHERE a.phone = $1 AND v.day = $2 AND v.status IN ('booked', 'arrived') ORDER BY a.starts_at`, [phone, today]);
  return r.rows as VisitRow[];
}

export type CodeRequestOutcome = { result: 'code_sent'; ending: string } | { result: 'see_reception' } | { result: 'too_many' };

/** WR-08: text a 4-digit code to a number that has an appointment today. */
export async function requestCheckinCode(c: PoolClient, phoneInput: string): Promise<CodeRequestOutcome> {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) return { result: 'see_reception' };
  const visits = await todaysVisitsForPhone(c, phone, clinic);
  if (!visits.length) return { result: 'see_reception' }; // nothing is recorded
  const now = clock.now();
  const recent = await c.query(
    "SELECT count(*)::int AS n FROM text_code WHERE phone_hash = $1 AND purpose = 'checkin' AND created_at > $2",
    [hash(phone), new Date(now.getTime() - CODE_MINUTES * 60000)],
  );
  if (recent.rows[0].n >= 3) return { result: 'too_many' };
  const code = fourDigitCode();
  // Only the newest code works: earlier unused codes for this number stop working.
  await c.query("UPDATE text_code SET used_at = $2 WHERE phone_hash = $1 AND purpose = 'checkin' AND used_at IS NULL", [hash(phone), now]);
  await c.query(
    "INSERT INTO text_code (phone_hash, code_hash, purpose, expires_at, created_at) VALUES ($1, $2, 'checkin', $3, $4)",
    [hash(phone), hash(`${phone}:${code}`), new Date(now.getTime() + CODE_MINUTES * 60000), now],
  );
  await sendCodeNow(c, { to: phone, template: 'checkin_code', vars: { clinic: clinic.name, code }, language: visits[0].language ?? clinic.default_language, visitId: visits[0].id });
  return { result: 'code_sent', ending: phone.slice(-2) };
}

export type CodeVerifyOutcome =
  | { result: 'checked_in'; visitId: string; token: string }
  | { result: 'choose'; options: ReturnType<typeof describe>[] }
  | { result: 'wrong_code'; attemptsLeft: number }
  | { result: 'see_reception' }
  | { result: 'not_open_yet'; opensAt: string };

/** WR-08: check the code; with two appointments today the patient picks one. */
export async function verifyCheckinCode(c: PoolClient, phoneInput: string, code: string, visitId?: string): Promise<CodeVerifyOutcome> {
  const clinic = await getClinic(c);
  const phone = normalizePhone(phoneInput);
  if (!phone) return { result: 'see_reception' };
  const now = clock.now();
  const r = await c.query(
    `SELECT * FROM text_code WHERE phone_hash = $1 AND purpose = 'checkin' AND used_at IS NULL AND expires_at > $2
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [hash(phone), now],
  );
  const row = r.rows[0];
  if (!row || row.attempts >= MAX_ATTEMPTS) return { result: 'see_reception' };
  if (row.code_hash !== hash(`${phone}:${code.trim()}`)) {
    const attempts = row.attempts + 1;
    await c.query('UPDATE text_code SET attempts = $2 WHERE id = $1', [row.id, attempts]);
    return attempts >= MAX_ATTEMPTS ? { result: 'see_reception' } : { result: 'wrong_code', attemptsLeft: MAX_ATTEMPTS - attempts };
  }
  const visits = await todaysVisitsForPhone(c, phone, clinic);
  if (!visits.length) return { result: 'see_reception' };
  let target = visits[0];
  if (visits.length > 1) {
    const picked = visits.find((v) => v.id === visitId);
    if (!picked) return { result: 'choose', options: visits.map((v) => describe(v, clinic)) };
    target = picked;
  }
  const out = await checkIn(c, target.id, 'text_code', 'patient');
  if (out.result === 'not_open_yet') return out;
  await c.query('UPDATE text_code SET used_at = $2 WHERE id = $1', [row.id, now]);
  return { result: 'checked_in', visitId: target.id, token: linkToken(target.id, 'visit') };
}

/** WR-10: register a walk-in; checked in at once, with a visit link when a phone number is given. */
export async function registerWalkIn(c: PoolClient, input: { name: string; phone?: string | null; professionalId: string }, actor: string) {
  const clinic = await getClinic(c);
  const now = clock.now();
  const name = input.name.trim();
  if (!name) throw new Error('Name is required');
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new Error('Invalid phone number');
  const pro = (await c.query("SELECT id, name FROM staff_user WHERE id = $1 AND role = 'professional'", [input.professionalId])).rows[0];
  if (!pro) throw new Error('Unknown professional');
  const appointmentId = randomUUID();
  const visitId = randomUUID();
  const day = localDate(now, clinic.time_zone);
  await c.query(
    `INSERT INTO appointment (id, professional_id, starts_at, patient_name, phone, source, created_at) VALUES ($1, $2, NULL, $3, $4, 'walk_in', $5)`,
    [appointmentId, pro.id, name, phone, now],
  );
  const ins = await c.query(
    `INSERT INTO visit (id, appointment_id, professional_id, kind, day, status, link_token_hash, form_token_hash, form_link_active_from,
                        checkin_method, arrived_at, created_at)
     VALUES ($1, $2, $3, 'walk_in', $4, 'arrived', $5, $6, $7, 'reception', $7, $7) RETURNING id, trail_id, professional_id, day`,
    [visitId, appointmentId, pro.id, day, hash(linkToken(visitId, 'visit')), hash(linkToken(visitId, 'form')), now],
  );
  const visit = ins.rows[0];
  const changed = await refreshEstimates(c, pro.id, day, now, clinic);
  await write(c, { type: 'walk_in_registered', actor, visit, details: { with_phone: !!phone }, queue: { professionalId: pro.id, day }, notifyVisits: [visitId, ...changed] });
  if (phone) {
    await queueText(c, { visitId, to: phone, template: 'walk_in', vars: { clinic: clinic.name, professional: pro.name }, language: clinic.default_language, dedupeKey: `walk_in:${visitId}` });
  }
  return { visitId };
}
