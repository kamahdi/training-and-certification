import type { ServerResponse } from 'node:http';
import type { Db } from '../db/pool.js';
import { getClinic } from '../settings.js';
import { sessionIdleMs } from '../modules/auth/sessions.js';
import { Listener, type Notification } from './listener.js';
import { Registry, send, type Stream } from './registry.js';
import { staffSnapshot, visitSnapshot } from './snapshots.js';

const HEARTBEAT_MS = 20_000;
const MERGE_MS = 250;

/**
 * Live updates (ADR-002 solution design): one LISTEN connection per process, an in-memory registry,
 * a 250 ms merge window per professional, full snapshots on every change and on every (re)connect.
 */
export class Hub {
  registry = new Registry();
  listener: Listener;
  private pendingStaff = new Map<string, NodeJS.Timeout>();
  private pendingVisits = new Map<string, NodeJS.Timeout>();
  private heartbeat: NodeJS.Timeout | null = null;
  private lastEventId = 0;

  constructor(private db: Db, connectionString?: string) {
    this.listener = new Listener((n) => this.onNotify(n), () => this.refreshAll(), connectionString);
  }

  async start() {
    await this.listener.start();
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const t of [...this.pendingStaff.values(), ...this.pendingVisits.values()]) clearTimeout(t);
    for (const s of this.registry.all()) s.res.end();
    await this.listener.stop();
  }

  private onNotify(n: Notification) {
    this.lastEventId = Math.max(this.lastEventId, n.eventId ?? 0);
    if (n.professionalId) {
      this.schedule(this.pendingStaff, n.professionalId, () => this.pushStaff(n.professionalId!));
    }
    for (const v of n.visitIds ?? []) this.schedule(this.pendingVisits, v, () => this.pushVisit(v));
    // Queue changes move everyone's estimate: refresh every open visit page of that professional.
    if (n.professionalId) {
      for (const s of this.registry.all()) {
        if (s.kind === 'visit' && s.professionalId === n.professionalId) this.schedule(this.pendingVisits, s.key, () => this.pushVisit(s.key));
      }
    }
  }

  private schedule(map: Map<string, NodeJS.Timeout>, key: string, fn: () => Promise<void>) {
    if (map.has(key)) return;
    map.set(
      key,
      setTimeout(() => {
        map.delete(key);
        fn().catch(() => {});
      }, MERGE_MS),
    );
  }

  async pushStaff(professionalId: string) {
    const streams = this.registry.get('staff', professionalId);
    if (!streams.length) return;
    const snap = await staffSnapshot(this.db, professionalId);
    for (const s of streams) send(s.res, 'queue.updated', snap, this.lastEventId || undefined);
  }

  async pushVisit(visitId: string) {
    const streams = this.registry.get('visit', visitId);
    if (!streams.length) return;
    const view = await visitSnapshot(this.db, visitId);
    for (const s of streams) {
      if (view.state === 'ended') {
        send(s.res, 'visit.ended', {});
        this.registry.remove(s);
        s.res.end();
      } else {
        send(s.res, 'estimate.updated', view, this.lastEventId || undefined);
      }
    }
  }

  /** After a dropped LISTEN connection: fresh snapshots on every open stream. */
  async refreshAll() {
    for (const p of this.registry.keys('staff')) await this.pushStaff(p).catch(() => {});
    for (const v of this.registry.keys('visit')) await this.pushVisit(v).catch(() => {});
  }

  private async beat() {
    const clinic = await getClinic(this.db).catch(() => null);
    for (const s of this.registry.all()) {
      s.res.write(': ping\n\n');
      // WR-11: a stream whose session hit the idle lock is told and closed.
      if (s.kind === 'staff' && s.sessionToken && clinic) {
        const idle = await sessionIdleMs(this.db, s.sessionToken);
        if (idle === null || idle > clinic.idle_lock_minutes * 60000) {
          send(s.res, 'session.locked', {});
          this.registry.remove(s);
          s.res.end();
        }
      }
    }
  }

  /** Open a stream: headers, retry hint, the current snapshot at once. */
  async open(res: ServerResponse, stream: Omit<Stream, 'res' | 'openedAt'>, owner: string, lastEventId?: string) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    const s: Stream = { ...stream, res, openedAt: Date.now() }; // clock-ok: stream age
    this.registry.add(s, owner);
    res.on('close', () => this.registry.remove(s));
    void lastEventId; // logged only: snapshots are complete, nothing is replayed
    if (s.kind === 'staff') await this.pushStaff(s.key);
    else await this.pushVisit(s.key);
  }
}
