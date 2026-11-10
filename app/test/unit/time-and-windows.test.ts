import { addDays, localTime, zonedToUtc } from '../../shared/time.js';
import { linkWindow } from '../../server/modules/visits/visits.js';
import { formState } from '../../server/modules/privacy/form.js';

const tz = 'Europe/Brussels';

describe('time zones and windows', () => {
  it('WR-04: T-05 the reminder window opens at 17:00 Brussels time, which moves in UTC with daylight saving', () => {
    expect(zonedToUtc('2026-10-25', '17:00', tz).toISOString()).toBe('2026-10-25T16:00:00.000Z');
    expect(zonedToUtc('2026-10-24', '17:00', tz).toISOString()).toBe('2026-10-24T15:00:00.000Z');
    expect(zonedToUtc('2027-03-28', '17:00', tz).toISOString()).toBe('2027-03-28T15:00:00.000Z');
    expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
  });

  it('WR-02: T-08 a 14:00 appointment link is live from 11:00 to 17:00', () => {
    const startsAt = zonedToUtc('2026-11-12', '14:00', tz);
    const w = linkWindow({ starts_at: startsAt, created_at: startsAt, called_at: null, kind: 'booked' }, { link_window_hours: 3 });
    expect(localTime(w.opensAt, tz)).toBe('11:00');
    expect(localTime(w.closesAt, tz)).toBe('17:00');
  });

  it('WR-05: the form is editable until the patient is called in, then read-only', () => {
    const from = new Date('2026-11-11T16:00:00Z');
    const now = new Date('2026-11-12T09:00:00Z');
    expect(formState({ status: 'arrived', form_link_active_from: from, cancelled_at: null }, now)).toBe('open');
    expect(formState({ status: 'called', form_link_active_from: from, cancelled_at: null }, now)).toBe('read_only');
    expect(formState({ status: 'booked', form_link_active_from: null, cancelled_at: null }, now)).toBe('not_open_yet');
  });
});
