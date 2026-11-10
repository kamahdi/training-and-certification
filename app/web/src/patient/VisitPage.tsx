import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { VisitView } from '../../../shared/live-events';
import { api, ApiError } from '../api';
import { Icon } from '../components/ui';
import { useLiveStream } from '../hooks/useLiveStream';

function Header({ clinic, dark }: { clinic?: string; dark?: boolean }) {
  return (
    <header className="row" style={{ minHeight: 48 }}>
      <span className="brand" style={dark ? { color: 'var(--text-on-dark)' } : undefined}>{clinic ?? ''}</span>
    </header>
  );
}

/** WR-02, WR-17, WR-18: the patient's visit page, live. Revised per the UX review. */
export function VisitPage() {
  const { token } = useParams();
  const [initial, setInitial] = useState<VisitView | null>(null);
  const [missing, setMissing] = useState(false);
  const poll = useCallback(() => api<VisitView>(`/api/visit/${token}`), [token]);

  useEffect(() => {
    poll().then(setInitial, (e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setInitial(null)));
  }, [poll]);

  const streamable = initial && initial.state !== 'not_open' && initial.state !== 'ended';
  const live = useLiveStream<VisitView>({
    url: streamable ? `/api/stream/visit/${token}` : null,
    events: ['estimate.updated', 'visit.ended'],
    poll,
    closeWhenHiddenMs: 5 * 60_000,
    onEvent: (ev) => ev === 'visit.ended' && setInitial({ state: 'ended' }),
  });

  // Not open yet: check again every minute until it opens.
  useEffect(() => {
    if (initial?.state !== 'not_open') return;
    const t = window.setInterval(() => poll().then(setInitial, () => {}), 60_000);
    return () => window.clearInterval(t);
  }, [initial?.state, poll]);

  const view = (streamable ? live.data : null) ?? initial;
  if (missing) return <Ended title="This link does not work" body="Check that you opened the whole link from your text message, or ask reception." />;
  if (!view) return <main className="phone white" aria-busy="true"><p className="muted">Loading your visit…</p></main>;
  if (view.state === 'ended') return <Ended title="This visit has ended" body="Visit links stop working 3 hours after the appointment, to keep your details private." />;
  if (view.state === 'not_open') {
    return (
      <main className="phone white">
        <Header />
        <div className="stack" style={{ gap: 12, marginTop: 40 }}>
          <Icon name="clock" size={40} color="#006B44" />
          <h1 className="h1">This page opens at {view.opensAt} on {view.opensOn}</h1>
          <p className="lead">From then on it shows when you will be called. Nothing to do until then.</p>
        </div>
      </main>
    );
  }
  if (view.state === 'called') return <Called view={view} />;

  const stale = streamable && live.status === 'reconnecting';
  return (
    <main className="phone">
      <Header clinic={view.clinicName} />
      {stale && (
        <section className="notice dark" role="status">
          <Icon name="refresh" color="#fff" />
          <div className="stack" style={{ gap: 2, flexGrow: 1 }}>
            <strong>Reconnecting…</strong>
            <span className="small" style={{ color: 'var(--text-on-dark-muted)' }}>Your time below may be out of date.</span>
          </div>
          <button className="btn on-dark" onClick={() => poll().then((v) => live.setData(v), () => {})}>Refresh</button>
        </section>
      )}
      <p className="muted" style={{ fontSize: 15 }}>
        {view.firstName} · {view.time ? `${view.date} at ${view.time}` : 'walk-in'} with {view.professional}
      </p>

      {view.state === 'booked' && (
        <section className="card big stack" style={{ gap: 12 }}>
          <h1 className="eyebrow">Your appointment</h1>
          <span className="big-time">{view.time}</span>
          <div className="divider stack" style={{ gap: 6 }}>
            <strong style={{ color: 'var(--text-strong)' }}>When you arrive, scan the code at the entrance</strong>
            <span className="small">{view.checkinOpensAt ? `Check-in opens at ${view.checkinOpensAt}.` : ''} No need to queue at the desk.</span>
            <Link className="btn primary large" to="/c" style={{ marginTop: 8 }}>I'm at the clinic</Link>
          </div>
        </section>
      )}

      {(view.state === 'waiting' || view.state === 'not_started') && (
        <section className={`card big stack ${stale ? 'dashed' : ''}`} style={{ gap: 14 }} aria-labelledby="est-title">
          <h1 id="est-title" className="eyebrow">{stale ? 'Last known time' : view.state === 'waiting' ? 'You will be called around' : 'Your appointment'}</h1>
          <div aria-live="polite" aria-atomic="true" className="stack" style={{ gap: 6 }}>
            <span className={`big-time ${stale ? 'stale' : ''}`}>{view.state === 'waiting' ? `${view.from}–${view.to}` : view.time ?? 'Soon'}</span>
            <span className="small muted">{view.state === 'not_started' ? "We'll update this once the clinic starts calling patients." : stale ? `Last updated ${view.updatedAt} · not live` : `Live · updated ${view.updatedAt}`}</span>
          </div>
          <div className="divider stack" style={{ gap: 4 }}>
            <strong style={{ fontSize: 16, color: 'var(--text-strong)' }}>Please stay in the waiting room</strong>
            <span className="small">{view.professional} will call your name. This page will tell you too.</span>
          </div>
        </section>
      )}

      {view.state === 'waiting' && view.slip && (
        <section className="notice warning" aria-label="Why your time changed">
          <Icon name="alert" color="#7A4F0E" />
          <div className="stack" style={{ gap: 4 }}>
            <strong>Your time moved later</strong>
            <span className="small">{view.slip.reason === 'emergency' ? 'A patient coming from emergency is being seen first.' : 'Consultations are running longer than planned.'}</span>
          </div>
        </section>
      )}

      {view.state === 'missed' && (
        <section className="notice warning" role="alert">
          <Icon name="alert" color="#7A4F0E" />
          <div className="stack" style={{ gap: 4 }}>
            <strong>We called you but could not find you</strong>
            <span className="small">Please go to reception so they can put you back in the queue.</span>
          </div>
        </section>
      )}

      <section className="card" aria-label="Your visit" style={{ padding: '4px 16px' }}>
        <div className="row" style={{ minHeight: 52, borderBottom: '1px solid var(--border-hairline)' }}>
          {view.checkedInAt ? <Icon name="check" color="#006B44" /> : <Icon name="clock" color="#6B7370" />}
          <span style={{ flexGrow: 1 }}>{view.checkedInAt ? `Checked in at ${view.checkedInAt}` : 'Not checked in yet'}</span>
        </div>
        <div className="row" style={{ minHeight: 52 }}>
          {view.formDone ? <Icon name="check" color="#006B44" /> : <Icon name="clock" color="#6B7370" />}
          <span style={{ flexGrow: 1 }}>{view.formDone ? 'Pre-visit form done' : 'Pre-visit form not done yet'}</span>
        </div>
      </section>
    </main>
  );
}

