import { fileURLToPath } from 'node:url';
import { LOCKS, runIfLeader } from '../db/lock.js';
import { closePool, getPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { delayCheck, refreshAllEstimates, retention, runDueJobs } from './tasks.js';

/**
 * The background worker (ADR-003, ADR-006): jobs every 2 s, estimates every minute, delay check every
 * 5 minutes, retention daily. It runs inside the app container by default (ROLE=all); this file also
 * starts it on its own (ROLE=worker, or `npm run start:worker`).
 *
 * Jobs are claimed with SKIP LOCKED, so every container can process them. The timed tasks run in one
 * container at a time, whichever holds their advisory lock.
 */
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

export function startWorker(db = getPool()): () => void {
  const timers = [
    every(2_000, 'jobs', () => runDueJobs(db)),
    every(60_000, 'estimates', () => runIfLeader(db, LOCKS.estimates, () => refreshAllEstimates(db))),
    every(5 * 60_000, 'delay check', () => runIfLeader(db, LOCKS.delayCheck, () => delayCheck(db))),
    every(24 * 3600_000, 'retention', () => runIfLeader(db, LOCKS.retention, () => retention(db))),
  ];
  console.log('worker running');
  return () => timers.forEach(clearInterval);
}

async function main() {
  await migrate();
  const stopWorker = startWorker();
  const stop = async () => {
    stopWorker();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
