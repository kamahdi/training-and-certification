import { buildApp } from './app.js';
import { config } from './config.js';
import { getPool, withTx } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { Hub } from './live/hub.js';
import { reapplyErasures } from './modules/privacy/rights.js';

async function main() {
  await migrate();
  const db = getPool();
  // WR-31: after a restore from backup, erasures are applied again before the service opens.
  const removed = await withTx((c) => reapplyErasures(c), db);
  if (removed) console.log(`re-applied erasures: ${removed} appointment(s) removed`);
  const hub = new Hub(db);
  await hub.start();
  const app = await buildApp({ db, hub }, { logger: true });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  const stop = async () => {
    await app.close();
    await hub.stop();
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
