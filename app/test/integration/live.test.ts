import { setClock } from '../../server/clock.js';
import { withTx } from '../../server/db/pool.js';
import { checkIn } from '../../server/modules/visits/checkin.js';
import { createTestDb, importRows, makeApp, resetFakes, useClock, visitIdByName, visitToken, type TestDb } from '../helpers.js';

let db: TestDb;
let h: Awaited<ReturnType<typeof makeApp>>;
let base: string;
const day = '2026-11-12';

/** Minimal SSE reader over fetch. */
function openStream(url: string, cookie?: string) {
  const events: { event: string; data: any; at: number }[] = [];
  const ctrl = new AbortController();
  const ready = fetch(url, { headers: cookie ? { cookie } : {}, signal: ctrl.signal }).then(async (res) => {
    if (res.status !== 200) throw new Error(`stream status ${res.status}`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = chunk.match(/^event: (.+)$/m)?.[1];
            const data = chunk.match(/^data: (.+)$/m)?.[1];
            if (ev && data) events.push({ event: ev, data: JSON.parse(data), at: Date.now() });
          }
        }
      } catch {
        /* aborted */
      }
    })();
    return res;
  });
  return {
    events,
    ready,
    close: () => ctrl.abort(),
    async waitFor(pred: (e: { event: string; data: any }) => boolean, ms = 3000) {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const hit = events.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`no matching event within ${ms} ms; got ${events.map((e) => e.event).join(', ')}`);
    },
  };
}

beforeAll(async () => {
  db = await createTestDb();
  h = await makeApp(db, { startHub: true });
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = h.app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  setClock(null);
  await h.close();
  await db.close();
});

beforeEach(async () => {
  resetFakes();
  await db.pool.query('TRUNCATE appointment, event, job, message, queue_version CASCADE');
  useClock('2026-11-11T10:00:00Z');
  await importRows(db, [
    ['Ana Verbeke', '0470 11 22 01', 'Dr. Peeters', day, '10:00'],
    ['Ben Kowalski', '0470 11 22 02', 'Dr. Peeters', day, '9:45'],
  ]);
  useClock('2026-11-12T09:06:00Z');
  for (const n of ['Ana Verbeke', 'Ben Kowalski']) {
    const id = await visitIdByName(db, n);
    await withTx((c) => checkIn(c, id, 'reception', 'test'), db.pool);
  }
  await db.pool.query("UPDATE form_answers SET reason_enc = NULL"); // none yet
});

describe('ADR-002 · live updates', () => {
  it('WR-12 / WR-17: a call reaches two staff screens and the patient page within 1 second', async () => {
    const peeters = await h.login('peeters@test');
    const reception = await h.login('reception@test');
    const ana = await visitIdByName(db, 'Ana Verbeke');
    const s1 = openStream(`${base}/api/stream/staff?professionalId=${db.staff.peeters}`, peeters);
    const s2 = openStream(`${base}/api/stream/staff?professionalId=${db.staff.peeters}`, reception);
    const p = openStream(`${base}/api/stream/visit/${visitToken(ana)}`);
    await Promise.all([s1.ready, s2.ready, p.ready]);
    const first = await s1.waitFor((e) => e.event === 'queue.updated');
    expect(first.data.patients.map((x: any) => x.name)).toEqual(['Ben Kowalski', 'Ana Verbeke']);
    await p.waitFor((e) => e.event === 'estimate.updated' && e.data.state === 'not_started');

    const sent = Date.now();
    const r = await fetch(`${base}/api/calls`, {
      method: 'POST',
      headers: { cookie: peeters, 'content-type': 'application/json' },
      body: JSON.stringify({ professionalId: db.staff.peeters, version: first.data.version }),
    });
    expect(r.status).toBe(200);
    const u1 = await s1.waitFor((e) => e.event === 'queue.updated' && e.data.patients.length === 1);
    const u2 = await s2.waitFor((e) => e.event === 'queue.updated' && e.data.patients.length === 1);
    const pu = await p.waitFor((e) => e.event === 'estimate.updated' && e.data.state === 'waiting');
    for (const e of [u1, u2, pu]) expect((e as any).at - sent).toBeLessThan(1000);
    s1.close(); s2.close(); p.close();
  });

  it('WR-06: no patient-stream message ever carries a reason for visit or another patient\'s name', async () => {
    const ana = await visitIdByName(db, 'Ana Verbeke');
    const ben = await visitIdByName(db, 'Ben Kowalski');
    await db.pool.query("INSERT INTO form_answers (visit_id, reason_enc, consent_at, updated_at, submitted_at) VALUES ($1, NULL, now(), now(), now())", [ben]);
    const peeters = await h.login('peeters@test');
    const p = openStream(`${base}/api/stream/visit/${visitToken(ana)}`);
    await p.ready;
    const v = (await (await fetch(`${base}/api/queue/${db.staff.peeters}`, { headers: { cookie: peeters } })).json()).version;
    await fetch(`${base}/api/visits/${ben}/emergency`, { method: 'POST', headers: { cookie: peeters, 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
    await fetch(`${base}/api/calls`, { method: 'POST', headers: { cookie: peeters, 'content-type': 'application/json' }, body: JSON.stringify({ professionalId: db.staff.peeters, version: v + 1 }) });
    await p.waitFor((e) => e.event === 'estimate.updated' && e.data.state === 'waiting');
    const all = JSON.stringify(p.events);
    expect(all).not.toMatch(/Ben|Kowalski|reason|emergency/);
    p.close();
  });

  it('a professional cannot open another professional\'s stream; an unknown visit token gives 404', async () => {
    const peeters = await h.login('peeters@test');
    expect((await fetch(`${base}/api/stream/staff?professionalId=${db.staff.janssens}`, { headers: { cookie: peeters } })).status).toBe(403);
    expect((await fetch(`${base}/api/stream/visit/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  it('dropping the LISTEN connection leads to a reconnect and fresh snapshots on every open stream', async () => {
    const peeters = await h.login('peeters@test');
    const s = openStream(`${base}/api/stream/staff?professionalId=${db.staff.peeters}`, peeters);
    await s.ready;
    await s.waitFor((e) => e.event === 'queue.updated');
    const before = s.events.length;
    await h.hub.listener.simulateDrop();
    await s.waitFor(() => s.events.length > before, 4000); // fresh snapshot after reconnect (backoff 1 s)
    // and notifications flow again
    const ben = await visitIdByName(db, 'Ben Kowalski');
    const n = s.events.length;
    await fetch(`${base}/api/visits/${ben}/emergency`, { method: 'POST', headers: { cookie: peeters, 'content-type': 'application/json' }, body: JSON.stringify({ on: true }) });
    await s.waitFor(() => s.events.length > n && s.events.at(-1)!.data.patients?.[0]?.emergency === true, 3000);
    s.close();
  });
});
