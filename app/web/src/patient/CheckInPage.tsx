import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon, useCountdown } from '../components/ui';

interface Recognized {
  visitId: string;
  token: string;
  firstName: string;
  time: string | null;
  professional: string;
  status: string;
  checkinOpensAt: string | null;
  checkinOpen: boolean;
}

type Step =
  | { kind: 'loading' }
  | { kind: 'recognized'; visit: Recognized }
  | { kind: 'phone'; error?: string }
  | { kind: 'code'; phone: string; ending: string; error?: string; sentAt: number }
  | { kind: 'choose'; phone: string; code: string; options: Recognized[] }
  | { kind: 'see_reception' }
  | { kind: 'not_open'; opensAt: string };

/** WR-07 and WR-08: QR check-in. One tap on a recognized phone, else two steps with a text code. */
export function CheckInPage() {
  const nav = useNavigate();
  const [clinic, setClinic] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<{ clinicName: string; visits: Recognized[] }>('/api/checkin/recognize').then(
      (r) => {
        setClinic(r.clinicName);
        const v = r.visits.find((x) => x.status === 'booked') ?? r.visits[0];
        setStep(v ? { kind: 'recognized', visit: v } : { kind: 'phone' });
      },
      () => setStep({ kind: 'phone' }),
    );
  }, []);
  useEffect(() => heading.current?.focus(), [step.kind]);

  async function confirm(v: Recognized) {
    setBusy(true);
    try {
      const r = await api('/api/checkin/confirm', { body: { visitId: v.visitId } });
      if (r.result === 'not_open_yet') setStep({ kind: 'not_open', opensAt: r.opensAt });
      else nav(`/v/${v.token}`);
    } catch {
      setStep({ kind: 'phone', error: 'We could not check you in this way. Use your phone number instead.' });
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(phone: string) {
    setBusy(true);
    try {
      const r = await api('/api/checkin/code', { body: { phone } });
      if (r.result === 'code_sent') setStep({ kind: 'code', phone, ending: r.ending, sentAt: Date.now() }); // clock-ok
      else if (r.result === 'too_many') setStep({ kind: 'phone', error: 'Too many codes were sent to this number. Please wait 10 minutes, or see reception.' });
      else setStep({ kind: 'see_reception' });
    } catch (e) {
      setStep({ kind: 'phone', error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function verify(phone: string, code: string, visitId?: string) {
    setBusy(true);
    try {
      const r = await api('/api/checkin/verify', { body: { phone, code, visitId } });
      if (r.result === 'checked_in') nav(`/v/${r.token}`);
      else if (r.result === 'choose') setStep({ kind: 'choose', phone, code, options: r.options });
      else if (r.result === 'wrong_code') setStep((s) => (s.kind === 'code' ? { ...s, error: `That code is not right. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left, then you will need to see reception.` } : s));
      else if (r.result === 'not_open_yet') setStep({ kind: 'not_open', opensAt: r.opensAt });
      else setStep({ kind: 'see_reception' });
    } catch (e) {
      setStep((s) => (s.kind === 'code' ? { ...s, error: (e as Error).message } : s));
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="row" style={{ minHeight: 48 }}>
      <span className="brand">{clinic}</span>
      <span className="spacer" />
      {step.kind === 'code' && <button className="btn link" onClick={() => setStep({ kind: 'phone' })}>Change number</button>}
    </header>
  );

  if (step.kind === 'loading') return <main className="phone white" aria-busy="true">{header}<p className="muted">Loading…</p></main>;

  if (step.kind === 'recognized') {
    const v = step.visit;
    if (v.status !== 'booked') {
      return (
        <main className="phone white" style={{ gap: 24 }}>
          {header}
          <h1 ref={heading} tabIndex={-1} className="h1" style={{ marginTop: 40 }}>You're checked in, {v.firstName}</h1>
          <Link className="btn primary large" to={`/v/${v.token}`}>See when you'll be called</Link>
        </main>
      );
    }
    return (
      <main className="phone white" style={{ gap: 24 }}>
        {header}
        <div className="stack" style={{ gap: 12, marginTop: 40 }}>
          <span className="eyebrow">Check-in</span>
          <h1 ref={heading} tabIndex={-1} className="h1" style={{ fontSize: 40 }}>Hi {v.firstName}, tap to confirm you're here</h1>
        </div>
        <section className="card tint stack" style={{ gap: 4 }}>
          <span className="h2" style={{ fontSize: 26 }}>Today{v.time ? `, ${v.time}` : ''}</span>
          <span>{v.professional}</span>
        </section>
        {v.checkinOpen ? (
          <button className="btn primary large" disabled={busy} onClick={() => confirm(v)}><Icon name="check" color="#fff" /> I'm here</button>
        ) : (
          <p className="notice warning" role="status">Check-in opens at {v.checkinOpensAt}. Please come back then.</p>
        )}
        <button className="btn link" style={{ alignSelf: 'center', minHeight: 44 }} onClick={() => setStep({ kind: 'phone' })}>Not {v.firstName}? Check in with your phone number</button>
      </main>
    );
  }

  if (step.kind === 'phone') return <PhoneStep header={header} heading={heading} error={step.error} busy={busy} onSubmit={sendCode} />;
  if (step.kind === 'code') return <CodeStep header={header} heading={heading} step={step} busy={busy} onVerify={(c) => verify(step.phone, c)} onResend={() => sendCode(step.phone)} />;

  if (step.kind === 'choose') {
    return (
      <main className="phone white" style={{ gap: 20 }}>
        {header}
        <h1 ref={heading} tabIndex={-1} className="h1" style={{ marginTop: 24 }}>Which appointment are you here for?</h1>
        {step.options.map((o) => (
          <button key={o.visitId} className="btn large block" disabled={busy} onClick={() => verify(step.phone, step.code, o.visitId)}>
            {o.time} with {o.professional}
          </button>
        ))}
      </main>
    );
  }

  if (step.kind === 'not_open') {
    return (
      <main className="phone white" style={{ gap: 20 }}>
        {header}
        <h1 ref={heading} tabIndex={-1} className="h1" style={{ marginTop: 40 }}>Check-in opens at {step.opensAt}</h1>
        <p className="lead">You're early. Please scan the code again from {step.opensAt}, or ask reception.</p>
      </main>
    );
  }

  return (
    <main className="phone white" style={{ gap: 24 }}>
      {header}
      <div className="stack" style={{ gap: 12, marginTop: 40 }} role="alert">
        <Icon name="people" size={40} color="#006B44" />
        <h1 ref={heading} tabIndex={-1} className="h1">Please see reception</h1>
        <p className="lead">We could not check you in here. Reception will do it for you in a few seconds, and you keep your place.</p>
      </div>
      <section className="card stack small" style={{ background: 'var(--surface-subtle)', border: 0 }}>
        <strong>This can happen when</strong>
        <span>· we have no appointment today for this number</span>
        <span>· the code was wrong 3 times</span>
        <span>· the appointment was booked under another number</span>
      </section>
      <button className="btn large" onClick={() => setStep({ kind: 'phone' })}>Try another number</button>
    </main>
  );
}

function Progress({ step }: { step: 1 | 2 }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="small muted" style={{ fontWeight: 600 }}>Check-in · step {step} of 2</span>
      <div aria-hidden style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <span style={{ height: 4, borderRadius: 999, background: 'var(--ethix-deep-green)' }} />
        <span style={{ height: 4, borderRadius: 999, background: step === 2 ? 'var(--ethix-deep-green)' : 'var(--n-200)' }} />
      </div>
    </div>
  );
}

function PhoneStep({ header, heading, error, busy, onSubmit }: { header: React.ReactNode; heading: React.RefObject<HTMLHeadingElement>; error?: string; busy: boolean; onSubmit: (p: string) => void }) {
  const [phone, setPhone] = useState('');
  const [local, setLocal] = useState<string | undefined>();
  const msg = local ?? error;
  return (
    <main className="phone white" style={{ gap: 24 }}>
      {header}
      <form
        className="stack"
        style={{ gap: 24 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (phone.replace(/\D/g, '').length < 8) return setLocal('Enter your full phone number.');
          setLocal(undefined);
          onSubmit(phone);
        }}
      >
        <div className="stack" style={{ gap: 10 }}>
          <Progress step={1} />
          <h1 ref={heading} tabIndex={-1} className="h1">What is your phone number?</h1>
          <p className="lead">Use the one you gave when you booked. We will text you a 4-digit code.</p>
        </div>
        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input id="phone" type="tel" autoComplete="tel" inputMode="tel" className="mono" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!msg} aria-describedby={msg ? 'phone-error' : 'phone-hint'} />
          {msg ? <span id="phone-error" className="error" role="alert">{msg}</span> : <span id="phone-hint" className="hint">Belgian numbers can start with 0 or +32.</span>}
        </div>
        <button className="btn primary large" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
      </form>
      <p className="small muted push-bottom">No phone with you? Reception can check you in.</p>
    </main>
  );
}

function CodeStep({ header, heading, step, busy, onVerify, onResend }: {
  header: React.ReactNode; heading: React.RefObject<HTMLHeadingElement>; step: Extract<Step, { kind: 'code' }>; busy: boolean; onVerify: (c: string) => void; onResend: () => void;
}) {
  const [code, setCode] = useState('');
  const resendIn = useCountdown(step.sentAt + 30_000);
  return (
    <main className="phone white" style={{ gap: 22 }}>
      {header}
      <form className="stack" style={{ gap: 22 }} noValidate onSubmit={(e) => { e.preventDefault(); if (code.length === 4) onVerify(code); }}>
        <div className="stack" style={{ gap: 10 }}>
          <Progress step={2} />
          <h1 ref={heading} tabIndex={-1} className="h1">Enter the code we texted you</h1>
          <p className="lead">Sent to the number ending in {step.ending}.</p>
        </div>
        <div className="field">
          <label htmlFor="code">4-digit code</label>
          <input id="code" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-invalid={!!step.error} aria-describedby={step.error ? 'code-error' : undefined} />
          {step.error && <span id="code-error" className="error" role="alert">{step.error}</span>}
        </div>
        <button className="btn primary large" disabled={busy || code.length !== 4}>{busy ? 'Checking…' : 'Check in'}</button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">The code works for 10 minutes.</span>
        <button className="btn link" disabled={resendIn > 0 || busy} onClick={onResend}>{resendIn > 0 ? `Send again in ${resendIn} s` : 'Send again'}</button>
      </div>
      <p className="small muted push-bottom">No text after a minute? Check the number, or ask reception.</p>
    </main>
  );
}
