import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Icon } from '../components/ui';

export interface Staff {
  id: string;
  name: string;
  email: string;
  role: 'professional' | 'reception' | 'manager';
  room: string | null;
}

interface Ctx {
  staff: Staff;
  /** Call an API; a 401 shows the lock or sign-in screen instead of an error. */
  call: <T = any>(path: string, opts?: Parameters<typeof api>[1]) => Promise<T>;
  lock: () => void;
  signOut: () => Promise<void>;
}
const StaffContext = createContext<Ctx | null>(null);
export const useStaff = () => useContext(StaffContext)!;

const HOME: Record<Staff['role'], string> = { professional: '/staff/queue', reception: '/staff/reception', manager: '/staff/manager' };
const LAST = 'wr_last_staff';

function remembered(): { name: string; email: string } | null {
  try {
    return JSON.parse(sessionStorage.getItem(LAST) ?? 'null');
  } catch {
    return null;
  }
}

/** Signs staff in, shows the lock screen after the 15-minute idle lock (WR-11), and sends each role to its screen. */
export function StaffShell({ role, children }: { role?: Staff['role'][]; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'signed_out' | 'locked' | 'active'>('loading');
  const [staff, setStaff] = useState<Staff | null>(null);

  useEffect(() => {
    api<{ staff: Staff }>('/api/staff/me').then(
      (r) => {
        setStaff(r.staff);
        setState('active');
      },
      (e) => setState(e instanceof ApiError && e.body?.error === 'locked' ? 'locked' : 'signed_out'),
    );
  }, []);

  const call = useCallback(async <T,>(path: string, opts?: Parameters<typeof api>[1]) => {
    try {
      return await api<T>(path, opts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState(e.body?.error === 'locked' ? 'locked' : 'signed_out');
      throw e;
    }
  }, []);

  const onSignedIn = (s: Staff) => {
    try {
      sessionStorage.setItem(LAST, JSON.stringify({ name: s.name, email: s.email }));
    } catch {
      /* storage may be blocked */
    }
    setStaff(s);
    setState('active');
  };

  if (state === 'loading') return <main className="page" aria-busy="true"><p className="muted">Loading…</p></main>;
  if (state === 'signed_out') return <LoginScreen onSignedIn={onSignedIn} />;
  if (state === 'locked') return <LockScreen onSignedIn={onSignedIn} onSignOut={() => setState('signed_out')} />;
  if (role && staff && !role.includes(staff.role)) return <Navigate to={HOME[staff.role]} replace />;

  return (
    <StaffContext.Provider
      value={{
        staff: staff!,
        call,
        lock: () => setState('locked'),
        signOut: async () => {
          await api('/api/staff/logout', { method: 'POST' }).catch(() => {});
          setState('signed_out');
        },
      }}
    >
      {children}
    </StaffContext.Provider>
  );
}

export function TopBar({ subtitle, children }: { subtitle: string; children?: ReactNode }) {
  const { signOut } = useStaff();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <span className="brand">Clinic Waiting Room</span>
        <span className="muted" style={{ fontSize: 15 }}>{subtitle}</span>
        <span className="spacer" />
        {children}
        <button className="btn" onClick={signOut}>Sign out</button>
      </div>
    </header>
  );
}

function LoginScreen({ onSignedIn }: { onSignedIn: (s: Staff) => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState(remembered()?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errRef = useRef<HTMLSpanElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ staff: Staff }>('/api/staff/login', { body: { email, password } });
      onSignedIn(r.staff);
      if (loc.pathname === '/staff' || loc.pathname === '/staff/') nav(HOME[r.staff.role], { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'That email and password do not match. Check them and try again.' : (err as Error).message);
      setTimeout(() => errRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page" style={{ alignItems: 'center', paddingTop: 80 }}>
      <form className="card big stack" style={{ width: '100%', maxWidth: 440, gap: 20 }} onSubmit={submit} noValidate>
        <h1 className="h1" style={{ fontSize: 26 }}>Staff sign-in</h1>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'login-error' : undefined} />
          {error && <span id="login-error" ref={errRef} tabIndex={-1} className="error" role="alert">{error}</span>}
        </div>
        <button className="btn primary large" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function LockScreen({ onSignedIn, onSignOut }: { onSignedIn: (s: Staff) => void; onSignOut: () => void }) {
  const who = remembered();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!who) return <LoginScreen onSignedIn={onSignedIn} />;
  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ staff: Staff }>('/api/staff/login', { body: { email: who!.email, password } });
      onSignedIn(r.staff);
    } catch {
      setError('That password is not right. Try again, or sign out.');
    }
  }
  return (
    <main className="page" style={{ alignItems: 'center', paddingTop: 80 }}>
      <form className="card big stack" style={{ width: '100%', maxWidth: 440, gap: 20 }} onSubmit={unlock} aria-labelledby="lock-title">
        <Icon name="lock" size={36} color="#006B44" />
        <div className="stack">
          <h1 id="lock-title" className="h1" style={{ fontSize: 26 }}>Screen locked</h1>
          <p className="small">Nothing happened here for 15 minutes, so patient details are hidden. The queue keeps running for patients.</p>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="small muted">Signed in as</span>
          <strong style={{ color: 'var(--text-strong)' }}>{who.name}</strong>
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'lock-error' : undefined} />
          {error && <span id="lock-error" className="error" role="alert">{error}</span>}
        </div>
        <button className="btn primary large">Unlock</button>
        <button type="button" className="btn link" style={{ alignSelf: 'center', minHeight: 44 }} onClick={onSignOut}>Not {who.name}? Sign out</button>
      </form>
    </main>
  );
}

export function StaffHome() {
  return (
    <StaffShell>
      <RoleRedirect />
    </StaffShell>
  );
}
function RoleRedirect() {
  const { staff } = useStaff();
  return <Navigate to={HOME[staff.role]} replace />;
}
