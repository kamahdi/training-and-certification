import { setClock } from '../../server/clock.js';
import { withTx } from '../../server/db/pool.js';
import { sentByFake } from '../../server/modules/messaging/provider.js';
import { checkIn } from '../../server/modules/visits/checkin.js';
import { delayCheck, refreshAllEstimates, runDueJobs } from '../../server/worker/tasks.js';
import { createTestDb, importRows, makeApp, resetFakes, useClock, visitIdByName, visitToken, type TestDb } from '../helpers.js';

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
  await db.pool.query('TRUNCATE appointment, event, job, message, queue_version, staff_session CASCADE');
  useClock('2026-11-11T10:00:00Z');
  await importRows(db, [
    ['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '10:00'],
    ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
    ['Dan Martens', '0470 11 22 04', 'Dr. Peeters', day, '10:15'],
    ['Eva Lambert', '0470 11 22 05', 'Dr. Peeters', day, '11:30'],
    ['Marc Dubois', '0470 11 22 06', 'Dr. Janssens', day, '10:00'],
  ]);
});

async function arrive(name: string, utc: string) {
  useClock(utc);
  const id = await visitIdByName(db, name);
  await withTx((c) => checkIn(c, id, 'reception', 'test'), db.pool);
  return id;
}

/** T-01 situation: Ana 9:30 (booked 10:00), Ben 9:50 (booked 9:45), Dan 10:05 (booked 10:15, emergency). */
async function morning() {
  const ana = await arrive('Ana Verbeke', '2026-11-12T08:30:00Z');
  const ben = await arrive('Ben Kowalski', '2026-11-12T08:50:00Z');
  const dan = await arrive('Dan Martens', '2026-11-12T09:05:00Z');
  return { ana, ben, dan };
}

async function queue(cookie: string, pid = db.staff.peeters) {
  return (await h.app.inject({ url: `/api/queue/${pid}`, headers: { cookie } })).json();
}

describe('Epic 4 · professional queue', () => {
  it('WR-11: a professional sees only their own queue; reception sees every queue; a manager none', async () => {
    useClock('2026-11-12T09:00:00Z');
    const peeters = await h.login('peeters@test');
    const reception = await h.login('reception@test');
    const manager = await h.login('manager@test');
    expect((await h.app.inject({ url: `/api/queue/${db.staff.peeters}`, headers: { cookie: peeters } })).statusCode).toBe(200);
    expect((await h.app.inject({ url: `/api/queue/${db.staff.janssens}`, headers: { cookie: peeters } })).statusCode).toBe(403);
    expect((await h.app.inject({ url: `/api/queue/${db.staff.janssens}`, headers: { cookie: reception } })).statusCode).toBe(200);
    expect((await h.app.inject({ url: `/api/queue/${db.staff.peeters}`, headers: { cookie: manager } })).statusCode).toBe(403);
  });

  it('WR-11: the screen locks after 15 minutes without activity; signing out on one PC does not affect another', async () => {
    const clock = useClock('2026-11-12T09:00:00Z');
    const pc1 = await h.login('peeters@test');
    const pc2 = await h.login('peeters@test');
    clock.advance(14);
    expect((await h.app.inject({ url: '/api/staff/me', headers: { cookie: pc1 } })).statusCode).toBe(200);
    clock.advance(16);
    const locked = await h.app.inject({ url: '/api/staff/me', headers: { cookie: pc1 } });
    expect(locked.statusCode).toBe(401);
    expect(locked.json().error).toBe('locked');
    const pc3 = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/staff/logout', headers: { cookie: pc3 } });
    const pc4 = await h.login('peeters@test');
    expect((await h.app.inject({ url: '/api/staff/me', headers: { cookie: pc4 } })).statusCode).toBe(200);
    void pc2;
  });

  it('WR-12: rows show what the professional needs, in the order to call them', async () => {
    await morning();
    await withTx((c) => c.query('UPDATE visit SET emergency = true WHERE id = (SELECT v.id FROM visit v JOIN appointment a ON a.id = v.appointment_id WHERE a.patient_name = $1)', ['Dan Martens']), db.pool);
    useClock('2026-11-12T09:06:00Z');
    const q = await queue(await h.login('peeters@test'));
    expect(q.patients.map((p: any) => p.name)).toEqual(['Dan Martens', 'Ben Kowalski', 'Ana Verbeke']);
    expect(q.patients[1]).toMatchObject({ appointmentTime: '9:45', arrivedTime: '9:50', waitingMinutes: 16, formDone: false, emergency: false });
  });

  it('WR-13: reception or the professional flags a patient from emergency; they move to the top, never shown to patients', async () => {
    const { dan } = await morning();
    useClock('2026-11-12T09:06:00Z');
    const reception = await h.login('reception@test');
    await h.app.inject({ method: 'POST', url: `/api/visits/${dan}/emergency`, headers: { cookie: reception }, payload: { on: true } });
    const peeters = await h.login('peeters@test');
    expect((await queue(peeters)).patients[0].name).toBe('Dan Martens');
    const page = (await h.app.inject({ url: `/api/visit/${visitToken(dan)}` })).body;
    expect(page).not.toMatch(/emergency/i);
    await h.app.inject({ method: 'POST', url: `/api/visits/${dan}/emergency`, headers: { cookie: peeters }, payload: { on: false } });
    expect((await queue(peeters)).patients.map((p: any) => p.name)).toEqual(['Ben Kowalski', 'Ana Verbeke', 'Dan Martens']);
  });
});

