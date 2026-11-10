import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type { PoolClient } from 'pg';
import { addDays, localDate, localTime, zonedToUtc } from '../../../shared/time.js';
import { formatDay } from '../../../shared/format.js';
import { clock } from '../../clock.js';
import { hash, linkToken } from '../../crypto.js';
import { write } from '../../events.js';
import { cancelJobsForVisits, enqueue } from '../../jobs.js';
import { getClinic, type ClinicSettings } from '../../settings.js';
import { queueText } from '../messaging/messages.js';
import { normalizePhone } from './phone.js';

export interface ParsedRow {
  row: number;
  patientName: string;
  phone: string;
  professional: string;
  date: string; // YYYY-MM-DD
  time: string; // H:MM
  language: string | null;
}

export interface RowProblem {
  row: number;
  reason: string;
}

const HEADER_ALIASES: Record<string, keyof Omit<ParsedRow, 'row'>> = {
  'patient name': 'patientName', patient_name: 'patientName', patient: 'patientName', name: 'patientName',
  'phone number': 'phone', phone_number: 'phone', phone: 'phone', telephone: 'phone',
  professional: 'professional', doctor: 'professional',
  date: 'date',
  time: 'time',
  language: 'language', lang: 'language',
};
const REQUIRED: (keyof Omit<ParsedRow, 'row'>)[] = ['patientName', 'phone', 'professional', 'date', 'time'];
const LABEL: Record<string, string> = { patientName: 'patient name', phone: 'phone number', professional: 'professional', date: 'date', time: 'time' };

function normDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function normTime(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})[:h.](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${h}:${String(mi).padStart(2, '0')}`;
}

/** WR-01: parse and check rows. Columns may come in any order; headers are matched by name. */
export function parseAppointmentsCsv(text: string): { rows: ParsedRow[]; problems: RowProblem[] } {
  const records: string[][] = parse(text.replace(/^﻿/, ''), { skip_empty_lines: true, relax_column_count: true, trim: true });
  if (!records.length) return { rows: [], problems: [{ row: 1, reason: 'The file is empty' }] };
  const header = records[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()]);
  const missing = REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) {
    return { rows: [], problems: [{ row: 1, reason: `Missing column: ${missing.map((k) => LABEL[k]).join(', ')}` }] };
  }
  const rows: ParsedRow[] = [];
  const problems: RowProblem[] = [];
  records.slice(1).forEach((rec, i) => {
    const rowNo = i + 2; // spreadsheet numbering: header is row 1
    const get = (k: string) => {
      const idx = header.indexOf(k as never);
      return idx >= 0 ? (rec[idx] ?? '').trim() : '';
    };
    const empty = REQUIRED.filter((k) => !get(k));
    if (empty.length) {
      problems.push({ row: rowNo, reason: `Missing ${empty.map((k) => LABEL[k]).join(', ')}` });
      return;
    }
    const phone = normalizePhone(get('phone'));
    if (!phone) {
      problems.push({ row: rowNo, reason: 'Invalid phone number' });
      return;
    }
    const date = normDate(get('date'));
    if (!date) {
      problems.push({ row: rowNo, reason: 'Invalid date (use YYYY-MM-DD or DD/MM/YYYY)' });
      return;
    }
    const time = normTime(get('time'));
    if (!time) {
      problems.push({ row: rowNo, reason: 'Invalid time (use HH:MM)' });
      return;
    }
    rows.push({ row: rowNo, patientName: get('patientName'), phone, professional: get('professional'), date, time, language: get('language') || null });
  });
  return { rows, problems };
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  cancelled: number;
  skipped: RowProblem[];
}

export function sourceKey(phone: string, professionalId: string, startsAt: Date) {
  return hash(`${phone}|${professionalId}|${startsAt.toISOString()}`);
}

/** WR-01 + WR-03 + WR-04: import rows, create visits, queue confirmations and reminders. */
export async function importAppointments(c: PoolClient, csv: string, actor: string): Promise<ImportResult> {
  const clinic = await getClinic(c);
  const tz = clinic.time_zone;
  const now = clock.now();
  const { rows, problems } = parseAppointmentsCsv(csv);
  const skipped = [...problems];
  const pros = (await c.query("SELECT id, name, email FROM staff_user WHERE role = 'professional' AND active")).rows;
  const findPro = (v: string) => pros.find((p) => p.name.toLowerCase() === v.toLowerCase() || p.email.toLowerCase() === v.toLowerCase());

  let imported = 0;
  let duplicates = 0;
  const keysInFile = new Set<string>();
  const datesInFile = new Set<string>();

  for (const r of rows) {
    const pro = findPro(r.professional);
    if (!pro) {
      skipped.push({ row: r.row, reason: `Unknown professional "${r.professional}"` });
      continue;
    }
    const startsAt = zonedToUtc(r.date, r.time, tz);
    const key = sourceKey(r.phone, pro.id, startsAt);
    keysInFile.add(key);
    datesInFile.add(r.date);

    const erased = await c.query('SELECT 1 FROM erasure_list WHERE phone_hash = $1 AND starts_at = $2', [hash(r.phone), startsAt]);
    if (erased.rowCount) {
      skipped.push({ row: r.row, reason: 'Erased on request' });
      continue;
    }
    const existing = await c.query('SELECT id FROM appointment WHERE source_key = $1', [key]);
    if (existing.rowCount) {
      duplicates++;
      continue;
    }
    await createBookedVisit(c, clinic, { ...r, professionalId: pro.id, professionalName: pro.name, startsAt, key }, actor, now);
    imported++;
  }

  // A row missing from a re-import of the same day's file counts as cancelled (qa/test-strategy.md › Gaps).
  let cancelled = 0;
  if (datesInFile.size) {
    const stale = await c.query(
      `SELECT a.id AS appointment_id, a.source_key, v.id, v.trail_id, v.professional_id, v.day
         FROM appointment a JOIN visit v ON v.appointment_id = a.id
        WHERE a.source = 'file' AND a.cancelled_at IS NULL AND v.status = 'booked' AND v.day = ANY($1::date[])`,
      [[...datesInFile]],
    );
    for (const v of stale.rows) {
      if (keysInFile.has(v.source_key)) continue;
      await c.query('UPDATE appointment SET cancelled_at = $2 WHERE id = $1', [v.appointment_id, now]);
      await c.query("UPDATE visit SET status = 'cancelled' WHERE id = $1", [v.id]);
      await cancelJobsForVisits(c, [v.id]);
      await c.query("UPDATE message SET status = 'cancelled' WHERE visit_id = $1 AND status = 'queued'", [v.id]);
      await write(c, { type: 'appointment_cancelled', actor, visit: v, details: { reason: 'missing_from_reimport' } });
      cancelled++;
    }
  }

  await write(c, { type: 'import_completed', actor, details: { imported, duplicates, cancelled, skipped: skipped.length } });
  return { imported, duplicates, cancelled, skipped };
}

async function createBookedVisit(
  c: PoolClient,
  clinic: ClinicSettings,
  a: ParsedRow & { professionalId: string; professionalName: string; startsAt: Date; key: string },
  actor: string,
  now: Date,
) {
  const tz = clinic.time_zone;
  const appointmentId = randomUUID();
  const visitId = randomUUID();
  const day = localDate(a.startsAt, tz);
  const today = localDate(now, tz);
  const sameDay = day === today;
  await c.query(
    `INSERT INTO appointment (id, professional_id, starts_at, patient_name, phone, language, source, source_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'file', $7, $8)`,
    [appointmentId, a.professionalId, a.startsAt, a.patientName, a.phone, a.language, a.key, now],
  );
  const ins = await c.query(
    `INSERT INTO visit (id, appointment_id, professional_id, kind, day, link_token_hash, form_token_hash, form_link_active_from, created_at)
     VALUES ($1, $2, $3, 'booked', $4, $5, $6, $7, $8) RETURNING id, trail_id, professional_id, day`,
    [visitId, appointmentId, a.professionalId, day, hash(linkToken(visitId, 'visit')), hash(linkToken(visitId, 'form')), sameDay ? now : null, now],
  );
  const visit = ins.rows[0];
  await write(c, { type: 'appointment_imported', actor, visit, queue: { professionalId: a.professionalId, day } });

  const language = a.language ?? clinic.default_language;
  const vars = { clinic: clinic.name, professional: a.professionalName, date: formatDay(a.startsAt, tz), time: localTime(a.startsAt, tz) };
  // WR-03: confirmation within a minute of the import; same-day bookings get the form link in it.
  await queueText(c, {
    visitId, to: a.phone, language, vars,
    template: sameDay ? 'confirmation_same_day' : 'confirmation',
    dedupeKey: `confirmation:${visitId}`,
  });

  // WR-04: reminder between 17:00 and 19:00 the day before; none for same-day bookings.
  if (!sameDay && day > today) {
    const dayBefore = addDays(day, -1);
    const windowStart = zonedToUtc(dayBefore, '17:00', tz);
    const windowEnd = zonedToUtc(dayBefore, '19:00', tz);
    if (now < windowEnd) {
      await enqueue(c, 'send_reminder', { visitId }, { runAt: now > windowStart ? now : windowStart, dedupeKey: `reminder:${visitId}`, visitId });
    }
  }
}
