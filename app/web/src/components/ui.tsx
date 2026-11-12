import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clinicTime } from '../api';

export function Icon({ name, size = 20, color = 'currentColor' }: { name: 'check' | 'alert' | 'bell' | 'refresh' | 'clock' | 'more' | 'close' | 'lock' | 'people'; size?: number; color?: string }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'check': return <svg {...p} strokeWidth={2.4}><path d="M20 6 9 17l-5-5" /></svg>;
    case 'alert': return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>;
    case 'bell': return <svg {...p}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
    case 'refresh': return <svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>;
    case 'clock': return <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>;
    case 'close': return <svg {...p}><path d="M18 6 6 18" /><path d="M6 6l12 12" /></svg>;
    case 'lock': return <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
    case 'people': return <svg {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case 'more': return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
  }
}

/** Seconds left until a deadline, ticking once a second. */
export function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now()); // clock-ok: UI countdown only
  useEffect(() => {
    if (!until) return;
    setNow(Date.now()); // clock-ok: start from the current time, not when the hook first mounted
    const t = window.setInterval(() => setNow(Date.now()), 500); // clock-ok
    return () => window.clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** A message with an Undo button that disappears when its time runs out (UX review: confirm every queue change). */
export function UndoToast({ message, until, onUndo, onDone }: { message: ReactNode; until: number; onUndo?: () => void; onDone: () => void }) {
  const left = useCountdown(until);
  useEffect(() => {
    if (left === 0) onDone();
  }, [left, onDone]);
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      {onUndo && <button className="btn on-dark" onClick={onUndo}>Undo · {left} s</button>}
    </div>
  );
}

export function Notice({ kind, title, children, action, role }: { kind: 'warning' | 'error' | 'dark' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <section className={`notice ${kind}`} role={role}>
      <span style={{ flexShrink: 0, marginTop: kind === 'dark' ? 0 : 2 }}>
        <Icon name={kind === 'success' ? 'check' : kind === 'dark' ? 'refresh' : 'alert'} color={kind === 'warning' ? '#7A4F0E' : kind === 'error' ? '#8E2D21' : kind === 'success' ? '#006B44' : '#fff'} />
      </span>
      <div className="stack" style={{ gap: 2, flexGrow: 1 }}>
        {title && <strong>{title}</strong>}
        {children && <span>{children}</span>}
      </div>
      {action}
    </section>
  );
}

/** Row menu: opens on click, closes on Escape or outside click, returns focus to its button. */
export function MoreMenu({ label, items }: { label: string; items: { label: string; onSelect: () => void; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('button')?.focus();
    const close = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== btn.current) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  return (
    <div className="menu-wrap">
      <button ref={btn} className="btn icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" size={18} color="#383C3A" />
      </button>
      {open && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              btn.current?.focus();
            }
          }}
        >
          {visible.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                i.onSelect();
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Modal dialog: focus moves in, Escape closes, focus returns to what opened it. */
export function Dialog({ title, description, onClose, children }: { title: string; description?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => opener?.focus();
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stack" style={{ flexGrow: 1, gap: 6 }}>
            <h1 id="dlg-title" className="h2" style={{ fontSize: 26 }}>{title}</h1>
            {description && <p className="small">{description}</p>}
          </div>
          <button className="btn icon" style={{ border: 0 }} aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function LiveChip({ status, updatedAt }: { status: 'connecting' | 'live' | 'reconnecting'; updatedAt?: Date | null }) {
  if (status === 'live') return <span className="live">Live</span>;
  return (
    <span className="live off" role="status">
      {status === 'connecting' ? 'Connecting…' : `Reconnecting… ${updatedAt ? `last updated ${clinicTime(updatedAt)}` : ''}`}
    </span>
  );
}
