import type pg from 'pg';

/**
 * ADR-006: run `fn` only if this process gets the Postgres advisory lock `key`; otherwise skip it.
 * With several app containers, each timed task (estimates, delay check, retention) then runs in one
 * container at a time. Returns whether this process ran it. The lock ends with the session, so a
 * crashed container never holds it.
 */
export async function runIfLeader(db: pg.Pool, key: number, fn: () => Promise<unknown>): Promise<boolean> {
  const client = await db.connect();
  try {
    const got = (await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [key])).rows[0].ok;
    if (!got) return false;
    try {
      await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
    return true;
  } finally {
    client.release();
  }
}

/** Advisory lock keys, one per timed task (migrations use 72_011_001). */
export const LOCKS = {
  estimates: 72_011_010,
  delayCheck: 72_011_011,
  retention: 72_011_012,
} as const;
