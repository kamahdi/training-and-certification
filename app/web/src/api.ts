import { localTime } from '../../shared/time';

/** Times on staff and patient screens are clinic time, never the browser's own time zone. */
let clinicTimeZone = 'Europe/Brussels'; // the default until /api/clinic answers with the clinic's setting
export function loadClinicTimeZone() {
  return api<{ timeZone?: string }>('/api/clinic').then((c) => { if (c.timeZone) clinicTimeZone = c.timeZone; }, () => {});
}
/** 'H:MM' in clinic time, e.g. '12:47'. */
export function clinicTime(d: Date): string {
  return localTime(d, clinicTimeZone);
}

/** Small fetch wrapper: JSON in, JSON out, errors carry the server's message. */
export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(body?.error ?? `Request failed (${status})`);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; csv?: string } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.csv !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers: {} };
  if (opts.csv !== undefined) {
    (init.headers as any)['content-type'] = 'text/csv';
    init.body = opts.csv;
  } else if (opts.body !== undefined) {
    (init.headers as any)['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, { error: 'No connection. Check your network and try again.' });
  }
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export async function download(path: string, body: unknown, filename: string) {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
