/** Time-zone helpers built on Intl, so they need no clock of their own. */

const partsCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

function parts(d: Date, tz: string) {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  return p;
}

/** 'YYYY-MM-DD' of the instant in the given zone. */
export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'H:MM' of the instant in the given zone, e.g. '9:45' or '10:15'. */
export function localTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${Number(p.hour)}:${p.minute}`;
}

/** Minutes since local midnight. */
export function localMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

function offsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

/** The instant for a local date and time in the zone ('2026-11-12', '10:15'). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, da] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let off = offsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = offsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

/** Add days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Round an instant to the nearest 5 minutes (half up). */
export function roundTo5(d: Date): Date {
  const step = 5 * 60000;
  return new Date(Math.round(d.getTime() / step) * step);
}

/** Round an instant down to 5 minutes. */
export function floorTo5(d: Date): Date {
  const step = 5 * 60000;
  return new Date(Math.floor(d.getTime() / step) * step);
}
