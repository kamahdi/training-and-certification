import { buildApp } from '../../server/app.js';
import { setClock } from '../../server/clock.js';
import { withTx } from '../../server/db/pool.js';
import { Hub } from '../../server/live/hub.js';
import { setFakeFailure, sentByFake } from '../../server/modules/messaging/provider.js';
import { runDueJobs } from '../../server/worker/tasks.js';
import { createTestDb, importRows, resetFakes, useClock, visitIdByName, type TestDb } from '../helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  setClock(null);
  await db.close();
});
beforeEach(async () => {
  resetFakes();
  await db.pool.query('TRUNCATE appointment, event, job, message, erasure_list CASCADE');
});

const day = '2026-11-12';

describe('Epic 1 · appointments and visit link', () => {
  it('WR-01: each valid row becomes an appointment and the result says how many were imported', async () => {
    useClock('2026-11-10T10:00:00Z');
    const res = await importRows(db, [
      ['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30'],
      ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
      ['Bad Number', '0470 11', 'Dr. Peeters', day, '9:50'],
      ['Who', '0470 11 22 09', 'Dr. Nobody', day, '9:55'],
    ]);
    expect(res.imported).toBe(2);
    expect(res.skipped).toEqual([
      { row: 4, reason: 'Invalid phone number' },
      { row: 5, reason: 'Unknown professional "Dr. Nobody"' },
    ]);
    const phones = (await db.pool.query('SELECT phone FROM appointment ORDER BY patient_name')).rows.map((r) => r.phone);
    expect(phones).toEqual(['+32470112201', '+32470112202']);
  });

  it('WR-01: uploading the same file twice creates no duplicates', async () => {
    useClock('2026-11-10T10:00:00Z');
    const rows = [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']];
    await importRows(db, rows);
    const again = await importRows(db, rows);
    expect(again).toMatchObject({ imported: 0, duplicates: 1 });
    expect((await db.pool.query('SELECT count(*)::int AS n FROM appointment')).rows[0].n).toBe(1);
  });

  it('WR-01: a row missing from a re-import of the same day counts as cancelled, and its texts stop', async () => {
    useClock('2026-11-10T10:00:00Z');
    await importRows(db, [
      ['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30'],
      ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
    ]);
    const res = await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    expect(res.cancelled).toBe(1);
    const ben = await visitIdByName(db, 'Ben Kowalski');
    expect((await db.pool.query('SELECT status FROM visit WHERE id = $1', [ben])).rows[0].status).toBe('cancelled');
    expect((await db.pool.query("SELECT count(*)::int AS n FROM job WHERE visit_id = $1 AND status = 'pending'", [ben])).rows[0].n).toBe(0);
  });

  it('WR-03: a confirmation goes out within 1 minute of the import, with no reason for visit, and only once', async () => {
    useClock('2026-11-10T10:00:00Z');
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    await runDueJobs(db.pool);
    expect(sentByFake).toHaveLength(1);
    expect(sentByFake[0].to).toBe('+32470112201');
    expect(sentByFake[0].body).toMatch(/Test Clinic: your appointment with Dr\. Peeters is on Thursday 12 November at 9:30/);
    expect(sentByFake[0].body).toMatch(/\/v\/[A-Za-z0-9_-]{22}/);
    const stored = (await db.pool.query('SELECT body FROM message')).rows[0].body;
    expect(stored).toContain('[visit link]'); // the database never holds a usable link
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    await runDueJobs(db.pool);
    expect(sentByFake).toHaveLength(1);
  });

  it('WR-03: a failed send is shown to reception with the patient name and the reason', async () => {
    useClock('2026-11-10T10:00:00Z');
    setFakeFailure((to) => (to.endsWith('01') ? 'Number does not exist' : null));
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    await runDueJobs(db.pool);
    const hub = new Hub(db.pool, db.url);
    const app = await buildApp({ db: db.pool, hub });
    useClock('2026-11-12T08:00:00Z');
    const login = await app.inject({ method: 'POST', url: '/api/staff/login', payload: { email: 'reception@test', password: 'pw' } });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const failed = await app.inject({ url: '/api/reception/failed-texts', headers: { cookie } });
    expect(failed.json().failed[0]).toMatchObject({ name: 'Ana Verbeke', template: 'confirmation', reason: 'Number does not exist', phone: '+32 470 •• •• 01' });
    await app.close();
  });

  it('WR-04: the reminder goes out between 17:00 and 19:00 the day before, with the form link', async () => {
    useClock('2026-11-10T10:00:00Z');
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    await runDueJobs(db.pool);
    sentByFake.length = 0;
    const clock = useClock('2026-11-11T15:59:00Z'); // 16:59 Brussels
    await runDueJobs(db.pool);
    expect(sentByFake).toHaveLength(0);
    clock.set('2026-11-11T16:00:00Z'); // 17:00 Brussels
    await runDueJobs(db.pool);
    await runDueJobs(db.pool);
    expect(sentByFake).toHaveLength(1);
    expect(sentByFake[0].body).toMatch(/tomorrow at 9:30.*\/f\/[A-Za-z0-9_-]{22}/);
  });

  it('WR-04: no reminder for a same-day booking or for an appointment removed before 17:00', async () => {
    useClock('2026-11-12T07:00:00Z');
    await importRows(db, [['Sam Same', '0470 11 22 08', 'Dr. Peeters', day, '15:00']]);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM job WHERE kind = 'send_reminder'")).rows[0].n).toBe(0);
    await runDueJobs(db.pool);
    expect(sentByFake[0].body).toMatch(/today at 15:00.*\/f\//); // same-day confirmation carries the form link instead

    await db.pool.query('TRUNCATE appointment, job, message CASCADE');
    useClock('2026-11-11T10:00:00Z');
    await importRows(db, [
      ['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30'],
      ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
    ]);
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]); // Ben removed
    sentByFake.length = 0;
    useClock('2026-11-11T16:30:00Z');
    await runDueJobs(db.pool);
    await runDueJobs(db.pool);
    const reminders = sentByFake.filter((m) => /reminder/.test(m.body));
    expect(reminders.map((m) => m.to)).toEqual(['+32470112201']);
  });

  it('WR-04: if the form is already done, the reminder leaves out the form request', async () => {
    useClock('2026-11-10T10:00:00Z');
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    const id = await visitIdByName(db, 'Ana Verbeke');
    await db.pool.query("INSERT INTO form_answers (visit_id, consent_at, updated_at, submitted_at) VALUES ($1, now(), now(), now())", [id]);
    sentByFake.length = 0;
    useClock('2026-11-11T16:10:00Z');
    await runDueJobs(db.pool);
    await runDueJobs(db.pool);
    const reminder = sentByFake.find((m) => /reminder/.test(m.body))!;
    expect(reminder.body).toMatch(/Thank you for filling in the form/);
    expect(reminder.body).not.toMatch(/\/f\//);
  });

  it('WR-20: the import, the texts and the reminder each write a timestamped event', async () => {
    useClock('2026-11-10T10:00:00Z');
    await importRows(db, [['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '9:30']]);
    await runDueJobs(db.pool);
    const types = (await db.pool.query('SELECT type FROM event ORDER BY id')).rows.map((r) => r.type);
    expect(types).toEqual(['appointment_imported', 'import_completed', 'message_sent', 'message_delivered']);
    await withTx(async (c) => {
      const r = await c.query('SELECT at FROM event');
      expect(r.rows.every((x) => x.at instanceof Date)).toBe(true);
    }, db.pool);
  });
});
