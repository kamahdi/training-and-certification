import { useState } from 'react';
import { download } from '../api';
import { Notice } from '../components/ui';
import { StaffShell, TopBar, useStaff } from './StaffShell';

export function ManagerPage() {
  return (
    <StaffShell role={['manager']}>
      <Manager />
    </StaffShell>
  );
}

interface Found { phone: string; visits: { visitId: string; name: string; date: string; time: string | null; professional: string; status: string }[] }

/** WR-20, WR-22, WR-31, WR-32: data requests and audit for the clinic manager. */
function Manager() {
  const { call } = useStaff();
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [mode, setMode] = useState<'none' | 'erase' | 'export'>('none');
  const [last4, setLast4] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [log, setLog] = useState<{ at: string; staff: string; role: string; patient: string }[] | null>(null);
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10)); // clock-ok: default for a date picker

  const fail = (e: unknown) => setMsg({ kind: 'error', text: (e as Error).message });

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setMode('none');
    setCodeSent(false);
    try {
      setFound(await call<Found>('/api/manager/patients/find', { body: { phone } }));
      setLog((await call<{ entries: any[] }>(`/api/manager/access-log?phone=${encodeURIComponent(phone)}`)).entries);
    } catch (err) {
      setFound(null);
      fail(err);
    }
  }

  async function erase(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await call<{ erasedVisits: number }>('/api/manager/patients/erase', { body: { phone, last4 } });
      setMsg({ kind: 'success', text: `Erased. ${r.erasedVisits} ${r.erasedVisits === 1 ? 'visit' : 'visits'} and everything linked to them are gone; wait statistics are kept without identity.` });
      setFound(null);
      setLog(null);
      setMode('none');
      setLast4('');
    } catch (err) {
      fail(err);
    }
  }

  async function sendCode() {
    try {
      await call('/api/manager/patients/export-code', { body: { phone } });
      setCodeSent(true);
      setMsg(null);
    } catch (err) {
      fail(err);
    }
  }

  async function exportAs(format: 'json' | 'pdf') {
    try {
      await download('/api/manager/patients/export', { phone, code, format }, `personal-data.${format}`);
      setMsg({ kind: 'success', text: `Downloaded as ${format.toUpperCase()}. The file is not kept on the server. Give it to the patient; do not send it by text.` });
      setCode('');
      setCodeSent(false);
      setMode('none');
    } catch (err) {
      fail(err);
    }
  }

  return (
    <>
      <TopBar subtitle="Clinic manager" />
      <main className="page">
        <h1 className="h1">Patient data requests</h1>
        {msg && <Notice kind={msg.kind} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</Notice>}

        <form className="card row" style={{ alignItems: 'flex-end' }} onSubmit={find}>
          <div className="field" style={{ flex: '999 1 300px' }}>
            <label htmlFor="mphone">Patient's phone number</label>
            <input id="mphone" type="tel" className="mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn primary" disabled={!phone}>Find</button>
        </form>

        {found && (
          <section className="card stack" style={{ gap: 16 }}>
            <h2 className="h2">{found.visits.length ? `${found.visits.length} ${found.visits.length === 1 ? 'visit' : 'visits'} held for this number` : 'Nothing is held for this number'}</h2>
            {found.visits.length > 0 && (
              <ul className="stack small" style={{ margin: 0, paddingLeft: 20 }}>
                {found.visits.map((v) => <li key={v.visitId}>{v.name} · {v.date}{v.time ? ` ${v.time}` : ''} · {v.professional} · {v.status}</li>)}
              </ul>
            )}
            {found.visits.length > 0 && (
              <div className="row">
                <button className="btn" aria-pressed={mode === 'export'} onClick={() => setMode('export')}>Give the patient a copy</button>
                <button className="btn" aria-pressed={mode === 'erase'} onClick={() => setMode('erase')}>Erase this patient's data</button>
              </div>
            )}

            {mode === 'export' && (
              <div className="stack" style={{ gap: 12 }}>
                <p className="small">First confirm the person asking owns this number: we text a code to it, and they read it out or forward it to you.</p>
                {!codeSent ? (
                  <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={sendCode}>Text a code to the patient</button>
                ) : (
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <div className="field">
                      <label htmlFor="ecode">Code the patient received</label>
                      <input id="ecode" className="code" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                    </div>
                    <button className="btn primary" disabled={code.length !== 4} onClick={() => exportAs('pdf')}>Download PDF</button>
                    <button className="btn" disabled={code.length !== 4} onClick={() => exportAs('json')}>Download JSON</button>
                  </div>
                )}
              </div>
            )}

            {mode === 'erase' && (
              <form className="stack" style={{ gap: 12 }} onSubmit={erase}>
                <Notice kind="warning">This deletes names, phone numbers, form answers and texts for all {found.visits.length} visits. It cannot be undone.</Notice>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <div className="field">
                    <label htmlFor="last4">To confirm, type the last 4 digits of the number</label>
                    <input id="last4" className="mono" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <button className="btn primary" disabled={last4.length !== 4}>Erase permanently</button>
                </div>
              </form>
            )}
          </section>
        )}

        {log && (
          <section className="card stack" aria-labelledby="log-title">
            <h2 id="log-title" className="h2">Who opened this patient's answers</h2>
            {log.length === 0 ? <p className="small muted">Nobody has opened them.</p> : (
              <ul className="stack small" style={{ margin: 0, paddingLeft: 20 }}>
                {log.map((l, i) => <li key={i}>{l.at} · {l.staff} ({l.role})</li>)}
              </ul>
            )}
          </section>
        )}

        <section className="card row" aria-labelledby="ev-title" style={{ alignItems: 'flex-end' }}>
          <div className="stack" style={{ flex: '999 1 300px' }}>
            <h2 id="ev-title" className="h2">Day's events</h2>
            <p className="small muted">A CSV of every step for one day, with names and phone numbers left out.</p>
          </div>
          <div className="field">
            <label htmlFor="evday">Day</label>
            <input id="evday" type="text" className="mono" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <a className="btn" href={`/api/manager/events.csv?date=${encodeURIComponent(day)}`}>Download CSV</a>
        </section>
      </main>
    </>
  );
}
