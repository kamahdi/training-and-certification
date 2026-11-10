import type { FastifyInstance, FastifyRequest } from 'fastify';
import { localDate, localTime } from '../../shared/time.js';
import type { Deps } from '../app.js';
import { rateLimit, requireStaff, SESSION_COOKIE } from '../app.js';
import { clock } from '../clock.js';
import { withTx } from '../db/pool.js';
import { getClinic } from '../settings.js';
import { importAppointments } from '../modules/appointments/import.js';
import { maskPhone, normalizePhone } from '../modules/appointments/phone.js';
import { checkSession, login, logout, type Staff } from '../modules/auth/sessions.js';
import { recordDelivery } from '../modules/messaging/messages.js';
import { queueText } from '../modules/messaging/messages.js';
import { answersForStaff } from '../modules/privacy/form.js';
import { call, ConflictError, returnToQueue, setEmergency, skip, undoCall } from '../modules/queue/calls.js';
import { checkIn, registerWalkIn, undoArrived } from '../modules/visits/checkin.js';
import { getVisit } from '../modules/visits/visits.js';
import { staffSnapshot } from '../live/snapshots.js';

const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production' };

/** A professional may act only on their own queue; reception on any. */
function canUseQueue(staff: Staff, professionalId: string) {
  return staff.role === 'reception' || (staff.role === 'professional' && staff.id === professionalId);
}

