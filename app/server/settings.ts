import type { Db } from './db/pool.js';

export interface ClinicSettings {
  name: string;
  address: string;
  time_zone: string;
  default_language: string;
  retention_days: number;
  link_window_hours: number;
  checkin_open_minutes: number;
  estimate_before_min: number;
  estimate_after_min: number;
  default_consult_min: number;
  delay_threshold_min: number;
  idle_lock_minutes: number;
}

export async function getClinic(db: Db): Promise<ClinicSettings> {
  const r = await db.query('SELECT * FROM clinic WHERE id = 1');
  if (!r.rows[0]) throw new Error('Clinic settings missing: run the seed script');
  return r.rows[0];
}
