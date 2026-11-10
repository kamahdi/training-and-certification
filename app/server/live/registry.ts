import type { ServerResponse } from 'node:http';

export interface Stream {
  res: ServerResponse;
  key: string; // professional id or visit id
  kind: 'staff' | 'visit';
  openedAt: number;
  sessionToken?: string;
  /** For visit streams: whose queue this patient is in. */
  professionalId?: string;
}

const LIMITS = { staff: 5, visit: 3 };

/** Open streams by professional and by visit (ADR-002 solution design, section 4). */
export class Registry {
  private byKey = new Map<string, Set<Stream>>();
  private byOwner = new Map<string, Stream[]>();

  add(s: Stream, owner: string) {
    const k = `${s.kind}:${s.key}`;
    if (!this.byKey.has(k)) this.byKey.set(k, new Set());
    this.byKey.get(k)!.add(s);
    // Limits: 3 open streams per visit and 5 per staff user; the oldest is closed.
    const list = this.byOwner.get(owner) ?? [];
    list.push(s);
    while (list.length > LIMITS[s.kind]) {
      const old = list.shift()!;
      this.remove(old);
      old.res.end();
    }
    this.byOwner.set(owner, list);
  }

  remove(s: Stream) {
    this.byKey.get(`${s.kind}:${s.key}`)?.delete(s);
    for (const [owner, list] of this.byOwner) {
      const i = list.indexOf(s);
      if (i >= 0) {
        list.splice(i, 1);
        if (!list.length) this.byOwner.delete(owner);
      }
    }
  }

  get(kind: 'staff' | 'visit', key: string): Stream[] {
    return [...(this.byKey.get(`${kind}:${key}`) ?? [])];
  }

  all(): Stream[] {
    return [...this.byKey.values()].flatMap((s) => [...s]);
  }

  keys(kind: 'staff' | 'visit'): string[] {
    return [...this.byKey.entries()].filter(([k, v]) => k.startsWith(`${kind}:`) && v.size).map(([k]) => k.slice(kind.length + 1));
  }
}

export function send(res: ServerResponse, event: string, data: unknown, id?: number | string) {
  let msg = '';
  if (id !== undefined) msg += `id: ${id}\n`;
  msg += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  res.write(msg);
}