function Called({ view }: { view: Extract<VisitView, { state: 'called' }> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    navigator.vibrate?.([200, 100, 200]);
  }, []);
  return (
    <main className="phone dark" style={{ gap: 24 }}>
      <Header clinic={view.clinicName} dark />
      <div className="stack" style={{ gap: 24, marginTop: 48 }} role="alert">
        <span style={{ width: 72, height: 72, borderRadius: 999, background: 'var(--ethix-emerald)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" size={36} color="#fff" />
        </span>
        <h1 ref={heading} tabIndex={-1} className="h1" style={{ fontSize: 44, outline: 'none' }}>You're being called, {view.firstName}</h1>
        <p className="lead" style={{ fontSize: 18, color: 'var(--text-on-dark-muted)' }}>{view.professional} is ready for you. Please go to the consultation room now.</p>
      </div>
      {view.room && (
        <section style={{ background: 'rgba(255,255,255,.06)', border: '1px solid var(--border-on-dark)', borderRadius: 20, padding: 24 }} className="stack">
          <span className="eyebrow" style={{ color: 'var(--text-on-dark-muted)' }}>Go to</span>
          <span className="big-time" style={{ color: 'var(--text-on-dark)' }}>Room {view.room}</span>
          {view.calledAt && <span className="small" style={{ color: 'var(--text-on-dark-muted)' }}>Called at {view.calledAt}</span>}
        </section>
      )}
      <p className="small push-bottom" style={{ color: 'var(--text-on-dark-muted)' }}>Can't come right away? Tell reception so the doctor can see the next patient.</p>
    </main>
  );
}

function Ended({ title, body }: { title: string; body: string }) {
  return (
    <main className="phone white">
      <Header />
      <div className="stack" style={{ gap: 12, marginTop: 40 }}>
        <h1 className="h1">{title}</h1>
        <p className="lead">{body}</p>
      </div>
      <p className="small muted push-bottom">Have another appointment? Its own text message has its own link.</p>
    </main>
  );
}
