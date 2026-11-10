import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { QueuePatient, QueueUpdated } from '../../../shared/live-events';
import { ApiError } from '../api';
import { Dialog, Icon, LiveChip, MoreMenu, Notice, useCountdown } from '../components/ui';
import { useLiveStream } from '../hooks/useLiveStream';
import { StaffShell, TopBar, useStaff } from './StaffShell';

export function QueuePage() {
  return (
    <StaffShell role={['professional', 'reception']}>
      <Queue />
    </StaffShell>
  );
}

const HIDE_KEY = 'wr_hide_reasons';
function readHide() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

interface Calling {
  visitId: string;
  name: string;
  at: string;
  undoUntil: number;
}

/** WR-12 to WR-16: the professional's queue, revised per the UX review. */
function Queue() {
  const { staff, call, lock } = useStaff();
  const [params, setParams] = useSearchParams();
  const [pros, setPros] = useState<{ id: string; name: string; room: string | null }[]>([]);
  const pid = staff.role === 'professional' ? staff.id : params.get('professionalId') ?? '';
  const [calling, setCalling] = useState<Calling | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hide, setHide] = useState(readHide);
  const [answers, setAnswers] = useState<null | { name: string; answers: any }>(null);

  useEffect(() => {
    call<{ professionals: typeof pros }>('/api/staff/professionals').then((r) => {
      setPros(r.professionals);
      if (!pid && r.professionals[0]) setParams({ professionalId: r.professionals[0].id }, { replace: true });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const poll = useCallback(() => call<QueueUpdated>(`/api/queue/${pid}`), [call, pid]);
  const live = useLiveStream<QueueUpdated>({
    url: pid ? `/api/stream/staff?professionalId=${pid}` : null,
    events: ['queue.updated', 'session.locked'],
    poll,
    isNewer: (n, c) => !c || n.professionalId !== c.professionalId || n.version >= c.version,
    onEvent: (ev) => ev === 'session.locked' && lock(),
  });
  const q = live.data;
  const pro = pros.find((p) => p.id === pid);
  const undoLeft = useCountdown(calling?.undoUntil ?? null);

  async function doCall(visitId?: string) {
    if (!q) return;
    setBusy(true);
    setError(null);
    const expected = visitId ? q.patients.find((p) => p.visitId === visitId)?.name : q.patients[0]?.name;
    try {
      const r = await call<{ visitId: string; name: string; calledTime: string }>('/api/calls', { body: { professionalId: pid, version: q.version, visitId } });
      setConflict(null);
      poll().then((fresh) => live.setData(fresh), () => {}); // don't wait for the stream to show the new next patient
      setCalling({ visitId: r.visitId, name: r.name, at: r.calledTime, undoUntil: Date.now() + 30_000 }); // clock-ok: UI countdown
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.queue) {
        live.setData(e.body.queue);
        const now = e.body.queue.patients[0]?.name;
        setConflict(now && now !== expected ? `The queue changed just before your click, so nobody was called. ${now} is now next. Check the name, then call again.` : 'The queue changed just before your click, so nobody was called. Check the list, then call again.');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await call(path, { method: 'POST', body });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function showAnswers(p: QueuePatient) {
    try {
      setAnswers(await call(`/api/visits/${p.visitId}/answers`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const next = q?.patients[0];
  return (
    <>
      <TopBar subtitle={pro ? `${pro.name}${pro.room ? ` · Room ${pro.room}` : ''}` : 'Queue'}>
        {staff.role === 'reception' && (
          <label className="row small" style={{ gap: 8 }}>
            <span>Queue of</span>
            <select value={pid} onChange={(e) => setParams({ professionalId: e.target.value })} style={{ minHeight: 40, borderRadius: 8, border: '1px solid var(--border-strong)', padding: '0 10px', font: 'inherit' }}>
              {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {q?.lateness != null && q.lateness >= 5 && <span className="badge warning">Running {q.lateness} min late</span>}
        <LiveChip status={live.status} updatedAt={live.updatedAt} />
        <label className="row small" style={{ gap: 8, minHeight: 44 }}>
          <input type="checkbox" role="switch" checked={hide} onChange={(e) => { setHide(e.target.checked); try { localStorage.setItem(HIDE_KEY, e.target.checked ? '1' : '0'); } catch { /* blocked */ } }} style={{ width: 20, height: 20, accentColor: '#006B44' }} />
          Hide reasons
        </label>
      </TopBar>

      <main className="page">
        {conflict && <Notice kind="warning" role="alert" title="Nobody was called">{conflict}</Notice>}
        {error && <Notice kind="error" role="alert" title="That did not work">{error}</Notice>}

        {calling && (
          <section className="notice dark" role="status" aria-label="Call in progress" style={{ flexWrap: 'wrap' }}>
            <Icon name="bell" color="#fff" />
            <span style={{ flex: '999 1 360px' }}><strong>You called {calling.name} at {calling.at}.</strong> Call their name in the waiting room; their page shows they are being called.</span>
            {undoLeft > 0 && (
              <button className="btn on-dark" onClick={async () => { await act(`/api/visits/${calling.visitId}/undo-call`); setCalling(null); }}>Undo · {undoLeft} s</button>
            )}
            <button className="btn on-dark" style={{ background: 'transparent' }} onClick={async () => { await act(`/api/visits/${calling.visitId}/skip`); setCalling(null); }}>Not here, skip</button>
            <button className="btn icon on-dark" style={{ background: 'transparent', border: 0 }} aria-label="Dismiss" onClick={() => setCalling(null)}><Icon name="close" size={18} color="#fff" /></button>
          </section>
        )}

        {!q ? (
          <p className="muted" aria-busy="true">Loading the queue…</p>
        ) : next ? (
          <section className="card big row" style={{ gap: 24, ...(conflict ? { border: '2px solid var(--ethix-deep-green)' } : {}) }} aria-label="Next to call">
            <div className="stack" style={{ flex: '999 1 420px', minWidth: 0, gap: 6 }}>
              <span className="eyebrow">{calling ? 'Next, when you are ready' : 'Next to call'}</span>
              <div className="row">
                <span className="h1" style={{ fontSize: 36 }}>{next.name}</span>
                {next.emergency && <span className="badge emergency">From emergency</span>}
              </div>
              <span style={{ fontSize: 15 }}>
                {next.appointmentTime ? `Booked ${next.appointmentTime}` : 'Walk-in'} · waiting {next.waitingMinutes} min{!hide && next.reason ? ` · ${next.reason}` : ''}
              </span>
            </div>
            <button className="btn primary large" style={{ flex: '1 1 260px' }} disabled={busy || live.status === 'connecting'} onClick={() => doCall()}>
              {busy ? 'Calling…' : `Next patient: call ${next.name}`}
            </button>
          </section>
        ) : (
          <section className="card big" aria-label="Next to call">
            <h2 className="h2">No patients waiting</h2>
            <p className="small muted">Patients appear here as soon as they check in.</p>
          </section>
        )}

        {q && q.patients.length > 0 && (
          <section className="card" style={{ padding: 0 }} aria-labelledby="w-title">
            <div className="row" style={{ padding: '18px 24px 10px', alignItems: 'baseline' }}>
              <h2 id="w-title" className="h2">Waiting</h2>
              <span className="small muted">{q.patients.length} {q.patients.length === 1 ? 'patient' : 'patients'}, in the order to call them</span>
            </div>
            <div className="table-wrap" style={live.status === 'reconnecting' ? { opacity: 0.62 } : undefined}>
              <table className="list" style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th scope="col">Patient</th>
                    <th scope="col">Appointment</th>
                    <th scope="col">Waiting</th>
                    {!hide && <th scope="col">Reason for visit</th>}
                    <th scope="col">Form</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {q.patients.map((p, i) => (
                    <tr key={p.visitId} className={i === 0 ? 'is-next' : undefined}>
                      <td>
                        <span className="name">{p.name}</span>
                        {i === 0 && <span className="badge next" style={{ marginLeft: 8 }}>Next</span>}
                        {p.emergency && <span className="badge emergency" style={{ marginLeft: 8 }}>From emergency</span>}
                      </td>
                      <td className={p.appointmentTime ? 'mono' : 'muted'}>{p.appointmentTime ?? 'Walk-in'}</td>
                      <td className="mono">{p.waitingMinutes} min</td>
                      {!hide && <td className={p.reason ? undefined : 'muted'}>{p.reason ?? 'Not given'}</td>}
                      <td>{p.formDone ? <span className="check"><Icon name="check" size={16} color="#006B44" />Form done</span> : <span className="muted">Not done</span>}</td>
                      <td>
                        <MoreMenu
                          label={`More actions for ${p.name}`}
                          items={[
                            { label: 'See form answers', onSelect: () => showAnswers(p), hidden: !p.formDone },
                            { label: p.emergency ? 'Clear emergency flag' : 'Flag as coming from emergency', onSelect: () => act(`/api/visits/${p.visitId}/emergency`, { on: !p.emergency }) },
                            { label: `Call out of order (skips ${i})`, onSelect: () => doCall(p.visitId), hidden: i === 0 },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {answers && (
        <Dialog title={`Form answers · ${answers.name}`} description="Opening these answers is recorded in the access log." onClose={() => setAnswers(null)}>
          {answers.answers ? (
            <dl className="stack" style={{ gap: 12, margin: 0 }}>
              {[['Reason for visit', answers.answers.reason], ['Medicines', answers.answers.medications], ['Insurance fund', answers.answers.fund], ['Member number', answers.answers.member], ['Phone number', answers.answers.phone]].map(([k, v]) => (
                <div key={k} className="stack" style={{ gap: 2 }}>
                  <dt className="small muted">{k}</dt>
                  <dd style={{ margin: 0, color: 'var(--text-strong)' }}>{v || '—'}</dd>
                </div>
              ))}
              {answers.answers.updatedAfterCheckIn && <p className="badge warning">Updated after check-in, at {answers.answers.updatedTime}</p>}
            </dl>
          ) : (
            <p>This patient has not filled in the form.</p>
          )}
        </Dialog>
      )}
    </>
  );
}
