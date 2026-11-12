import { buildApp } from './app.js';
import { config } from './config.js';
import { getPool, withTx } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { Hub } from './live/hub.js';
import { reapplyErasures } from './modules/privacy/rights.js';
import { startWorker } from './worker/index.js';

/**
 * The application (ADR-001, ADR-006). One process, and so one container, runs the web server and the
 * background worker; ROLE=web or ROLE=worker runs only one of them.
 */
async function main() {
  const role = config.role;
  await migrate();
  const db = getPool();
  // WR-31: after a restore from backup, erasures are applied again before the service opens.
  const removed = await withTx((c) => reapplyErasures(c), db);
  if (removed) console.log(`re-applied erasures: ${removed} appointment(s) removed`);

  const stopWorker = role === 'web' ? () => {} : startWorker(db);
  let closeWeb = async () => {};
  if (role !== 'worker') {
    const hub = new Hub(db);
    await hub.start();
    const app = await buildApp({ db, hub }, { logger: true });
    await app.listen({ port: config.port, host: '0.0.0.0' });
    closeWeb = async () => {
      await app.close();
      await hub.stop();
    };
  }
  console.log(`clinic waiting room running (ROLE=${role})`);

  const stop = async () => {
    stopWorker();
    await closeWeb();
    await db.end();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
