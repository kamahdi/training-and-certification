import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { clinicTime } from '../api';
import { Dialog, Icon, MoreMenu, Notice, UndoToast } from '../components/ui';
import { StaffShell, TopBar, useStaff } from './StaffShell';

export function ReceptionPage() {
  return (
    <StaffShell role={['reception']}>
      <Reception />
    </StaffShell>
  );
}

interface Appt {
  visitId: string;
  name: string;
  professionalId: string;
  professional: string;
  room: string | null;
  time: string | null;
  kind: 'booked' | 'walk_in';
  status: 'booked' | 'arrived' | 'called' | 'missed' | 'done';
  emergency: boolean;
  arrivedAt: string | null;
  checkinMethod: string | null;
  phone: string | null;
}
interface Failed { messageId: string; visitId: string; name: string; template: string; reason: string | null; phone: string }
interface ImportResult { imported: number; duplicates: number; cancelled: number; skipped: { row: number; reason: string }[] }

const TEMPLATE: Record<string, string> = { confirmation: 'confirmation', confirmation_same_day: 'confirmation', reminder: 'reminder', reminder_form_done: 'reminder', delay: 'delay warning', walk_in: 'visit link' };

function StatusBadge({ a }: { a: Appt }) {
  switch (a.status) {
    case 'arrived': return <span className="badge waiting">Waiting · since {a.arrivedAt}</span>;
    case 'called': return <span className="badge called">Called{a.room ? ` · room ${a.room}` : ''}</span>;
    case 'missed': return <span className="badge warning">Missed · called twice</span>;
    case 'done': return <span className="badge neutral">Seen</span>;
    default: return <span className="badge neutral">Not arrived</span>;
  }
}

