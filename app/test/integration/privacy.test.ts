import { setClock } from '../../server/clock.js';
import { withTx } from '../../server/db/pool.js';
import { sentByFake } from '../../server/modules/messaging/provider.js';
import { reapplyErasures } from '../../server/modules/privacy/rights.js';
import { retention, runDueJobs } from '../../server/worker/tasks.js';
import { createTestDb, formToken, importRows, makeApp, resetFakes, useClock, visitIdByName, visitToken, type TestDb } from '../helpers.js';

let db: TestDb;
let h: Awaited<ReturnType<typeof makeApp>>;
const day = '2026-11-12';
const SARA = '0470 11 22 03';
const SARA_E164 = '+32470112203';

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
  await db.pool.query('TRUNCATE appointment, event, job, message, erasure_list, data_request, text_code, queue_version, staff_session CASCADE');
  useClock('2026-11-11T10:00:00Z');
  await importRows(db, [
    ['Sara Bauwens', SARA, 'Dr. Peeters', '2026-11-12', '14:00'],
    ['Sara Bauwens', SARA, 'Dr. Janssens', '2026-11-19', '9:00'],
    ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
  ]);
  useClock('2026-11-11T16:30:00Z');
  await runDueJobs(db.pool);
  await runDueJobs(db.pool);
});

async function fillForm(name: string, reason: string) {
  const ids = (await db.pool.query('SELECT v.id FROM visit v JOIN appointment a ON a.id = v.appointment_id WHERE a.patient_name = $1 ORDER BY a.starts_at', [name])).rows;
  await db.pool.query('UPDATE visit SET form_link_active_from = $2 WHERE id = $1', [ids[0].id, new Date('2026-11-11T16:00:00Z')]);
  const r = await h.app.inject({ method: 'POST', url: `/api/form/${formToken(ids[0].id)}`, payload: { reason, medications: 'Ibuprofen', consent: true } });
  expect(r.statusCode).toBe(200);
  return ids[0].id as string;
}

/** Search every text column of every table for any of the strings. */
async function findAnywhere(needles: string[]) {
  const cols = (await db.pool.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('text', 'jsonb', 'character varying')`,
  )).rows;
  const hits: string[] = [];
  for (const { table_name, column_name } of cols) {
    for (const n of needles) {
      const r = await db.pool.query(`SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}"::text ILIKE $1`, [`%${n}%`]);
      if (r.rows[0].n) hits.push(`${table_name}.${column_name} ~ ${n}`);
    }
  }
  return hits;
}

