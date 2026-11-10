import { localDate } from '../../shared/time.js';
import type { QueueUpdated, VisitView } from '../../shared/live-events.js';
import { clock } from '../clock.js';
import type { Db } from '../db/pool.js';
import { getClinic } from '../settings.js';
import { professionalLateness } from '../modules/estimates/delay.js';
import { callTimesToday, queueSnapshot } from '../modules/queue/queue.js';
import { patientView } from '../modules/visits/patientView.js';
import { getVisit } from '../modules/visits/visits.js';

/** The staff stream's whole payload for one professional's queue today. */
export async function staffSnapshot(db: Db, professionalId: string): Promise<QueueUpdated> {
  const clinic = await getClinic(db);
  const now = clock.now();
  const day = localDate(now, clinic.time_zone);
  const snap = await queueSnapshot(db, professionalId, day, now, clinic.time_zone);
  const lateness = await professionalLateness(db as any, professionalId, day);
  const started = (await callTimesToday(db, professionalId, day)).length > 0;
  return { ...snap, lateness, started };
}

/** The patient stream's whole payload for one visit. */
export async function visitSnapshot(db: Db, visitId: string): Promise<VisitView> {
  const clinic = await getClinic(db);
  const v = await getVisit(db, visitId);
  if (!v) return { state: 'ended' };
  return patientView(db, v, clinic);
}
