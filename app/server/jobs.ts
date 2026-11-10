import type { PoolClient } from 'pg';
import { clock } from './clock.js';
import type { Db } from './db/pool.js';
import { getPool } from './db/pool.js';

export async function enqueue(
  c: Db,
  kind: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; visitId?: string } = {},
): Promise<boolean> {
  const r = await c.query(
    `INSERT INTO job (kind, run_at, payload, dedupe_key, visit_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [kind, opts.runAt ?? clock.now(), payload, opts.dedupeKey ?? null, opts.visitId ?? null],
  );
  return r.rowCount === 1;
}

export type JobHandler = (payload: any, c: PoolClient) => Promise<void>;

const MAX_ATTEMPTS = 3;

/** Claim and run due jobs. Returns how many ran. Each job runs in its own transaction. */
export async function processJobs(handlers: Record<string, JobHandler>, limit = 50, db = getPool()): Promise<number> {
  let ran = 0;
  for (let i = 0; i < limit; i++) {
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(
        `SELECT * FROM job WHERE status = 'pending' AND run_at <= $1
         ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [clock.now()],
      );
      const job = r.rows[0];
      if (!job) {
        await c.query('COMMIT');
        break;
      }
      const handler = handlers[job.kind];
      try {
        if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
        await c.query('SAVEPOINT job');
        await handler(job.payload, c);
        await c.query("UPDATE job SET status = 'done', attempts = attempts + 1 WHERE id = $1", [job.id]);
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT job');
        const attempts = job.attempts + 1;
        await c.query(
          `UPDATE job SET attempts = $2, last_error = $3,
             status = CASE WHEN $2 >= $4 THEN 'failed' ELSE 'pending' END,
             run_at = $5 WHERE id = $1`,
          [job.id, attempts, String((e as Error).message).slice(0, 500), MAX_ATTEMPTS, new Date(clock.now().getTime() + 30_000 * attempts)],
        );
      }
      await c.query('COMMIT');
      ran++;
    } finally {
      c.release();
    }
  }
  return ran;
}

export async function cancelJobsForVisits(c: Db, visitIds: string[]) {
  if (!visitIds.length) return;
  await c.query("UPDATE job SET status = 'cancelled' WHERE status = 'pending' AND visit_id = ANY($1)", [visitIds]);
}
