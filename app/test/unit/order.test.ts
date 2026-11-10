import { orderQueue, type QueueItem } from '../../server/modules/queue/order.js';

const t = (hhmm: string) => new Date(`2026-11-12T${hhmm.padStart(5, '0')}:00+01:00`);
const booked = (id: string, at: string, arrived: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  visitId: id, kind: 'booked', startsAt: t(at), arrivedAt: t(arrived), emergency: false, ...extra,
});
const walkIn = (id: string, arrived: string): QueueItem => ({ visitId: id, kind: 'walk_in', startsAt: null, arrivedAt: t(arrived), emergency: false });

describe('queue order', () => {
  it('WR-12: T-01 emergency first, then booked by appointment time; early arrival does not move a patient up', () => {
    const q = orderQueue([booked('ana', '10:00', '9:30'), booked('ben', '9:45', '9:50'), booked('dan', '10:15', '10:05', { emergency: true })], t('10:06'));
    expect(q.map((x) => x.visitId)).toEqual(['dan', 'ben', 'ana']);
  });

  it('WR-13: several flagged patients are ordered by arrival time', () => {
    const q = orderQueue([booked('a', '9:00', '9:20', { emergency: true }), booked('b', '10:00', '9:10', { emergency: true })], t('10:06'));
    expect(q.map((x) => x.visitId)).toEqual(['b', 'a']);
  });

  it('WR-10: a walk-in goes after booked patients whose time has passed and before those whose time has not', () => {
    const q = orderQueue([booked('late', '11:00', '9:40'), walkIn('walk', '10:04'), booked('due', '10:00', '9:55')], t('10:06'));
    expect(q.map((x) => x.visitId)).toEqual(['due', 'walk', 'late']);
  });

  it('WR-13: clearing the flag returns the patient to their normal place', () => {
    const items = [booked('a', '9:30', '9:20'), booked('b', '9:45', '9:40')];
    expect(orderQueue(items, t('10:00')).map((x) => x.visitId)).toEqual(['a', 'b']);
    expect(orderQueue([{ ...items[0] }, { ...items[1], emergency: true }], t('10:00')).map((x) => x.visitId)).toEqual(['b', 'a']);
  });

  it('WR-16: a skipped patient goes back right after the next person in line', () => {
    const q = orderQueue([booked('a', '9:30', '9:20', { requeueAfter: 'b' }), booked('b', '9:45', '9:40'), booked('c', '10:00', '9:50')], t('10:06'));
    expect(q.map((x) => x.visitId)).toEqual(['b', 'a', 'c']);
  });
});
