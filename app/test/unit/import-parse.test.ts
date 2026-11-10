import { parseAppointmentsCsv } from '../../server/modules/appointments/import.js';
import { displayPhone, maskPhone, normalizePhone } from '../../server/modules/appointments/phone.js';

describe('appointments file', () => {
  it('WR-01: valid rows are parsed; columns may come in another order', () => {
    const { rows, problems } = parseAppointmentsCsv('time,date,professional,phone number,patient name\n10:15,2026-11-12,Dr. Peeters,0470 12 34 56,Sára Ëlçin');
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ patientName: 'Sára Ëlçin', phone: '+32470123456', date: '2026-11-12', time: '10:15', professional: 'Dr. Peeters' });
  });

  it('WR-01: a row with a missing field or an invalid phone number is listed with its row number and reason', () => {
    const { rows, problems } = parseAppointmentsCsv(
      'patient name,phone number,professional,date,time\nAna,0470 11 22 01,Dr. Peeters,2026-11-12,9:30\nBen,0470 12 34,Dr. Peeters,2026-11-12,9:45\nCarl,,Dr. Peeters,2026-11-12,10:00\nDora,0470 11 22 04,Dr. Peeters,12/11/2026,25:00',
    );
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([
      { row: 3, reason: 'Invalid phone number' },
      { row: 4, reason: 'Missing phone number' },
      { row: 5, reason: 'Invalid time (use HH:MM)' },
    ]);
  });

  it('WR-01: a file without a required column is refused as a whole', () => {
    expect(parseAppointmentsCsv('name,phone\nAna,0470112201').problems[0].reason).toMatch(/Missing column/);
  });

  it('WR-01: Belgian numbers are stored in international format', () => {
    expect(normalizePhone('0470 12 34 56')).toBe('+32470123456');
    expect(normalizePhone('+32 470 12 34 56')).toBe('+32470123456');
    expect(normalizePhone('0032 470 12 34 56')).toBe('+32470123456');
    expect(normalizePhone('0470 12')).toBeNull();
    expect(displayPhone('+32470123456')).toBe('+32 470 12 34 56');
    expect(maskPhone('+32470123456')).toBe('+32 470 •• •• 56');
  });
});
