import type { PoolClient } from 'pg';
import { clock } from '../../clock.js';
import { write } from '../../events.js';
import { getClinic } from '../../settings.js';

/**
 * WR-21, daily: delete names, phone numbers and form answers older than the retention period.
 * Events stay, keyed by trail_id only, so statistics keep working without identifying anyone.
 */
export async function runRetention(c: PoolClient): Promise<number> {
  const clinic = await getClinic(c);
  const cutoff = new Date(clock.now().getTime() - clinic.retention_days * 86400_000);
  const old = await c.query(
    `SELECT a.id FROM appointment a JOIN visit v ON v.appointment_id = a.id
      WHERE COALESCE(a.starts_at, a.created_at) < $1`,
    [cutoff],
  );
  const ids = old.rows.map((r) => r.id);
  if (ids.length) {
    await c.query('DELETE FROM appointment WHERE id = ANY($1)', [ids]); // cascades to visit, form answers, messages, phones
  }
  await c.query('DELETE FROM text_code WHERE expires_at < $1', [new Date(clock.now().getTime() - 3600_000)]);
  await write(c, { type: 'retention_run', actor: 'worker', details: { visits_removed: ids.length, retention_days: clinic.retention_days } });
  return ids.length;
}
