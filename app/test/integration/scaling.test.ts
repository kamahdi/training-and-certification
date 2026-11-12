import { LOCKS, runIfLeader } from '../../server/db/lock.js';
import { createTestDb, type TestDb } from '../helpers.js';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

describe('ADR-006 · several app containers', () => {
  it('a timed task started in two containers at once runs in only one', async () => {
    let runs = 0;
    let release!: () => void;
    const slowTask = () => new Promise<void>((done) => { runs++; release = done; });
    const first = runIfLeader(db.pool, LOCKS.estimates, slowTask);
    await new Promise((r) => setTimeout(r, 50)); // the first container is mid-task
    const second = await runIfLeader(db.pool, LOCKS.estimates, async () => { runs++; });
    expect(second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(runs).toBe(1);
  });

  it('the lock is released after the task, even when it fails, so the next tick runs', async () => {
    await expect(runIfLeader(db.pool, LOCKS.retention, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await runIfLeader(db.pool, LOCKS.retention, async () => {})).toBe(true);
  });

  it('different timed tasks do not block each other', async () => {
    let release!: () => void;
    const first = runIfLeader(db.pool, LOCKS.estimates, () => new Promise<void>((done) => { release = done; }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await runIfLeader(db.pool, LOCKS.delayCheck, async () => {})).toBe(true);
    release();
    await first;
  });
});
