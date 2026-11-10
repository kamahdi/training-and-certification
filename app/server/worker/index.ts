import { closePool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { delayCheck, refreshAllEstimates, retention, runDueJobs } from './tasks.js';

/** The background worker (ADR-003): jobs every 2 s, estimates every minute, delay check every 5 minutes, retention daily. */
function every(ms: number, name: string, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`${name} failed:`, (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

async function main() {
  await migrate();
  const timers = [
    every(2_000, 'jobs', runDueJobs),
    every(60_000, 'estimates', refreshAllEstimates),
    every(5 * 60_000, 'delay check', delayCheck),
    every(24 * 3600_000, 'retention', retention),
  ];
  console.log('worker running');
  const stop = async () => {
    timers.forEach(clearInterval);
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