describe('Epic 7 · privacy and data', () => {
  it('WR-20: the manager exports a day of events as CSV, with names and phone numbers left out', async () => {
    useClock('2026-11-12T13:00:00Z');
    const reception = await h.login('reception@test');
    const ben = await visitIdByName(db, 'Ben Kowalski');
    await h.app.inject({ method: 'POST', url: `/api/reception/visits/${ben}/arrived`, headers: { cookie: reception } });
    const manager = await h.login('manager@test');
    const csv = await h.app.inject({ url: '/api/manager/events.csv?date=2026-11-12', headers: { cookie: manager } });
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/checked_in/);
    expect(csv.body).not.toMatch(/Ben|Kowalski|\+32|0470/);
    expect((await h.app.inject({ url: '/api/manager/events.csv', headers: { cookie: reception } })).statusCode).toBe(403);
  });

  it('WR-21: after the retention period names, phones and answers are deleted; events stay without identity', async () => {
    await fillForm('Sara Bauwens', 'Knee pain');
    const eventsBefore = (await db.pool.query('SELECT count(*)::int AS n FROM event')).rows[0].n;
    await db.pool.query('UPDATE clinic SET retention_days = 30');
    useClock('2026-12-15T10:00:00Z'); // 33 days after the 12 Nov visits, 26 after 19 Nov
    expect(await retention(db.pool)).toBe(2);
    const left = (await db.pool.query('SELECT patient_name, starts_at FROM appointment ORDER BY starts_at')).rows;
    expect(left.map((x) => x.patient_name)).toEqual(['Sara Bauwens']); // the 19 Nov visit is kept
    expect((await db.pool.query('SELECT count(*)::int AS n FROM form_answers')).rows[0].n).toBe(0);
    const eventsAfter = (await db.pool.query('SELECT count(*)::int AS n FROM event')).rows[0].n;
    expect(eventsAfter).toBe(eventsBefore + 1); // only the retention_run event was added
    expect((await db.pool.query("SELECT details FROM event WHERE type = 'retention_run'")).rows[0].details.visits_removed).toBe(2);
  });

  it('WR-22: the manager searches who opened a patient\'s answers, by patient or by staff member', async () => {
    const sara = await fillForm('Sara Bauwens', 'Knee pain');
    useClock('2026-11-12T12:00:00Z');
    const peeters = await h.login('peeters@test');
    await h.app.inject({ url: `/api/visits/${sara}/answers`, headers: { cookie: peeters } });
    const manager = await h.login('manager@test');
    const byPatient = (await h.app.inject({ url: `/api/manager/access-log?phone=${encodeURIComponent(SARA)}`, headers: { cookie: manager } })).json();
    expect(byPatient.entries).toEqual([{ at: '2026-11-12 13:00', staff: 'Dr. Peeters', role: 'professional', patient: 'Sara Bauwens' }]);
    const byStaff = (await h.app.inject({ url: `/api/manager/access-log?staffId=${db.staff.janssens}`, headers: { cookie: manager } })).json();
    expect(byStaff.entries).toEqual([]);
  });

  it('WR-31: T-07 erasure leaves 0 identifiable records, keeps the event count, and stops re-import and texts', async () => {
    await fillForm('Sara Bauwens', 'Knee pain since last week');
    const sara = await visitIdByName(db, 'Sara Bauwens');
    useClock('2026-11-12T08:00:00Z'); // 9:00, Sara's visit today is still only booked
    const peeters = await h.login('peeters@test');
    await h.app.inject({ url: `/api/visits/${sara}/answers`, headers: { cookie: peeters } });
    const manager = await h.login('manager@test');
    const found = (await h.app.inject({ method: 'POST', url: '/api/manager/patients/find', headers: { cookie: manager }, payload: { phone: SARA } })).json();
    expect(found.visits).toHaveLength(2);

    const wrong = await h.app.inject({ method: 'POST', url: '/api/manager/patients/erase', headers: { cookie: manager }, payload: { phone: SARA, last4: '9999' } });
    expect(wrong.statusCode).toBe(400);

    const eventsBefore = (await db.pool.query('SELECT count(*)::int AS n FROM event WHERE trail_id IS NOT NULL')).rows[0].n;
    const ok = await h.app.inject({ method: 'POST', url: '/api/manager/patients/erase', headers: { cookie: manager }, payload: { phone: SARA, last4: '2203' } });
    expect(ok.json()).toEqual({ erasedVisits: 2 });

    expect(await findAnywhere(['Sara', 'Bauwens', '470112203', '470 11 22 03', 'Knee pain'])).toEqual([]);
    const eventsAfter = (await db.pool.query('SELECT count(*)::int AS n FROM event WHERE trail_id IS NOT NULL')).rows[0].n;
    expect(eventsAfter).toBe(eventsBefore);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM event WHERE visit_id IS NOT NULL AND trail_id IN (SELECT trail_id FROM access_log)')).rows[0].n).toBe(0);
    expect((await h.app.inject({ url: `/api/visit/${visitToken(sara)}` })).statusCode).toBe(404);

    // No texts after erasure; a re-import of the original file skips both rows.
    useClock('2026-11-18T16:30:00Z');
    sentByFake.length = 0;
    await runDueJobs(db.pool);
    expect(sentByFake.filter((m) => m.to === SARA_E164)).toEqual([]);
    const re = await importRows(db, [
      ['Sara Bauwens', SARA, 'Dr. Peeters', '2026-11-12', '14:00'],
      ['Sara Bauwens', SARA, 'Dr. Janssens', '2026-11-19', '9:00'],
    ]);
    expect(re.skipped.map((s) => s.reason)).toEqual(['Erased on request', 'Erased on request']);
    const req = (await db.pool.query('SELECT kind, completed_at FROM data_request')).rows;
    expect(req).toMatchObject([{ kind: 'erasure' }]);
  });

  it("WR-31: a visit in progress today cannot be erased", async () => {
    useClock('2026-11-12T12:30:00Z');
    const reception = await h.login('reception@test');
    const sara = await visitIdByName(db, 'Sara Bauwens');
    await h.app.inject({ method: 'POST', url: `/api/reception/visits/${sara}/arrived`, headers: { cookie: reception } });
    const manager = await h.login('manager@test');
    const r = await h.app.inject({ method: 'POST', url: '/api/manager/patients/erase', headers: { cookie: manager }, payload: { phone: SARA, last4: '2203' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("Finish or cancel today's visit first");
  });

  it('WR-31: after a restore from backup, the erasure list is applied again before the service reopens', async () => {
    useClock('2026-11-11T17:00:00Z');
    const manager = await h.login('manager@test');
    await h.app.inject({ method: 'POST', url: '/api/manager/patients/erase', headers: { cookie: manager }, payload: { phone: SARA, last4: '2203' } });
    // Simulate a restore: the old rows come back from a backup taken before the erasure.
    await db.pool.query(
      `INSERT INTO appointment (professional_id, starts_at, patient_name, phone, source, source_key, created_at)
       VALUES ($1, '2026-11-12T13:00:00Z', 'Sara Bauwens', $2, 'file', 'restored', '2026-11-11T10:00:00Z')`,
      [db.staff.peeters, SARA_E164],
    );
    expect(await withTx((c) => reapplyErasures(c), db.pool)).toBe(1);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM appointment WHERE patient_name = 'Sara Bauwens'")).rows[0].n).toBe(0);
  });

  it('WR-32: export needs a text code, contains everything held for the patient and nothing about others', async () => {
    await fillForm('Sara Bauwens', 'Knee pain');
    await fillForm('Ben Kowalski', 'Blood pressure');
    useClock('2026-11-12T12:00:00Z');
    const manager = await h.login('manager@test');
    const noCode = await h.app.inject({ method: 'POST', url: '/api/manager/patients/export', headers: { cookie: manager }, payload: { phone: SARA, code: '0000' } });
    expect(noCode.statusCode).toBe(400);
    await h.app.inject({ method: 'POST', url: '/api/manager/patients/export-code', headers: { cookie: manager }, payload: { phone: SARA } });
    const code = sentByFake.at(-1)!.body.match(/is (\d{4})/)![1];
    expect(sentByFake.at(-1)!.to).toBe(SARA_E164);
    const json = await h.app.inject({ method: 'POST', url: '/api/manager/patients/export', headers: { cookie: manager }, payload: { phone: SARA, code } });
    const data = json.json();
    expect(data.visits).toHaveLength(2);
    expect(data.visits[0]).toMatchObject({ name: 'Sara Bauwens', professional: 'Dr. Peeters', form: { reason: 'Knee pain', medications: 'Ibuprofen' } });
    expect(data.visits[0].textsSent.map((t: any) => t.type)).toEqual(expect.arrayContaining(['confirmation', 'reminder']));
    expect(json.body).not.toMatch(/Ben|Kowalski|Blood pressure/);
    expect(json.headers['cache-control']).toBe('no-store');
    // The code is single-use; a PDF needs a fresh one.
    expect((await h.app.inject({ method: 'POST', url: '/api/manager/patients/export', headers: { cookie: manager }, payload: { phone: SARA, code } })).statusCode).toBe(400);
    await h.app.inject({ method: 'POST', url: '/api/manager/patients/export-code', headers: { cookie: manager }, payload: { phone: SARA } });
    const code2 = sentByFake.at(-1)!.body.match(/is (\d{4})/)![1];
    const pdf = await h.app.inject({ method: 'POST', url: '/api/manager/patients/export', headers: { cookie: manager }, payload: { phone: SARA, code: code2, format: 'pdf' } });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await db.pool.query("SELECT count(*)::int AS n FROM data_request WHERE kind = 'export'")).rows[0].n).toBe(2);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM event WHERE type = 'data_exported'")).rows[0].n).toBe(2);
  });

  it('logs carry route patterns, never visit tokens', async () => {
    const { buildApp } = await import('../../server/app.js');
    const { Writable } = await import('node:stream');
    const lines: string[] = [];
    const logStream = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
    const app = await buildApp({ db: db.pool, hub: h.hub }, { logger: true, logStream });
    const sara = await visitIdByName(db, 'Sara Bauwens');
    await app.inject({ url: `/api/visit/${visitToken(sara)}` });
    await app.close();
    const logged = lines.join('');
    expect(logged).toContain('/api/visit/:token');
    expect(logged).not.toContain(visitToken(sara));
  });
});
