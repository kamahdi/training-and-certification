import type { FastifyInstance } from 'fastify';
import { localDate } from '../../shared/time.js';
import type { Deps } from '../app.js';
import { DEVICE_COOKIE, rateLimit } from '../app.js';
import { clock } from '../clock.js';
import { newToken } from '../crypto.js';
import { withTx } from '../db/pool.js';
import { getClinic } from '../settings.js';
import { answersForPatient, formState, REASON_MAX, submitForm } from '../modules/privacy/form.js';
import { checkIn, recognizedVisits, requestCheckinCode, verifyCheckinCode } from '../modules/visits/checkin.js';
import { patientView } from '../modules/visits/patientView.js';
import { findByFormToken, findByLinkToken, firstName, linkWindow, rememberDevice } from '../modules/visits/visits.js';
import { formatDay } from '../../shared/format.js';
import { localTime } from '../../shared/time.js';

const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 30 };

export async function patientRoutes(app: FastifyInstance, deps: Deps) {
  const { db, hub } = deps;
  const limited = { preHandler: rateLimit(20, 60_000) };

  function deviceId(req: any, reply: any): string {
    let id = req.cookies[DEVICE_COOKIE];
    if (!id) {
      id = newToken();
      reply.setCookie(DEVICE_COOKIE, id, COOKIE_OPTS);
    }
    return id;
  }

  /** WR-02: the visit page. Opening it inside its window marks this phone as recognized (ADR-004). */
  app.get<{ Params: { token: string } }>('/api/visit/:token', limited, async (req, reply) => {
    const v = await findByLinkToken(db, req.params.token);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const clinic = await getClinic(db);
    const view = await patientView(db, v, clinic);
    if (view.state !== 'not_open' && view.state !== 'ended') {
      await rememberDevice(db, v.id, deviceId(req, reply), clock.now());
    }
    return view;
  });

  /** ADR-002: the patient stream. Unknown or expired token: 404, no stream. */
  app.get<{ Params: { token: string } }>('/api/stream/visit/:token', async (req, reply) => {
    const v = await findByLinkToken(db, req.params.token);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const clinic = await getClinic(db);
    const win = linkWindow(v, clinic);
    const now = clock.now();
    if (now < win.opensAt || now > win.closesAt || v.status === 'cancelled') return reply.code(404).send({ error: 'not_found' });
    reply.hijack();
    await hub.open(reply.raw, { kind: 'visit', key: v.id, professionalId: v.professional_id }, `visit:${v.id}`, req.headers['last-event-id'] as string | undefined);
  });

  /** WR-05: the pre-visit form. */
  app.get<{ Params: { token: string } }>('/api/form/:token', limited, async (req, reply) => {
    const v = await findByFormToken(db, req.params.token);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    const clinic = await getClinic(db);
    const state = formState(v, clock.now());
    return {
      state,
      reasonMax: REASON_MAX,
      visit: {
        firstName: firstName(v.patient_name),
        professional: v.professional_name,
        date: formatDay(v.starts_at ?? v.created_at, clinic.time_zone),
        time: v.starts_at ? localTime(v.starts_at, clinic.time_zone) : null,
        clinicName: clinic.name,
      },
      answers: state === 'open' || state === 'read_only' ? await answersForPatient(db, v) : null,
    };
  });

  app.post<{ Params: { token: string }; Body: any }>('/api/form/:token', limited, async (req, reply) => {
    const v = await findByFormToken(db, req.params.token);
    if (!v) return reply.code(404).send({ error: 'not_found' });
    await withTx((c) => submitForm(c, v, req.body ?? {}), db);
    return { ok: true };
  });

  /** WR-07: who this phone is, for the one-tap QR check-in. */
  app.get('/api/checkin/recognize', limited, async (req) => {
    const clinic = await getClinic(db);
    const visits = await withTx((c) => recognizedVisits(c, req.cookies[DEVICE_COOKIE]), db);
    return { clinicName: clinic.name, visits };
  });

  app.post<{ Body: { visitId: string } }>('/api/checkin/confirm', limited, async (req, reply) => {
    const cookie = req.cookies[DEVICE_COOKIE];
    const result = await withTx(async (c) => {
      const mine = await recognizedVisits(c, cookie);
      if (!mine.some((v) => v.visitId === req.body?.visitId)) return null;
      return checkIn(c, req.body.visitId, 'qr', 'patient');
    }, db);
    if (!result) return reply.code(403).send({ error: 'not_recognized' });
    return result;
  });

  /** WR-08: text code check-in. */
  app.post<{ Body: { phone: string } }>('/api/checkin/code', limited, async (req) => {
    return withTx((c) => requestCheckinCode(c, String(req.body?.phone ?? '')), db);
  });

  app.post<{ Body: { phone: string; code: string; visitId?: string } }>('/api/checkin/verify', limited, async (req, reply) => {
    const out = await withTx((c) => verifyCheckinCode(c, String(req.body?.phone ?? ''), String(req.body?.code ?? ''), req.body?.visitId), db);
    if (out.result === 'checked_in') {
      await rememberDevice(db, out.visitId, deviceId(req, reply), clock.now());
    }
    return out;
  });

  app.get('/api/clinic', async () => {
    const clinic = await getClinic(db);
    return { name: clinic.name, address: clinic.address, today: localDate(clock.now(), clinic.time_zone), timeZone: clinic.time_zone };
  });
}
