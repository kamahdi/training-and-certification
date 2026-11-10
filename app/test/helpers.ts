import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { fixedClock, setClock } from '../server/clock.js';
import { hashPassword } from '../server/crypto.js';
import { migrate } from '../server/db/migrate.js';
import { setPool, withTx } from '../server/db/pool.js';
import { setFakeFailure, sentByFake } from '../server/modules/messaging/provider.js';
import { importAppointments } from '../server/modules/appointments/import.js';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://clinic:clinic@localhost:5432/postgres';

export interface TestDb {
  pool: pg.Pool;
  url: string;
  staff: { peeters: string; janssens: string; reception: string; manager: string };
  close(): Promise<void>;
}

/** A fresh database per test file, migrated and seeded with synthetic staff. */
export async function createTestDb(): Promise<TestDb> {
  const name = `clinic_test_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${name}`);
  await migrate(url);
  const pool = new pg.Pool({ connectionString: url, max: 8 });
  setPool(pool);
  await pool.query("INSERT INTO clinic (id, name, address) VALUES (1, 'Test Clinic', 'Test street 1')");
  const pw = hashPassword('pw');
  const ins = async (n: string, e: string, role: string, room: string | null) =>
    (await pool.query('INSERT INTO staff_user (name, email, role, room, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id', [n, e, role, room, pw])).rows[0].id;
  const staff = {
    peeters: await ins('Dr. Peeters', 'peeters@test', 'professional', '3'),
    janssens: await ins('Dr. Janssens', 'janssens@test', 'professional', '5'),
    reception: await ins('Reception', 'reception@test', 'reception', null),
    manager: await ins('Manager', 'manager@test', 'manager', null),
  };
  return {
    pool,
    url,
    staff,
    async close() {
      await pool.end();
      setPool(null);
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** Freeze time at a Brussels-local instant, e.g. at('2026-11-12', '10:06'). */
export function useClock(isoUtc: string) {
  const c = fixedClock(isoUtc);
  setClock(c);
  return c;
}

export function resetFakes() {
  sentByFake.length = 0;
  setFakeFailure(null);
}

export function csv(rows: string[][]) {
  return ['patient name,phone number,professional,date,time', ...rows.map((r) => r.join(','))].join('\n');
}

export async function importRows(db: TestDb, rows: string[][]) {
  return withTx((c) => importAppointments(c, csv(rows), 'test'), db.pool);
}

export async function visitIdByName(db: TestDb, name: string): Promise<string> {
  const r = await db.pool.query('SELECT v.id FROM visit v JOIN appointment a ON a.id = v.appointment_id WHERE a.patient_name = $1 ORDER BY a.starts_at NULLS LAST', [name]);
  return r.rows[0].id;
}

import { buildApp } from '../server/app.js';
import { Hub } from '../server/live/hub.js';
import { linkToken } from '../server/crypto.js';

/** A Fastify app on the test database, with sign-in helpers. Call close() when done. */
export async function makeApp(db: TestDb, opts: { startHub?: boolean } = {}) {
  const hub = new Hub(db.pool, db.url);
  if (opts.startHub) await hub.start();
  const app = await buildApp({ db: db.pool, hub });
  async function login(email: string) {
    const r = await app.inject({ method: 'POST', url: '/api/staff/login', payload: { email, password: 'pw' } });
    if (r.statusCode !== 200) throw new Error(`login failed: ${r.body}`);
    return r.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }
  return {
    app,
    hub,
    login,
    async close() {
      await app.close();
      await hub.stop();
    },
  };
}

export const visitToken = (visitId: string) => linkToken(visitId, 'visit');
export const formToken = (visitId: string) => linkToken(visitId, 'form');
