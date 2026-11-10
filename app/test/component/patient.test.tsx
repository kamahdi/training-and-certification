import { fireEvent, screen, waitFor } from '@testing-library/react';
import { CheckInPage } from '../../web/src/patient/CheckInPage';
import { FormPage } from '../../web/src/patient/FormPage';
import { axeViolations, mockApi, renderAt } from './helpers';

const formData = (state = 'open') => ({
  state,
  reasonMax: 200,
  visit: { firstName: 'Sara', professional: 'Dr. Peeters', date: 'Thursday 12 November', time: '10:15', clinicName: 'Demo Clinic' },
  answers: null,
});

describe('pre-visit form (component)', () => {
  it('WR-05: consent starts unticked; saving without it shows the error inline and in a summary that takes focus', async () => {
    const calls = mockApi([['GET /api/form/', () => ({ json: formData() })], ['POST /api/form/', () => ({ json: { ok: true } })]]);
    const { container } = renderAt('/f/tok', '/f/:token', <FormPage />);
    const consent = await screen.findByLabelText(/I agree that Dr\. Peeters/);
    expect(consent).not.toBeChecked();
    fireEvent.change(screen.getByLabelText('Reason for your visit'), { target: { value: 'x'.repeat(213) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save answers' }));
    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('2 things to fix before saving');
    expect(summary).toHaveTextContent('13 characters too long');
    expect(document.activeElement).toBe(summary);
    expect(screen.getByText('We need your agreement to save your answers.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('WR-05: a valid save shows the saved screen with what happens next', async () => {
    const calls = mockApi([['GET /api/form/', () => ({ json: formData() })], ['POST /api/form/', () => ({ json: { ok: true } })]]);
    renderAt('/f/tok', '/f/:token', <FormPage />);
    fireEvent.change(await screen.findByLabelText('Reason for your visit'), { target: { value: 'Knee pain' } });
    fireEvent.click(screen.getByLabelText(/I agree/));
    fireEvent.click(screen.getByRole('button', { name: 'Save answers' }));
    expect(await screen.findByRole('heading', { name: 'Thank you, your answers are saved' })).toBeInTheDocument();
    expect(calls.at(-1)!.body).toMatchObject({ reason: 'Knee pain', consent: true });
  });

  it('WR-05: after the call the form is read-only and says so', async () => {
    mockApi([['GET /api/form/', () => ({ json: { ...formData('read_only'), answers: { reason: 'Knee pain', medications: null, fund: null, member: null, phone: null } } })]]);
    renderAt('/f/tok', '/f/:token', <FormPage />);
    expect(await screen.findByText(/can no longer be changed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save answers' })).toBeNull();
  });
});

describe('check-in (component)', () => {
  it('WR-08: two steps; a wrong code says how many tries are left; resend waits', async () => {
    mockApi([
      ['GET /api/checkin/recognize', () => ({ json: { clinicName: 'Demo Clinic', visits: [] } })],
      ['POST /api/checkin/code', () => ({ json: { result: 'code_sent', ending: '56' } })],
      ['POST /api/checkin/verify', () => ({ json: { result: 'wrong_code', attemptsLeft: 2 } })],
    ]);
    const { container } = renderAt('/c', '/c', <CheckInPage />);
    expect(await screen.findByText('Check-in · step 1 of 2')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '0470 12 34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }));
    expect(await screen.findByText('Check-in · step 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Sent to the number ending in 56.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send again in \d+ s/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('4-digit code'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That code is not right. 2 tries left'));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('WR-07: a recognized phone checks in with one tap', async () => {
    mockApi([
      ['GET /api/checkin/recognize', () => ({ json: { clinicName: 'Demo Clinic', visits: [{ visitId: 'v1', token: 'tok', firstName: 'Sara', time: '10:15', professional: 'Dr. Peeters', status: 'booked', checkinOpen: true, checkinOpensAt: '9:15' }] } })],
      ['POST /api/checkin/confirm', () => ({ json: { result: 'checked_in', visitId: 'v1' } })],
    ]);
    renderAt('/c', '/c', <CheckInPage />);
    fireEvent.click(await screen.findByRole('button', { name: /I'm here/ }));
    expect(await screen.findByText('elsewhere')).toBeInTheDocument(); // navigated to the visit page
  });

  it('WR-08: no appointment found leads to "Please see reception"', async () => {
    mockApi([
      ['GET /api/checkin/recognize', () => ({ json: { clinicName: 'Demo Clinic', visits: [] } })],
      ['POST /api/checkin/code', () => ({ json: { result: 'see_reception' } })],
    ]);
    renderAt('/c', '/c', <CheckInPage />);
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '0470 99 99 99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Text me a code' }));
    expect(await screen.findByRole('heading', { name: 'Please see reception' })).toBeInTheDocument();
  });
});
