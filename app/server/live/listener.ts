import pg from 'pg';
import { config } from '../config.js';

export interface Notification {
  professionalId: string | null;
  visitIds: string[];
  eventId: number;
}

/**
 * One dedicated connection, outside the pool, that LISTENs on clinic_updates.
 * Reconnects with backoff (1, 2, 4 … 30 s) and calls onReconnect so every open stream gets a fresh snapshot.
 */
export class Listener {
  private client: pg.Client | null = null;
  private stopped = false;
  private delay = 1000;

  constructor(
    private onNotify: (n: Notification) => void,
    private onReconnect: () => void,
    private connectionString = config.databaseUrl,
  ) {}

  async start() {
    this.stopped = false;
    await this.connect(false);
  }

  private async connect(isReconnect: boolean) {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      try {
        this.onNotify(JSON.parse(msg.payload ?? '{}'));
      } catch {
        /* ignore malformed payloads */
      }
    });
    client.on('error', () => this.scheduleReconnect());
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query('LISTEN clinic_updates');
    this.client = client;
    this.delay = 1000;
    if (isReconnect) this.onReconnect();
  }

  private reconnecting = false;
  private scheduleReconnect() {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.client = null;
    const wait = this.delay;
    this.delay = Math.min(this.delay * 2, 30_000);
    setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect(true);
      } catch {
        this.scheduleReconnect();
      }
    }, wait);
  }

  /** Tests: drop the connection as if the network failed. */
  async simulateDrop() {
    const c = this.client;
    if (c) await c.end().catch(() => {});
  }

  async stop() {
    this.stopped = true;
    if (this.client) await this.client.end().catch(() => {});
    this.client = null;
  }
}
