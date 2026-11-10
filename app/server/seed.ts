import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './crypto.js';
import { closePool, getPool, withTx } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { importAppointments } from './modules/appointments/import.js';

/**
 * Demo data: clinic settings, staff accounts and the demo appointments file.
 * Synthetic data only (qa/test-strategy.md › Time, test data and fakes).
 * Usage: npm run seed            (staff + settings)
 *        npm run seed -- --demo  (also imports fixtures/demo-appointments.csv, dated today)
 */
export async function seed(db = getPool()) {
  await db.query(
    `INSERT INTO clinic (id, name, address) VALUES (1, 'Demo Clinic', 'Rue de la Démo 1, 1000 Brussels')
     ON CONFLICT (id) DO NOTHING`,
  );
  const staff = [
    ['Dr. Peeters', 'peeters@demo.clinic', 'professional', '3'],
    ['Dr. Janssens', 'janssens@demo.clinic', 'professional', '5'],
    ['Reception', 'reception@demo.clinic', 'reception', null],
    ['Clinic manager', 'manager@demo.clinic', 'manager', null],
  ];
  for (const [name, email, role, room] of staff) {
    await db.query(
      `INSERT INTO staff_user (name, email, role, room, password_hash) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
      [name, email, role, room, hashPassword('demo-password')],
    );
  }
}

async function main() {
  await migrate();
  const db = getPool();
  await seed(db);
  if (process.argv.includes('--demo')) {
    const here = dirname(fileURLToPath(import.meta.url));
    const csv = (await readFile(join(here, '../fixtures/demo-appointments.csv'), 'utf8')).replaceAll('{today}', new Date().toISOString().slice(0, 10));
    const res = await withTx((c) => importAppointments(c, csv, 'seed'), db);
    console.log('demo appointments:', res);
  }
  console.log('seeded. Staff password for every demo account: demo-password');
  await closePool();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