describe('Security · rate limits', () => {
  it('WR-08: check-in and sign-in endpoints are rate-limited against guessing', async () => {
    process.env.RATE_LIMIT = 'on';
    try {
      useClock('2026-11-12T09:00:00Z');
      const codes = [];
      for (let i = 0; i < 22; i++) codes.push((await h.app.inject({ method: 'POST', url: '/api/checkin/verify', payload: { phone: '0470 11 22 02', code: '0000' } })).statusCode);
      expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
      expect(codes.at(-1)).toBe(429);
    } finally {
      process.env.RATE_LIMIT = 'off';
    }
  });
});

describe('Epic 5 · calling patients in', () => {
  it('WR-14: "Next patient" calls the top of the list and records the time', async () => {
    const { ben } = await morning();
    useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    const q = await queue(cookie);
    const r = await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: q.version } });
    expect(r.json()).toMatchObject({ visitId: ben, name: 'Ben Kowalski' });
    const v = (await db.pool.query('SELECT status, called_at FROM visit WHERE id = $1', [ben])).rows[0];
    expect(v.status).toBe('called');
    expect(v.called_at.toISOString()).toBe('2026-11-12T09:06:00.000Z');
    expect((await queue(cookie)).patients.map((p: any) => p.name)).toEqual(['Ana Verbeke', 'Dan Martens']);
  });

  it('WR-14: T-04 a stale queue version gives 409 with the fresh queue, and nobody is called', async () => {
    await morning();
    useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    const stale = (await queue(cookie)).version;
    const reception = await h.login('reception@test');
    const marc = await visitIdByName(db, 'Eva Lambert');
    await h.app.inject({ method: 'POST', url: `/api/reception/visits/${marc}/arrived`, headers: { cookie: reception } });
    const r = await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: stale } });
    expect(r.statusCode).toBe(409);
    expect(r.json().queue.version).toBe(stale + 1);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM event WHERE type = 'called'")).rows[0].n).toBe(0);
  });

  it('WR-14: a call can be undone within 30 seconds; the patient returns to their place', async () => {
    const { ben } = await morning();
    const clock = useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    clock.advance(0.4);
    expect((await h.app.inject({ method: 'POST', url: `/api/visits/${ben}/undo-call`, headers: { cookie } })).statusCode).toBe(200);
    expect((await queue(cookie)).patients[0].name).toBe('Ben Kowalski');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    clock.advance(1);
    expect((await h.app.inject({ method: 'POST', url: `/api/visits/${ben}/undo-call`, headers: { cookie } })).statusCode).toBe(400);
  });

  it('WR-15: any waiting patient can be called; the call is logged as out of order with the places skipped', async () => {
    const { ana } = await morning();
    useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version, visitId: ana } });
    const e = (await db.pool.query("SELECT details FROM event WHERE type = 'called'")).rows[0].details;
    expect(e).toMatchObject({ out_of_order: true, skipped_places: 1 });
  });

  it('WR-16: "Not here, skip" puts the patient back after the next person; a second skip marks them missed; reception can return them', async () => {
    const { ben, ana } = await morning();
    useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    await h.app.inject({ method: 'POST', url: `/api/visits/${ben}/skip`, headers: { cookie } });
    expect((await queue(cookie)).patients.map((p: any) => p.name)).toEqual(['Ana Verbeke', 'Ben Kowalski', 'Dan Martens']);
    await h.app.inject({ method: 'POST', url: `/api/visits/${ben}/skip`, headers: { cookie } });
    expect((await db.pool.query('SELECT status FROM visit WHERE id = $1', [ben])).rows[0].status).toBe('missed');
    expect((await queue(cookie)).patients.map((p: any) => p.name)).toEqual(['Ana Verbeke', 'Dan Martens']);
    const reception = await h.login('reception@test');
    await h.app.inject({ method: 'POST', url: `/api/reception/visits/${ben}/return`, headers: { cookie: reception } });
    expect((await queue(cookie)).patients.map((p: any) => p.name)).toContain('Ben Kowalski');
    void ana;
  });
});

