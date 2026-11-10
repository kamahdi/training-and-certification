import {
  averageConsultMinutes, delayDecision, estimateRange, isSlip, latenessMinutes, suggestedArrival,
} from '../../server/modules/estimates/estimate.js';
import { localTime } from '../../shared/time.js';

const tz = 'Europe/Brussels';
const t = (hhmm: string) => new Date(`2026-11-12T${hhmm.padStart(5, '0')}:00+01:00`);
const settings = { estimate_before_min: 5, estimate_after_min: 10 };

describe('estimates', () => {
  it('WR-17: T-02 two patients ahead at 12 minutes each, at 10:00, shows around 10:20–10:35', () => {
    const r = estimateRange(t('10:00'), 2, 12, settings);
    expect(localTime(r.estimate, tz)).toBe('10:24');
    expect(localTime(r.from, tz)).toBe('10:20');
    expect(localTime(r.to, tz)).toBe('10:35');
  });

  it('WR-17: average consultation length uses the last 5 gaps between calls', () => {
    const calls = ['9:00', '9:10', '9:20', '9:30', '9:40', '9:50', '10:20'].map(t);
    expect(averageConsultMinutes(calls, 15)).toBe(14); // gaps 10,10,10,10,30 → 14
    expect(averageConsultMinutes([t('9:00')], 15)).toBe(15);
  });

  it('WR-17: an estimate is never earlier than now', () => {
    const r = estimateRange(t('10:02'), 0, 12, settings);
    expect(r.from.getTime()).toBeGreaterThanOrEqual(t('10:00').getTime());
    expect(r.estimate.getTime()).toBe(t('10:02').getTime());
  });

  it('WR-18: a slip is the end of the range moving 10 minutes or more later', () => {
    expect(isSlip(t('10:35'), t('10:45'))).toBe(true);
    expect(isSlip(t('10:35'), t('10:40'))).toBe(false);
    expect(isSlip(null, t('10:45'))).toBe(false);
  });

  it('WR-19: T-03 lateness of 20, 15 and 25 minutes is 20; Eva booked 11:30 is asked to come at 11:50', () => {
    const calls = [
      { startsAt: t('9:00'), calledAt: t('9:20') },
      { startsAt: t('9:15'), calledAt: t('9:30') },
      { startsAt: t('9:30'), calledAt: t('9:55') },
    ];
    expect(latenessMinutes(calls)).toBe(20);
    expect(localTime(suggestedArrival(t('11:30'), 20), tz)).toBe('11:50');
    expect(localTime(suggestedArrival(t('11:30'), 22), tz)).toBe('11:50');
  });

  it('WR-19: one warning per visit, plus one correction if lateness changes by 20 minutes or more', () => {
    expect(delayDecision({ lateness: 14, threshold: 15, warnedLateness: null, corrections: 0 })).toEqual({ send: false });
    expect(delayDecision({ lateness: 20, threshold: 15, warnedLateness: null, corrections: 0 })).toEqual({ send: true, correction: false });
    expect(delayDecision({ lateness: 25, threshold: 15, warnedLateness: 20, corrections: 0 })).toEqual({ send: false });
    expect(delayDecision({ lateness: 40, threshold: 15, warnedLateness: 20, corrections: 0 })).toEqual({ send: true, correction: true });
    expect(delayDecision({ lateness: 65, threshold: 15, warnedLateness: 40, corrections: 1 })).toEqual({ send: false });
  });
});
