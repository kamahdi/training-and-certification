import type { Db } from '../../db/pool.js';
import { clock } from '../../clock.js';
import { hash, newToken, verifyPassword } from '../../crypto.js';
import { getClinic } from '../../settings.js';

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'professional' | 'reception' | 'manager';
  room: string | null;
}

/** WR-11: each staff member signs in with their own account. */
export async function login(db: Db, email: string, password: string): Promise<{ token: string; staff: Staff } | null> {
  const r = await db.query('SELECT * FROM staff_user WHERE lower(email) = lower($1) AND active', [email.trim()]);
  const u = r.rows[0];
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  const token = newToken();
  const now = clock.now();
  await db.query('INSERT INTO staff_session (token_hash, staff_user_id, created_at, last_seen_at) VALUES ($1, $2, $3, $3)', [hash(token), u.id, now]);
  return { token, staff: { id: u.id, name: u.name, email: u.email, role: u.role, room: u.room } };
}

export type SessionCheck = { ok: true; staff: Staff } | { ok: false; locked: boolean };

/** WR-11: the screen locks after N minutes without activity and needs the password again. */
export async function checkSession(db: Db, token: string | undefined, touch = true): Promise<SessionCheck> {
  if (!token) return { ok: false, locked: false };
  const r = await db.query(
    `SELECT s.*, u.name, u.email, u.role, u.room, u.active FROM staff_session s JOIN staff_user u ON u.id = s.staff_user_id WHERE s.token_hash = $1`,
    [hash(token)],
  );
  const s = r.rows[0];
  if (!s || !s.active) return { ok: false, locked: false };
  const clinic = await getClinic(db);
  const now = clock.now();
  if (s.locked || now.getTime() - s.last_seen_at.getTime() > clinic.idle_lock_minutes * 60000) {
    if (!s.locked) await db.query('UPDATE staff_session SET locked = true WHERE token_hash = $1', [hash(token)]);
    return { ok: false, locked: true };
  }
  if (touch) await db.query('UPDATE staff_session SET last_seen_at = $2 WHERE token_hash = $1', [hash(token), now]);
  return { ok: true, staff: { id: s.staff_user_id, name: s.name, email: s.email, role: s.role, room: s.room } };
}

/** WR-11: signing out on one PC does not affect another (only this session is removed). */
export async function logout(db: Db, token: string | undefined) {
  if (token) await db.query('DELETE FROM staff_session WHERE token_hash = $1', [hash(token)]);
}

/** Session ages for the live stream's lock check, without counting as activity. */
export async function sessionIdleMs(db: Db, token: string): Promise<number | null> {
  const r = await db.query('SELECT last_seen_at, locked FROM staff_session WHERE token_hash = $1', [hash(token)]);
  if (!r.rows[0] || r.rows[0].locked) return null;
  return clock.now().getTime() - r.rows[0].last_seen_at.getTime();
}