export async function staffRoutes(app: FastifyInstance, deps: Deps) {
  const { db, hub } = deps;
  const anyStaff = { preHandler: requireStaff(deps) };
  const queueStaff = { preHandler: requireStaff(deps, ['professional', 'reception']) };
  const reception = { preHandler: requireStaff(deps, ['reception']) };

  app.post<{ Body: { email: string; password: string } }>('/api/staff/login', { preHandler: rateLimit(10, 60_000) }, async (req, reply) => {
    const res = await login(db, String(req.body?.email ?? ''), String(req.body?.password ?? ''));
    if (!res) return reply.code(401).send({ error: 'wrong_email_or_password' });
    reply.setCookie(SESSION_COOKIE, res.token, COOKIE_OPTS);
    return { staff: res.staff };
  });

  app.post('/api/staff/logout', async (req, reply) => {
    await logout(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/staff/me', anyStaff, async (req) => ({ staff: req.staff }));

  app.get('/api/staff/professionals', anyStaff, async () => {
    const r = await db.query("SELECT id, name, room FROM staff_user WHERE role = 'professional' AND active ORDER BY name");
    return { professionals: r.rows };
  });

  // ---------------------------------------------------------- queue
  app.get<{ Params: { professionalId: string } }>('/api/queue/:professionalId', queueStaff, async (req, reply) => {
    if (!canUseQueue(req.staff!, req.params.professionalId)) return reply.code(403).send({ error: 'forbidden' });
    return staffSnapshot(db, req.params.professionalId);
  });

  /** ADR-002: staff stream. */
  app.get<{ Querystring: { professionalId: string } }>('/api/stream/staff', queueStaff, async (req, reply) => {
    const pid = req.query.professionalId;
    if (!pid || !canUseQueue(req.staff!, pid)) return reply.code(403).send({ error: 'forbidden' });
    reply.hijack();
    await hub.open(reply.raw, { kind: 'staff', key: pid, sessionToken: req.cookies[SESSION_COOKIE] }, `staff:${req.staff!.id}`, req.headers['last-event-id'] as string | undefined);
  });

  async function today() {
    const clinic = await getClinic(db);
    return localDate(clock.now(), clinic.time_zone);
  }

  async function conflictBody(professionalId: string, reason: string) {
    return { error: reason, queue: await staffSnapshot(db, professionalId) };
  }

  /** WR-14 / WR-15: call the next patient, or a named one out of order. Stale version: 409 with the fresh queue. */
  app.post<{ Body: { professionalId: string; version: number; visitId?: string } }>('/api/calls', queueStaff, async (req, reply) => {
    const { professionalId, version, visitId } = req.body ?? ({} as any);
    if (!canUseQueue(req.staff!, professionalId)) return reply.code(403).send({ error: 'forbidden' });
    try {
      const day = await today();
      const res = await withTx((c) => call(c, { professionalId, day, version: Number(version), visitId, actor: `staff:${req.staff!.id}` }), db);
      return { ...res, calledTime: localTime(clock.now(), (await getClinic(db)).time_zone) };
    } catch (e) {
      if (e instanceof ConflictError) return reply.code(409).send(await conflictBody(professionalId, e.reason));
      throw e;
    }
  });

  async function visitFor(req: FastifyRequest<{ Params: { id: string } }>) {
    const v = await getVisit(db, req.params.id);
    if (!v || !canUseQueue(req.staff!, v.professional_id)) return null;
    return v;
  }

  app.post<{ Params: { id: string } }>('/api/visits/:id/undo-call', queueStaff, async (req, reply) => {
    if (!(await visitFor(req))) return reply.code(404).send({ error: 'not_found' });
    await withTx((c) => undoCall(c, req.params.id, `staff:${req.staff!.id}`), db);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/visits/:id/skip', queueStaff, async (req, reply) => {
    if (!(await visitFor(req))) return reply.code(404).send({ error: 'not_found' });
    await withTx((c) => skip(c, req.params.id, `staff:${req.staff!.id}`), db);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { on: boolean } }>('/api/visits/:id/emergency', queueStaff, async (req, reply) => {
    if (!(await visitFor(req))) return reply.code(404).send({ error: 'not_found' });
    await withTx((c) => setEmergency(c, req.params.id, !!req.body?.on, `staff:${req.staff!.id}`), db);
    return { ok: true };
  });

  /** WR-06 + WR-22: full form answers; every opening is logged. */
  app.get<{ Params: { id: string } }>('/api/visits/:id/answers', queueStaff, async (req, reply) => {
    const v = await getVisit(db, req.params.id);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const answers = await withTx((c) => answersForStaff(c, v, req.staff!), db);
    const tz = (await getClinic(db)).time_zone;
    return { name: v.patient_name, answers: answers && { ...answers, updatedTime: localTime(new Date(answers.updatedAt), tz) } };
  });

  // ------------------------------------------------------ reception
  /** WR-09: today's appointments, searchable by name or phone number. */
  app.get<{ Querystring: { q?: string; professionalId?: string } }>('/api/reception/today', reception, async (req) => {
    const clinic = await getClinic(db);
    const day = await today();
    const q = (req.query.q ?? '').trim();
    const phone = normalizePhone(q);
    const r = await db.query(
      `SELECT v.id, v.status, v.kind, v.emergency, v.arrived_at, v.called_at, v.checkin_method, v.professional_id,
              a.starts_at, a.patient_name, a.phone, s.name AS professional_name, s.room
         FROM visit v JOIN appointment a ON a.id = v.appointment_id JOIN staff_user s ON s.id = v.professional_id
        WHERE v.day = $1 AND v.status <> 'cancelled'
          AND ($2 = '' OR a.patient_name ILIKE '%' || $2 || '%' OR a.phone = $3)
          AND ($4::uuid IS NULL OR v.professional_id = $4::uuid)
        ORDER BY COALESCE(a.starts_at, v.arrived_at), a.patient_name`,
      [day, q, phone, req.query.professionalId || null],
    );
    return {
      appointments: r.rows.map((x) => ({
        visitId: x.id,
        name: x.patient_name,
        professionalId: x.professional_id,
        professional: x.professional_name,
        room: x.room,
        time: x.starts_at ? localTime(x.starts_at, clinic.time_zone) : null,
        kind: x.kind,
        status: x.status,
        emergency: x.emergency,
        arrivedAt: x.arrived_at ? localTime(x.arrived_at, clinic.time_zone) : null,
        arrivedAtIso: x.arrived_at?.toISOString() ?? null,
        checkinMethod: x.checkin_method,
        phone: x.phone ? maskPhone(x.phone) : null,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/reception/visits/:id/arrived', reception, async (req) => {
    return withTx((c) => checkIn(c, req.params.id, 'reception', `staff:${req.staff!.id}`), db);
  });

  app.post<{ Params: { id: string } }>('/api/reception/visits/:id/undo-arrived', reception, async (req, reply) => {
    const ok = await withTx((c) => undoArrived(c, req.params.id, `staff:${req.staff!.id}`), db);
    if (!ok) return reply.code(400).send({ error: 'Undo is only possible within 1 minute' });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/reception/visits/:id/return', reception, async (req) => {
    await withTx((c) => returnToQueue(c, req.params.id, `staff:${req.staff!.id}`), db);
    return { ok: true };
  });

  app.post<{ Body: { name: string; phone?: string; professionalId: string } }>('/api/reception/walk-ins', reception, async (req, reply) => {
    const b = req.body ?? ({} as any);
    try {
      return await withTx((c) => registerWalkIn(c, { name: String(b.name ?? ''), phone: b.phone || null, professionalId: String(b.professionalId ?? '') }, `staff:${req.staff!.id}`), db);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /** WR-01: import the appointments file (CSV body). */
  app.post('/api/reception/import', reception, async (req, reply) => {
    const body = typeof req.body === 'string' ? req.body : '';
    if (!body.trim()) return reply.code(400).send({ error: 'The file is empty' });
    return withTx((c) => importAppointments(c, body, `staff:${req.staff!.id}`), db);
  });

  /** WR-03: texts that could not be sent, for reception to fix. */
  app.get('/api/reception/failed-texts', reception, async () => {
    const day = await today();
    const r = await db.query(
      `SELECT m.id, m.template, m.error, m.to_phone, a.patient_name, v.id AS visit_id
         FROM message m JOIN visit v ON v.id = m.visit_id JOIN appointment a ON a.id = v.appointment_id
        WHERE m.status = 'failed' AND v.day >= $1 AND m.template NOT IN ('checkin_code', 'export_code')
        ORDER BY m.created_at DESC`,
      [day],
    );
    return { failed: r.rows.map((m) => ({ messageId: m.id, visitId: m.visit_id, name: m.patient_name, template: m.template, reason: m.error, phone: maskPhone(m.to_phone) })) };
  });

  /** Correct a number and resend the failed text. */
  app.post<{ Params: { id: string }; Body: { phone: string } }>('/api/reception/messages/:id/resend', reception, async (req, reply) => {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) return reply.code(400).send({ error: 'Invalid phone number' });
    const ok = await withTx(async (c) => {
      const m = (await c.query("SELECT * FROM message WHERE id = $1 AND status = 'failed'", [req.params.id])).rows[0];
      if (!m) return false;
      const v = await getVisit(c, m.visit_id);
      if (!v) return false;
      await c.query('UPDATE appointment SET phone = $2 WHERE id = $1', [v.appointment_id, phone]);
      await c.query("UPDATE message SET status = 'cancelled' WHERE id = $1", [m.id]);
      await queueText(c, { visitId: v.id, to: phone, template: m.template, vars: m.vars, language: m.language, dedupeKey: `resend:${m.id}` });
      return true;
    }, db);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  /** Delivery reports from the text provider (webhook). */
  app.post<{ Body: { providerId: string; delivered: boolean; reason?: string } }>('/api/provider/delivery', async (req, reply) => {
    const token = process.env.PROVIDER_WEBHOOK_TOKEN;
    if (token && req.headers['x-webhook-token'] !== token) return reply.code(401).send({ error: 'unauthorized' });
    const found = await withTx((c) => recordDelivery(c, String(req.body?.providerId ?? ''), !!req.body?.delivered, req.body?.reason), db);
    return found ? { ok: true } : reply.code(404).send({ error: 'not_found' });
  });

  // Keep the session check usable without counting as activity, for the lock screen.
  app.get('/api/staff/session', async (req) => {
    const s = await checkSession(db, req.cookies[SESSION_COOKIE], false);
    return s.ok ? { state: 'active', staff: s.staff } : { state: s.locked ? 'locked' : 'signed_out' };
  });
}
