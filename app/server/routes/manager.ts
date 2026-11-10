import PDFDocument from 'pdfkit';
import type { FastifyInstance } from 'fastify';
import { localDate, localTime, zonedToUtc, addDays } from '../../shared/time.js';
import type { Deps } from '../app.js';
import { requireStaff } from '../app.js';
import { clock } from '../clock.js';
import { hash } from '../crypto.js';
import { withTx } from '../db/pool.js';
import { getClinic } from '../settings.js';
import { normalizePhone } from '../modules/appointments/phone.js';
import { erasePatient, exportPatient, findPatient, requestExportCode, type PatientExport } from '../modules/privacy/rights.js';

function exportPdf(data: PatientExport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(`${data.clinic}: your personal data`);
    doc.moveDown(0.5).fontSize(10).fillColor('#555').text(`Phone number ${data.phone} · generated ${data.generatedAt}`);
    doc.fillColor('#000');
    if (!data.visits.length) doc.moveDown().fontSize(11).text('We hold no visits for this number.');
    data.visits.forEach((v, i) => {
      doc.moveDown().fontSize(13).text(`Visit ${i + 1}: ${v.appointment ?? 'walk-in'} with ${v.professional}`);
      doc.fontSize(10);
      doc.text(`Name: ${v.name}`);
      doc.text(`Status: ${v.status}; checked in: ${v.checkedIn ?? '—'}; called: ${v.called ?? '—'}`);
      if (v.form) {
        doc.text(`Reason for visit: ${v.form.reason ?? '—'}`);
        doc.text(`Medicines: ${v.form.medications ?? '—'}`);
        doc.text(`Insurance fund: ${v.form.fund ?? '—'}, member number ${v.form.member ?? '—'}`);
        doc.text(`Form last changed: ${v.form.updatedAt}`);
      }
      doc.text(`Texts sent: ${v.textsSent.map((t) => `${t.type} (${t.at ?? 'not sent'}, ${t.status})`).join('; ') || 'none'}`);
      doc.text(`Form answers opened by staff: ${v.formViewedByStaff.map((x) => `${x.role} at ${x.at}`).join('; ') || 'never'}`);
    });
    doc.end();
  });
}

export async function managerRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const manager = { preHandler: requireStaff(deps, ['manager']) };

  app.post<{ Body: { phone: string } }>('/api/manager/patients/find', manager, async (req) => withTx((c) => findPatient(c, String(req.body?.phone ?? '')), db));

  /** WR-31: erase on request; confirmed with the last 4 digits. */
  app.post<{ Body: { phone: string; last4: string } }>('/api/manager/patients/erase', manager, async (req) =>
    withTx((c) => erasePatient(c, String(req.body?.phone ?? ''), String(req.body?.last4 ?? ''), req.staff!), db),
  );

  /** WR-32: export, step 1 — text a code to the number on file. */
  app.post<{ Body: { phone: string } }>('/api/manager/patients/export-code', manager, async (req) => {
    await withTx((c) => requestExportCode(c, String(req.body?.phone ?? '')), db);
    return { ok: true };
  });

  /** WR-32: export, step 2 — download as JSON or PDF. Created on demand, never stored; the download is logged. */
  app.post<{ Body: { phone: string; code: string; format?: 'json' | 'pdf' } }>('/api/manager/patients/export', manager, async (req, reply) => {
    const data = await withTx((c) => exportPatient(c, String(req.body?.phone ?? ''), String(req.body?.code ?? ''), req.staff!), db);
    const stamp = localDate(clock.now(), (await getClinic(db)).time_zone);
    reply.header('Cache-Control', 'no-store');
    if (req.body?.format === 'pdf') {
      reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="personal-data-${stamp}.pdf"`);
      return reply.send(await exportPdf(data));
    }
    reply.header('Content-Disposition', `attachment; filename="personal-data-${stamp}.json"`);
    return data;
  });

  /** WR-22: search the access log by patient phone number or by staff member. */
  app.get<{ Querystring: { phone?: string; staffId?: string } }>('/api/manager/access-log', manager, async (req) => {
    const clinic = await getClinic(db);
    const phone = normalizePhone(req.query.phone);
    const r = await db.query(
      `SELECT l.at, l.staff_role, s.name AS staff_name, a.patient_name
         FROM access_log l
         JOIN staff_user s ON s.id = l.staff_user_id
         LEFT JOIN visit v ON v.trail_id = l.trail_id
         LEFT JOIN appointment a ON a.id = v.appointment_id
        WHERE ($1::text IS NULL OR a.phone = $1) AND ($2::uuid IS NULL OR l.staff_user_id = $2::uuid)
        ORDER BY l.at DESC LIMIT 500`,
      [phone, req.query.staffId || null],
    );
    return {
      entries: r.rows.map((x) => ({ at: `${localDate(x.at, clinic.time_zone)} ${localTime(x.at, clinic.time_zone)}`, staff: x.staff_name, role: x.staff_role, patient: x.patient_name ?? '(erased or expired)' })),
    };
  });

  /** WR-20: a day's events as CSV, with names and phone numbers left out. */
  app.get<{ Querystring: { date?: string } }>('/api/manager/events.csv', manager, async (req, reply) => {
    const clinic = await getClinic(db);
    const day = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : localDate(clock.now(), clinic.time_zone);
    const from = zonedToUtc(day, '0:00', clinic.time_zone);
    const to = zonedToUtc(addDays(day, 1), '0:00', clinic.time_zone);
    const r = await db.query(
      `SELECT e.id, e.at, e.type, e.trail_id, s.name AS professional, e.details FROM event e
         LEFT JOIN staff_user s ON s.id = e.professional_id
        WHERE e.at >= $1 AND e.at < $2 ORDER BY e.at, e.id`,
      [from, to],
    );
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = ['id,time,type,visit,professional,details'];
    for (const e of r.rows) {
      const visit = e.trail_id ? hash(e.trail_id).slice(0, 10) : ''; // pseudonymous per visit
      lines.push([e.id, `${localDate(e.at, clinic.time_zone)} ${localTime(e.at, clinic.time_zone)}`, e.type, visit, e.professional ?? '', JSON.stringify(e.details)].map(esc).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="events-${day}.csv"`);
    return lines.join('\n') + '\n';
  });
}
