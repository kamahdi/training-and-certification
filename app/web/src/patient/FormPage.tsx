import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Icon } from '../components/ui';

interface FormData {
  state: 'not_open_yet' | 'open' | 'read_only' | 'closed';
  reasonMax: number;
  visit: { firstName: string; professional: string; date: string; time: string | null; clinicName: string };
  answers: null | { reason: string | null; medications: string | null; fund: string | null; member: string | null; phone: string | null };
}

type Errors = Partial<Record<'reason' | 'consent' | 'form', string>>;

/** WR-05: the pre-visit form. Consent is never pre-ticked; errors appear next to fields and in a summary. */
export function FormPage() {
  const { token } = useParams();
  const [data, setData] = useState<FormData | null>(null);
  const [missing, setMissing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [values, setValues] = useState({ reason: '', medications: '', fund: '', member: '', phone: '' });
  const [consent, setConsent] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api<FormData>(`/api/form/${token}`).then(
      (d) => {
        setData(d);
        if (d.answers) setValues({ reason: d.answers.reason ?? '', medications: d.answers.medications ?? '', fund: d.answers.fund ?? '', member: d.answers.member ?? '', phone: d.answers.phone ?? '' });
      },
      (e) => e instanceof ApiError && e.status === 404 && setMissing(true),
    );
  }, [token]);
  useEffect(() => {
    if (Object.keys(errors).length) summary.current?.focus();
  }, [errors]);
  useEffect(() => {
    if (saved) savedHeading.current?.focus();
  }, [saved]);

  if (missing) return <Simple title="This link does not work" body="Check that you opened the whole link from your text message." />;
  if (!data) return <main className="phone white" aria-busy="true"><p className="muted">Loading…</p></main>;
  if (data.state === 'closed') return <Simple title="This form is closed" body="The appointment was cancelled or has ended." />;
  if (data.state === 'not_open_yet') return <Simple title="Your form opens with tomorrow's reminder" body="We will text you a link the evening before your visit." />;

  const max = data.reasonMax;
  const over = values.reason.length - max;
  const readOnly = data.state === 'read_only';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const errs: Errors = {};
    if (over > 0) errs.reason = `Keep it to ${max} characters. Details can wait for the consultation.`;
    if (!consent) errs.consent = 'We need your agreement to save your answers.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api(`/api/form/${token}`, { body: { ...values, consent } });
      setSaved(true);
    } catch (err) {
      setErrors({ form: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <main className="phone white" style={{ gap: 24 }}>
        <span className="brand">{data.visit.clinicName}</span>
        <div className="stack" style={{ gap: 12, marginTop: 40 }} role="status">
          <span style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--surface-card-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={28} color="#006B44" /></span>
          <h1 ref={savedHeading} tabIndex={-1} className="h1" style={{ outline: 'none' }}>Thank you, your answers are saved</h1>
          <p className="lead">{data.visit.professional} will see them before calling you in. Nothing else to fill in.</p>
        </div>
        <section className="card stack" style={{ background: 'var(--surface-subtle)', border: 0, gap: 12 }}>
          <strong style={{ color: 'var(--text-strong)' }}>What happens next</strong>
          <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">
            <li>On the day, scan the code at the entrance to check in.</li>
            <li>Your visit page shows when you will be called.</li>
            <li>You can change these answers until you are called in.</li>
          </ol>
        </section>
        <button className="btn large" onClick={() => setSaved(false)}>Change my answers</button>
      </main>
    );
  }

  const errorList = (['reason', 'consent', 'form'] as const).filter((k) => errors[k]);
  return (
    <main className="phone white" style={{ gap: 16 }}>
      <header className="row" style={{ minHeight: 40 }}>
        <span className="brand">{data.visit.clinicName}</span>
        <span className="spacer" />
        <span className="small muted">{data.visit.date}{data.visit.time ? ` · ${data.visit.time}` : ''}</span>
      </header>
      <h1 className="h1" style={{ fontSize: 28 }}>Before your visit</h1>
      {readOnly ? (
        <p className="notice warning" role="status">You have been called in, so these answers can no longer be changed.</p>
      ) : (
        <p className="small">About 3 minutes. You can change your answers until you are called in.</p>
      )}

      {errorList.length > 0 && (
        <div ref={summary} tabIndex={-1} className="notice error" role="alert" aria-labelledby="err-title" style={{ flexDirection: 'column', gap: 6 }}>
          <strong id="err-title">{errorList.length === 1 ? '1 thing to fix before saving' : `${errorList.length} things to fix before saving`}</strong>
          {errors.reason && <a href="#reason">Reason for your visit is {over} characters too long</a>}
          {errors.consent && <a href="#consent">Tick the box to agree to how your answers are used</a>}
          {errors.form && <span>{errors.form}</span>}
        </div>
      )}

      <form className="stack" style={{ gap: 16 }} onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="reason">Reason for your visit</label>
          <textarea id="reason" rows={3} readOnly={readOnly} value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} aria-invalid={!!errors.reason} aria-describedby="reason-count reason-error" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span id="reason-error" className="error">{errors.reason ?? ''}</span>
            <span id="reason-count" className="mono small" style={{ color: over > 0 ? '#8E2D21' : 'var(--text-muted)', fontWeight: over > 0 ? 600 : 400 }}>{values.reason.length} / {max}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="meds">Medicines you take now <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="meds" type="text" readOnly={readOnly} value={values.medications} onChange={(e) => setValues({ ...values, medications: e.target.value })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="fund">Health insurance fund</label>
            <input id="fund" type="text" readOnly={readOnly} value={values.fund} onChange={(e) => setValues({ ...values, fund: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="member">Member number</label>
            <input id="member" type="text" inputMode="numeric" className="mono" readOnly={readOnly} value={values.member} onChange={(e) => setValues({ ...values, member: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="tel">Phone number <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="tel" type="tel" className="mono" readOnly={readOnly} value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
        </div>
        {!readOnly && (
          <>
            <div className="stack" style={{ gap: 6 }}>
              <div className={`consent ${errors.consent ? 'invalid' : ''}`}>
                <input id="consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-invalid={!!errors.consent} aria-describedby={errors.consent ? 'consent-error' : undefined} />
                <label htmlFor="consent">I agree that {data.visit.professional} and reception see these answers. They are never sent by text and are deleted after the clinic's retention period.</label>
              </div>
              {errors.consent && <span id="consent-error" className="error small" style={{ color: '#8E2D21' }}>{errors.consent}</span>}
            </div>
            <button className="btn primary large" disabled={busy}>{busy ? 'Saving…' : 'Save answers'}</button>
          </>
        )}
      </form>
    </main>
  );
}

function Simple({ title, body }: { title: string; body: string }) {
  return (
    <main className="phone white">
      <div className="stack" style={{ gap: 12, marginTop: 64 }}>
        <h1 className="h1">{title}</h1>
        <p className="lead">{body}</p>
      </div>
    </main>
  );
}
