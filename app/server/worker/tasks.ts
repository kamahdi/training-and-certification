import { localDate } from '../../shared/time.js';
import { clock } from '../clock.js';
import { getPool, withTx } from '../db/pool.js';
import { write } from '../events.js';
import { processJobs, type JobHandler } from '../jobs.js';
import { getClinic } from '../settings.js';
import { sendReminderJob } from '../modules/appointments/reminder.js';
import { runDelayCheck } from '../modules/estimates/delay.js';
import { sendMessageJob } from '../modules/messaging/messages.js';
import { runRetention } from '../modules/privacy/retention.js';
import { refreshEstimates } from '../modules/queue/queue.js';

export const handlers: Record<string, JobHandler> = {
  send_message: sendMessageJob,
  send_reminder: sendReminderJob,
};

export async function runDueJobs(db = getPool()) {
  return processJobs(handlers, 100, db);
}

/** Every minute: estimates move with time even when nothing is clicked (WR-17, WR-18). */
export async function refreshAllEstimates(db = getPool()) {
  return withTx(async (c) => {
    const clinic = await getClinic(c);
    const now = clock.now();
    const day = localDate(now, clinic.time_zone);
    const pros = (await c.query("SELECT DISTINCT professional_id FROM visit WHERE day = $1 AND status = 'arrived'", [day])).rows;
    let changed = 0;
    for (const p of pros) {
      const ids = await refreshEstimates(c, p.professional_id, day, now, clinic);
      if (ids.length) {
        await write(c, { type: 'estimates_refreshed', actor: 'worker', professionalId: p.professional_id, notifyVisits: ids });
        changed += ids.length;
      }
    }
    return changed;
  }, db);
}

export async function delayCheck(db = getPool()) {
  return withTx((c) => runDelayCheck(c), db);
}

export async function retention(db = getPool()) {
  return withTx((c) => runRetention(c), db);
}