/** WR-01, WR-03, WR-09, WR-10, WR-13, WR-16: reception, revised per the UX review. */
function Reception() {
  const { call } = useStaff();
  const [appts, setAppts] = useState<Appt[] | null>(null);
  const [failed, setFailed] = useState<Failed[]>([]);
  const [pros, setPros] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<null | { message: string; until: number; undo?: () => Promise<void> }>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>('');
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ q, ...(filter ? { professionalId: filter } : {}) });
    const [a, f] = await Promise.all([
      call<{ appointments: Appt[] }>(`/api/reception/today?${params}`),
      call<{ failed: Failed[] }>('/api/reception/failed-texts'),
    ]);
    setAppts(a.appointments);
    setFailed(f.failed);
    setUpdatedAt(clinicTime(new Date()));
  }, [call, q, filter]);

  useEffect(() => {
    call<{ professionals: { id: string; name: string }[] }>('/api/staff/professionals').then((r) => setPros(r.professionals));
  }, [call]);
  useEffect(() => {
    const t = window.setTimeout(() => load().catch((e) => setError(e.message)), 200);
    const poll = window.setInterval(() => load().catch(() => {}), 10_000);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(poll);
    };
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const arrived = (a: Appt) =>
    run(async () => {
      await call(`/api/reception/visits/${a.visitId}/arrived`, { method: 'POST' });
      setToast({
        message: `${a.name} checked in for ${a.professional}`,
        until: Date.now() + 60_000, // clock-ok: WR-09 one-minute undo, shown as a countdown
        undo: () => run(() => call(`/api/reception/visits/${a.visitId}/undo-arrived`, { method: 'POST' })),
      });
    });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await run(async () => setImported(await call<ImportResult>('/api/reception/import', { csv: await f.text() })));
  }

  return (
    <>
      <TopBar subtitle={`Reception · updated ${updatedAt}`}>
        <Link className="btn" to="/staff/queue">Queues</Link>
      </TopBar>
      <main className="page" style={{ gap: 16 }}>
        <div className="row">
          <h1 className="h1" style={{ flexGrow: 1 }}>Today's appointments</h1>
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
          <button className="btn" onClick={() => file.current?.click()}>Import appointments file</button>
          <button className="btn primary" onClick={() => setWalkIn(true)}>Add walk-in</button>
        </div>

        {error && <Notice kind="error" role="alert" title="That did not work">{error}</Notice>}

        {imported && (
          <section className="card stack" role="status" aria-labelledby="imp-title" style={{ gap: 12 }}>
            <div className="row">
              <Icon name="check" color="#006B44" />
              <span id="imp-title" style={{ flexGrow: 1, fontWeight: 600, color: 'var(--text-strong)' }}>
                File imported: {imported.imported} appointments added{imported.skipped.length ? `, ${imported.skipped.length} ${imported.skipped.length === 1 ? 'row needs' : 'rows need'} a look` : ''}
              </span>
              <button className="btn icon" style={{ border: 0 }} aria-label="Close import result" onClick={() => setImported(null)}><Icon name="close" size={18} /></button>
            </div>
            <div className="row small" style={{ gap: 24, paddingLeft: 32 }}>
              <span><strong className="mono">{imported.imported}</strong> added</span>
              <span><strong className="mono">{imported.duplicates}</strong> already there, unchanged</span>
              <span><strong className="mono">{imported.cancelled}</strong> no longer in the file, cancelled</span>
              {imported.skipped.length > 0 && <span style={{ color: '#7A4F0E' }}><strong className="mono">{imported.skipped.length}</strong> skipped</span>}
            </div>
            {imported.skipped.length > 0 && (
              <ul className="small stack" style={{ margin: '0 0 0 32px', padding: '12px 16px', listStyle: 'none', background: 'var(--status-warning-surface)', borderRadius: 10, gap: 6 }}>
                {imported.skipped.map((s) => <li key={s.row}><strong>Row {s.row}:</strong> {s.reason}</li>)}
              </ul>
            )}
          </section>
        )}

        {failed.map((f) => (
          <section key={f.messageId} className="notice warning" role="alert" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ flex: '999 1 420px' }}><strong>Text not delivered:</strong> {f.name}'s {TEMPLATE[f.template] ?? f.template} to {f.phone}. {f.reason}</span>
            {fixing === f.messageId ? (
              <ResendForm onCancel={() => setFixing(null)} onSend={(phone) => run(async () => { await call(`/api/reception/messages/${f.messageId}/resend`, { body: { phone } }); setFixing(null); })} />
            ) : (
              <button className="btn" onClick={() => setFixing(f.messageId)}>Correct number and resend</button>
            )}
          </section>
        ))}

        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '999 1 360px' }}>
            <label htmlFor="search">Find a patient</label>
            <input id="search" type="search" placeholder="Name or phone number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="pro">Professional</label>
            <select id="pro" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All</option>
              {pros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <section className="card table-wrap" style={{ padding: 0 }} aria-label="Appointments">
          {!appts ? (
            <p className="muted" style={{ padding: 24 }} aria-busy="true">Loading…</p>
          ) : appts.length === 0 ? (
            <p style={{ padding: 24 }}>{q ? `No appointment today matches "${q}".` : 'No appointments today yet. Import the appointments file to start.'}</p>
          ) : (
            <table className="list" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Patient</th>
                  <th scope="col">Professional</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {appts.map((a) => (
                  <tr key={a.visitId}>
                    <td className={a.time ? 'mono' : 'muted'}>{a.time ?? 'Walk-in'}</td>
                    <td>
                      <span className="name">{a.name}</span>
                      {a.emergency && <span className="badge emergency" style={{ marginLeft: 8 }}>From emergency</span>}
                    </td>
                    <td>{a.professional}</td>
                    <td><StatusBadge a={a} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {a.status === 'booked' && <button className="btn primary" style={{ marginRight: 8 }} aria-label={`Mark ${a.name} as arrived`} onClick={() => arrived(a)}>Arrived</button>}
                      {a.status === 'missed' && <button className="btn" style={{ marginRight: 8 }} aria-label={`Return ${a.name} to the queue`} onClick={() => run(() => call(`/api/reception/visits/${a.visitId}/return`, { method: 'POST' }))}>Return to queue</button>}
                      <MoreMenu
                        label={`More actions for ${a.name}`}
                        items={[
                          { label: a.emergency ? 'Clear emergency flag' : 'Flag as coming from emergency', hidden: !['booked', 'arrived'].includes(a.status), onSelect: () => run(() => call(`/api/visits/${a.visitId}/emergency`, { body: { on: !a.emergency } })) },
                          { label: `Open ${a.professional}'s queue`, onSelect: () => (window.location.href = `/staff/queue?professionalId=${a.professionalId}`) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {walkIn && <WalkInDialog pros={pros} onClose={() => setWalkIn(false)} onAdded={async (name) => { setWalkIn(false); await load(); setToast({ message: `${name} added as a walk-in`, until: Date.now() + 6000 /* clock-ok */ }); }} />}
      {toast && (
        <UndoToast
          message={toast.message}
          until={toast.until}
          onUndo={toast.undo ? () => { void toast.undo!(); setToast(null); } : undefined}
          onDone={() => setToast(null)}
        />
      )}
    </>
  );
}

function ResendForm({ onSend, onCancel }: { onSend: (phone: string) => void; onCancel: () => void }) {
  const [phone, setPhone] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); onSend(phone); }}>
      <div className="field">
        <label htmlFor="fix-phone" className="sr-only">Correct phone number</label>
        <input id="fix-phone" type="tel" className="mono" placeholder="Correct number" value={phone} autoFocus onChange={(e) => setPhone(e.target.value)} />
      </div>
      <button className="btn primary" disabled={!phone}>Resend</button>
      <button type="button" className="btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function WalkInDialog({ pros, onClose, onAdded }: { pros: { id: string; name: string }[]; onClose: () => void; onAdded: (name: string) => void }) {
  const { call } = useStaff();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pro, setPro] = useState(pros[0]?.id ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Enter the patient's name so the professional can call them.";
    if (phone && phone.replace(/\D/g, '').length < 8) errs.phone = 'This does not look like a full phone number. Leave it empty if they have none.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await call('/api/reception/walk-ins', { body: { name, phone: phone || null, professionalId: pro } });
      onAdded(name.trim());
    } catch (err) {
      const msg = (err as Error).message;
      setErrors(/phone/i.test(msg) ? { phone: 'That phone number is not valid. Check it, or leave it empty.' } : { form: msg });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Add a walk-in" description="Checked in at once. Placed after patients whose appointment time has passed." onClose={onClose}>
      <form className="stack" style={{ gap: 18 }} onSubmit={submit} noValidate>
        {errors.form && <Notice kind="error" role="alert">{errors.form}</Notice>}
        <div className="field">
          <label htmlFor="wname">Patient's name</label>
          <input id="wname" type="text" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'wname-error' : undefined} />
          {errors.name && <span id="wname-error" className="error" role="alert">{errors.name}</span>}
        </div>
        <div className="field">
          <label htmlFor="wphone">Phone number <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          <input id="wphone" type="tel" className="mono" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'wphone-error' : 'wphone-hint'} />
          {errors.phone ? <span id="wphone-error" className="error" role="alert">{errors.phone}</span> : <span id="wphone-hint" className="hint">With a number, they get a visit link and can follow their wait.</span>}
        </div>
        <fieldset className="field" style={{ gap: 8 }}>
          <legend style={{ marginBottom: 8 }}>Sees</legend>
          {pros.map((p) => (
            <label key={p.id} className="choice">
              <input type="radio" name="pro" checked={pro === p.id} onChange={() => setPro(p.id)} />
              {p.name}
            </label>
          ))}
        </fieldset>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add walk-in'}</button>
        </div>
      </form>
    </Dialog>
  );
}
