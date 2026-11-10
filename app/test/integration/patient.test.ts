import { setClock } from '../../server/clock.js';
import { sentByFake } from '../../server/modules/messaging/provider.js';
import { runDueJobs } from '../../server/worker/tasks.js';
import { createTestDb, formToken, importRows, makeApp, resetFakes, useClock, visitIdByName, visitToken, type TestDb } from '../helpers.js';

let db: TestDb;
let h: Awaited<ReturnType<typeof makeApp>>;
const day = '2026-11-12';

beforeAll(async () => {
  db = await createTestDb();
  h = await makeApp(db);
});
afterAll(async () => {
  setClock(null);
  await h.close();
  await db.close();
});
beforeEach(async () => {
  resetFakes();
  await db.pool.query('TRUNCATE appointment, event, job, message, text_code, erasure_list CASCADE');
  useClock('2026-11-11T10:00:00Z');
  await importRows(db, [
    ['Sara Bauwens', '0470 11 22 03', 'Dr. Peeters', day, '14:00'],
    ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
    ['Twin One', '0470 11 22 09', 'Dr. Peeters', day, '10:00'],
    ['Twin One', '0470 11 22 09', 'Dr. Janssens', day, '10:30'],
  ]);
});

const cookieOf = (r: any) => r.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

describe('Epic 1 · visit page', () => {
  it('WR-02: T-08 the link shows "opens at 11:00" at 10:59, is live from 11:00 to 17:00, and has ended at 17:01', async () => {
    const t = visitToken(await visitIdByName(db, 'Sara Bauwens'));
    const clock = useClock('2026-11-12T09:59:00Z');
    expect((await h.app.inject({ url: `/api/visit/${t}` })).json()).toMatchObject({ state: 'not_open', opensAt: '11:00' });
    clock.set('2026-11-12T10:00:00Z');
    const live = (await h.app.inject({ url: `/api/visit/${t}` })).json();
    expect(live).toMatchObject({ state: 'booked', firstName: 'Sara', time: '14:00', professional: 'Dr. Peeters', clinicAddress: 'Test street 1' });
    clock.set('2026-11-12T16:00:00Z');
    expect((await h.app.inject({ url: `/api/visit/${t}` })).json().state).toBe('booked');
    clock.set('2026-11-12T16:01:00Z');
    expect((await h.app.inject({ url: `/api/visit/${t}` })).json()).toEqual({ state: 'ended' });
  });

  it('WR-02: an unknown token gives 404, and the page never shows another patient', async () => {
    useClock('2026-11-12T11:00:00Z');
    expect((await h.app.inject({ url: '/api/visit/AAAAAAAAAAAAAAAAAAAAAA' })).statusCode).toBe(404);
    const body = (await h.app.inject({ url: `/api/visit/${visitToken(await visitIdByName(db, 'Sara Bauwens'))}` })).body;
    expect(body).not.toMatch(/Ben|Kowalski|Twin/);
  });

  it('WR-02: only a hash of the link token is in the database', async () => {
    const id = await visitIdByName(db, 'Sara Bauwens');
    const r = await db.pool.query('SELECT link_token_hash FROM visit WHERE id = $1', [id]);
    expect(r.rows[0].link_token_hash).not.toContain(visitToken(id));
    expect(r.rows[0].link_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Epic 2 · pre-visit form', () => {
  it('WR-05: the form needs consent, limits the reason to 200 characters, and saves encrypted answers', async () => {
    useClock('2026-11-11T16:30:00Z');
    await runDueJobs(db.pool); // the reminder opens the form
    const id = await visitIdByName(db, 'Sara Bauwens');
    const url = `/api/form/${formToken(id)}`;
    expect((await h.app.inject({ url })).json().state).toBe('open');
    const noConsent = await h.app.inject({ method: 'POST', url, payload: { reason: 'Knee pain' } });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().error).toMatch(/accept/);
    const tooLong = await h.app.inject({ method: 'POST', url, payload: { reason: 'x'.repeat(201), consent: true } });
    expect(tooLong.json().error).toMatch(/200 characters/);
    const ok = await h.app.inject({ method: 'POST', url, payload: { reason: 'Knee pain, follow-up', medications: 'Ibuprofen', fund: 'Fund A', member: '123', consent: true } });
    expect(ok.statusCode).toBe(200);
    const raw = (await db.pool.query('SELECT reason_enc FROM form_answers WHERE visit_id = $1', [id])).rows[0].reason_enc;
    expect(raw).not.toContain('Knee');
    expect((await h.app.inject({ url })).json().answers.reason).toBe('Knee pain, follow-up');
  });

  it('WR-05: answers are never included in a text message', async () => {
    useClock('2026-11-11T16:30:00Z');
    await runDueJobs(db.pool);
    const id = await visitIdByName(db, 'Sara Bauwens');
    await h.app.inject({ method: 'POST', url: `/api/form/${formToken(id)}`, payload: { reason: 'chest pain', consent: true } });
    await runDueJobs(db.pool);
    expect(sentByFake.some((m) => /chest/.test(m.body))).toBe(false);
    const stored = (await db.pool.query('SELECT body, vars::text FROM message')).rows;
    expect(stored.some((m) => /chest/.test(m.body + m.vars))).toBe(false);
  });

  it('WR-06 / WR-22: only the patient\'s professional and reception see the answers, and every opening is logged', async () => {
    useClock('2026-11-11T16:30:00Z');
    await runDueJobs(db.pool);
    const id = await visitIdByName(db, 'Sara Bauwens');
    await h.app.inject({ method: 'POST', url: `/api/form/${formToken(id)}`, payload: { reason: 'Knee pain', consent: true } });
    const peeters = await h.login('peeters@test');
    const janssens = await h.login('janssens@test');
    const r1 = await h.app.inject({ url: `/api/visits/${id}/answers`, headers: { cookie: peeters } });
    expect(r1.json().answers.reason).toBe('Knee pain');
    expect((await h.app.inject({ url: `/api/visits/${id}/answers`, headers: { cookie: janssens } })).statusCode).toBe(403);
    const log = (await db.pool.query('SELECT staff_role FROM access_log')).rows;
    expect(log).toEqual([{ staff_role: 'professional' }]);
    await expect(db.pool.query('DELETE FROM access_log')).rejects.toThrow(/append-only/);
    await expect(db.pool.query("UPDATE access_log SET staff_role = 'x'")).rejects.toThrow(/append-only/);
  });
});

describe('Epic 3 · check-in', () => {
  async function openVisitPage(name: string) {
    const r = await h.app.inject({ url: `/api/visit/${visitToken(await visitIdByName(db, name))}` });
    return cookieOf(r);
  }

  it('WR-07: a phone that opened the visit link checks in with one tap, and only from 60 minutes before', async () => {
    const clock = useClock('2026-11-12T10:30:00Z'); // 11:30, link open, check-in not yet (opens 13:00)
    const cookie = await openVisitPage('Sara Bauwens');
    const rec = (await h.app.inject({ url: '/api/checkin/recognize', headers: { cookie } })).json();
    expect(rec.visits[0]).toMatchObject({ firstName: 'Sara', checkinOpen: false, checkinOpensAt: '13:00' });
    const early = (await h.app.inject({ method: 'POST', url: '/api/checkin/confirm', headers: { cookie }, payload: { visitId: rec.visits[0].visitId } })).json();
    expect(early).toEqual({ result: 'not_open_yet', opensAt: '13:00' });
    clock.set('2026-11-12T12:05:00Z');
    const ok = (await h.app.inject({ method: 'POST', url: '/api/checkin/confirm', headers: { cookie }, payload: { visitId: rec.visits[0].visitId } })).json();
    expect(ok.result).toBe('checked_in');
    const again = (await h.app.inject({ method: 'POST', url: '/api/checkin/confirm', headers: { cookie }, payload: { visitId: rec.visits[0].visitId } })).json();
    expect(again.result).toBe('already_checked_in');
    expect((await db.pool.query("SELECT checkin_method FROM visit WHERE id = $1", [rec.visits[0].visitId])).rows[0].checkin_method).toBe('qr');
  });

  it('WR-07: a phone cannot check in a visit it never opened', async () => {
    useClock('2026-11-12T12:05:00Z');
    const cookie = await openVisitPage('Sara Bauwens');
    const ben = await visitIdByName(db, 'Ben Kowalski');
    expect((await h.app.inject({ method: 'POST', url: '/api/checkin/confirm', headers: { cookie }, payload: { visitId: ben } })).statusCode).toBe(403);
  });

  it('WR-08: a number with no appointment today shows "see reception" and records nothing', async () => {
    useClock('2026-11-12T08:40:00Z');
    const r = (await h.app.inject({ method: 'POST', url: '/api/checkin/code', payload: { phone: '0470 99 99 99' } })).json();
    expect(r).toEqual({ result: 'see_reception' });
    expect((await db.pool.query('SELECT count(*)::int AS n FROM text_code')).rows[0].n).toBe(0);
    expect(sentByFake).toHaveLength(0);
  });

  it('WR-08: after 3 wrong codes the page says "see reception"; a right code checks in', async () => {
    useClock('2026-11-12T08:40:00Z'); // 9:40, Ben booked 9:45
    const r = (await h.app.inject({ method: 'POST', url: '/api/checkin/code', payload: { phone: '0470 11 22 02' } })).json();
    expect(r).toEqual({ result: 'code_sent', ending: '02' });
    const code = sentByFake.at(-1)!.body.match(/code is (\d{4})/)![1];
    const wrong = code === '0000' ? '1111' : '0000';
    const verify = (c: string) => h.app.inject({ method: 'POST', url: '/api/checkin/verify', payload: { phone: '0470 11 22 02', code: c } });
    expect((await verify(wrong)).json()).toEqual({ result: 'wrong_code', attemptsLeft: 2 });
    expect((await verify(wrong)).json()).toEqual({ result: 'wrong_code', attemptsLeft: 1 });
    expect((await verify(wrong)).json()).toEqual({ result: 'see_reception' });
    expect((await verify(code)).json()).toEqual({ result: 'see_reception' });

    await h.app.inject({ method: 'POST', url: '/api/checkin/code', payload: { phone: '0470 11 22 02' } });
    const fresh = sentByFake.at(-1)!.body.match(/code is (\d{4})/)![1];
    const ok = await verify(fresh);
    expect(ok.json()).toMatchObject({ result: 'checked_in' });
    expect(ok.cookies.some((c) => c.name === 'wr_device')).toBe(true);
    expect((await db.pool.query('SELECT code_hash FROM text_code')).rows.every((x) => !x.code_hash.includes(fresh))).toBe(true);
  });

  it('WR-08: the code works for 10 minutes', async () => {
    const clock = useClock('2026-11-12T08:40:00Z');
    await h.app.inject({ method: 'POST', url: '/api/checkin/code', payload: { phone: '0470 11 22 02' } });
    const code = sentByFake.at(-1)!.body.match(/code is (\d{4})/)![1];
    clock.advance(11);
    expect((await h.app.inject({ method: 'POST', url: '/api/checkin/verify', payload: { phone: '0470 11 22 02', code } })).json()).toEqual({ result: 'see_reception' });
  });

  it('WR-08: a number with two appointments today asks the patient to pick one', async () => {
    useClock('2026-11-12T08:50:00Z');
    await h.app.inject({ method: 'POST', url: '/api/checkin/code', payload: { phone: '0470 11 22 09' } });
    const code = sentByFake.at(-1)!.body.match(/code is (\d{4})/)![1];
    const pick = (await h.app.inject({ method: 'POST', url: '/api/checkin/verify', payload: { phone: '0470 11 22 09', code } })).json();
    expect(pick.result).toBe('choose');
    expect(pick.options.map((o: any) => o.professional)).toEqual(['Dr. Peeters', 'Dr. Janssens']);
    const done = (await h.app.inject({ method: 'POST', url: '/api/checkin/verify', payload: { phone: '0470 11 22 09', code, visitId: pick.options[1].visitId } })).json();
    expect(done.result).toBe('checked_in');
    expect(done.visitId).toBe(pick.options[1].visitId);
  });

  it('WR-09: reception checks a patient in with one click, and can undo within 1 minute', async () => {
    const clock = useClock('2026-11-12T08:30:00Z');
    const cookie = await h.login('reception@test');
    const list = (await h.app.inject({ url: '/api/reception/today?q=Ben', headers: { cookie } })).json();
    expect(list.appointments).toHaveLength(1);
    const id = list.appointments[0].visitId;
    expect((await h.app.inject({ method: 'POST', url: `/api/reception/visits/${id}/arrived`, headers: { cookie } })).json().result).toBe('checked_in');
    clock.advance(0.5);
    expect((await h.app.inject({ method: 'POST', url: `/api/reception/visits/${id}/undo-arrived`, headers: { cookie } })).statusCode).toBe(200);
    await h.app.inject({ method: 'POST', url: `/api/reception/visits/${id}/arrived`, headers: { cookie } });
    clock.advance(2);
    expect((await h.app.inject({ method: 'POST', url: `/api/reception/visits/${id}/undo-arrived`, headers: { cookie } })).statusCode).toBe(400);
    const byPhone = (await h.app.inject({ url: `/api/reception/today?q=${encodeURIComponent('0470 11 22 02')}`, headers: { cookie } })).json();
    expect(byPhone.appointments[0].name).toBe('Ben Kowalski');
  });

  it('WR-10: a walk-in is checked in at once, joins the right queue and gets a visit link by text', async () => {
    useClock('2026-11-12T09:04:00Z');
    const cookie = await h.login('reception@test');
    const r = await h.app.inject({ method: 'POST', url: '/api/reception/walk-ins', headers: { cookie }, payload: { name: 'Lucas Dumont', phone: '0489 55 21 07', professionalId: db.staff.peeters } });
    expect(r.statusCode).toBe(200);
    const v = (await db.pool.query('SELECT status, kind, checkin_method FROM visit WHERE id = $1', [r.json().visitId])).rows[0];
    expect(v).toEqual({ status: 'arrived', kind: 'walk_in', checkin_method: 'reception' });
    await runDueJobs(db.pool);
    expect(sentByFake.at(-1)!.body).toMatch(/checked in to see Dr\. Peeters.*\/v\//);
    const noName = await h.app.inject({ method: 'POST', url: '/api/reception/walk-ins', headers: { cookie }, payload: { name: ' ', professionalId: db.staff.peeters } });
    expect(noName.statusCode).toBe(400);
  });
});