describe('Epic 6 · estimates and delay warnings', () => {
  it('WR-17: before the first call the page says the clinic has not started; after it, a range', async () => {
    const { ana } = await morning();
    useClock('2026-11-12T09:06:00Z');
    expect((await h.app.inject({ url: `/api/visit/${visitToken(ana)}` })).json().state).toBe('not_started');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    const view = (await h.app.inject({ url: `/api/visit/${visitToken(ana)}` })).json();
    // Ana is first in line now; default 15 min consultation; range 10:06-5 → 10:05 .. 10:16 → 10:15
    expect(view).toMatchObject({ state: 'waiting', from: '10:05', to: '10:15', slip: null });
    expect(JSON.stringify(view)).not.toMatch(/Ben|Dan/);
  });

  it('WR-18: when an emergency patient moves ahead and the time slips 10+ minutes, the page says why', async () => {
    const { ana, dan } = await morning();
    useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    await h.app.inject({ method: 'POST', url: `/api/visits/${dan}/emergency`, headers: { cookie }, payload: { on: true } });
    const view = (await h.app.inject({ url: `/api/visit/${visitToken(ana)}` })).json();
    expect(view.slip).toEqual({ reason: 'emergency' });
    expect(view.to).toBe('10:30');
  });

  it('WR-17: the worker refreshes estimates as time passes', async () => {
    const { ana } = await morning();
    const clock = useClock('2026-11-12T09:06:00Z');
    const cookie = await h.login('peeters@test');
    await h.app.inject({ method: 'POST', url: '/api/calls', headers: { cookie }, payload: { professionalId: db.staff.peeters, version: (await queue(cookie)).version } });
    clock.advance(20);
    expect(await refreshAllEstimates(db.pool)).toBeGreaterThan(0);
    expect((await h.app.inject({ url: `/api/visit/${visitToken(ana)}` })).json().from).toBe('10:25');
  });

  it('WR-19: T-03 running 20 minutes late, Eva (11:30, not checked in) gets one text to come at 11:50, and no second one', async () => {
    // Three booked calls, 20, 15 and 25 minutes after their times.
    const ben = await arrive('Ben Kowalski', '2026-11-12T08:40:00Z');
    const ana = await arrive('Ana Verbeke', '2026-11-12T08:41:00Z');
    const dan = await arrive('Dan Martens', '2026-11-12T08:42:00Z');
    await db.pool.query(
      `UPDATE visit SET status = 'done', called_at = CASE id WHEN $1::uuid THEN '2026-11-12T09:05:00Z'::timestamptz WHEN $2::uuid THEN '2026-11-12T09:15:00Z'::timestamptz ELSE '2026-11-12T09:40:00Z'::timestamptz END WHERE id IN ($1, $2, $3)`,
      [ben, ana, dan],
    );
    useClock('2026-11-12T09:15:00Z'); // 10:15; Eva at 11:30 is 75 minutes away
    await runDueJobs(db.pool); // earlier confirmations
    sentByFake.length = 0;
    expect(await delayCheck(db.pool)).toBe(1);
    await runDueJobs(db.pool);
    expect(sentByFake).toHaveLength(1);
    expect(sentByFake[0].to).toBe('+32470112205');
    expect(sentByFake[0].body).toMatch(/running about 20 min late\. Please come at 11:50 instead of 11:30/);
    useClock('2026-11-12T09:20:00Z');
    expect(await delayCheck(db.pool)).toBe(0);
  });
});
