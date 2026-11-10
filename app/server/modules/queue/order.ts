/**
 * WR-12 / WR-13 queue order, as a pure function:
 *  1. patients coming from emergency, by arrival time;
 *  2. booked patients whose appointment time has passed, by appointment time;
 *  3. walk-ins, by arrival time (placed in the "gap", per qa/test-strategy.md › Gaps);
 *  4. booked patients whose appointment time has not come yet, by appointment time.
 * Arriving early never moves a patient up. A skipped patient goes back right after
 * the person who was next when they were skipped (WR-16), while that person still waits.
 */
export interface QueueItem {
  visitId: string;
  kind: 'booked' | 'walk_in';
  startsAt: Date | null;
  arrivedAt: Date;
  emergency: boolean;
  requeueAfter?: string | null;
}

function group(i: QueueItem, now: Date): number {
  if (i.emergency) return 0;
  if (i.kind === 'walk_in' || !i.startsAt) return 2;
  return i.startsAt.getTime() <= now.getTime() ? 1 : 3;
}

function key(i: QueueItem): number {
  if (i.emergency || i.kind === 'walk_in' || !i.startsAt) return i.arrivedAt.getTime();
  return i.startsAt.getTime();
}

export function orderQueue<T extends QueueItem>(items: T[], now: Date): T[] {
  const sorted = [...items].sort((a, b) => {
    const g = group(a, now) - group(b, now);
    if (g) return g;
    const k = key(a) - key(b);
    if (k) return k;
    return a.arrivedAt.getTime() - b.arrivedAt.getTime() || a.visitId.localeCompare(b.visitId);
  });
  // Apply skips: move a skipped patient right after the visit they were requeued behind.
  const skipped = sorted.filter((i) => i.requeueAfter && !i.emergency && sorted.some((o) => o.visitId === i.requeueAfter));
  let out = sorted.filter((i) => !skipped.includes(i));
  for (const s of skipped) {
    const at = out.findIndex((o) => o.visitId === s.requeueAfter);
    out = [...out.slice(0, at + 1), s, ...out.slice(at + 1)];
  }
  return out;
}
