import { floorTo5, roundTo5 } from '../../../shared/time.js';

/**
 * WR-17: average consultation length = mean gap between the professional's last calls today
 * (up to 5 gaps). With fewer than 2 calls there is no gap yet, so the clinic default is used.
 */
export function averageConsultMinutes(callTimes: Date[], defaultMinutes: number): number {
  const times = [...callTimes].map((d) => d.getTime()).sort((a, b) => a - b).slice(-6);
  if (times.length < 2) return defaultMinutes;
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
  return sum / (times.length - 1) / 60000;
}

export interface Range {
  estimate: Date;
  from: Date;
  to: Date;
}

/** WR-17: estimate = now + patients ahead × average; shown as a range rounded to 5 minutes. */
export function estimateRange(
  now: Date,
  patientsAhead: number,
  avgMinutes: number,
  settings: { estimate_before_min: number; estimate_after_min: number },
): Range {
  const estimate = new Date(now.getTime() + patientsAhead * avgMinutes * 60000);
  let from = roundTo5(new Date(estimate.getTime() - settings.estimate_before_min * 60000));
  const to = roundTo5(new Date(estimate.getTime() + settings.estimate_after_min * 60000));
  if (from.getTime() < floorTo5(now).getTime()) from = floorTo5(now);
  return { estimate, from, to };
}

/** WR-18: a slip is the end of the range moving 10 minutes or more later. */
export function isSlip(previousTo: Date | null, nextTo: Date): boolean {
  return !!previousTo && nextTo.getTime() - previousTo.getTime() >= 10 * 60000;
}

/** WR-19: lateness = average gap between appointment time and call time over the last 3 calls. */
export function latenessMinutes(calls: { startsAt: Date; calledAt: Date }[]): number | null {
  const last = [...calls].sort((a, b) => a.calledAt.getTime() - b.calledAt.getTime()).slice(-3);
  if (!last.length) return null;
  const total = last.reduce((s, c) => s + (c.calledAt.getTime() - c.startsAt.getTime()), 0);
  return Math.round(total / last.length / 60000);
}

/** WR-19: suggested arrival = appointment time + lateness, rounded down to 5 minutes. */
export function suggestedArrival(startsAt: Date, lateness: number): Date {
  return floorTo5(new Date(startsAt.getTime() + lateness * 60000));
}

export type DelayDecision = { send: false } | { send: true; correction: boolean };

/** WR-19: one warning per visit, plus one correction if lateness changes by 20 minutes or more. */
export function delayDecision(opts: {
  lateness: number | null;
  threshold: number;
  warnedLateness: number | null;
  corrections: number;
}): DelayDecision {
  const { lateness, threshold, warnedLateness, corrections } = opts;
  if (lateness === null) return { send: false };
  if (warnedLateness === null) return lateness >= threshold ? { send: true, correction: false } : { send: false };
  if (corrections < 1 && Math.abs(lateness - warnedLateness) >= 20) return { send: true, correction: true };
  return { send: false };
}
