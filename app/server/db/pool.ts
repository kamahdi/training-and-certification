import pg from 'pg';
import { config } from '../config.js';

// Return timestamps as Date and dates as 'YYYY-MM-DD' strings.
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool | pg.PoolClient;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  return pool;
}

export function setPool(p: pg.Pool | null) {
  pool = p;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

/** Run fn in one transaction. Nested calls with a client reuse it. */
export async function withTx<T>(fn: (c: pg.PoolClient) => Promise<T>, db: Db = getPool()): Promise<T> {
  if (!(db instanceof pg.Pool)) return fn(db as pg.PoolClient);
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
