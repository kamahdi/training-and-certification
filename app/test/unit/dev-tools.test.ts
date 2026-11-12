import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clinicTime, loadClinicTimeZone } from '../../web/src/api';
import { devOutbox, fakeProvider, sentByFake } from '../../server/modules/messaging/provider.js';

describe('clinic time on screens', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('times are shown in clinic time, whatever the browser time zone', async () => {
    const at = new Date('2026-11-12T11:47:00Z');
    expect(clinicTime(at)).toBe('12:47'); // Brussels by default, not UTC
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ timeZone: 'Europe/Lisbon' }), { headers: { 'content-type': 'application/json' } }));
    await loadClinicTimeZone();
    expect(clinicTime(at)).toBe('11:47'); // the clinic's own setting wins
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ timeZone: 'Europe/Brussels' }), { headers: { 'content-type': 'application/json' } }));
    await loadClinicTimeZone();
  });
});

describe('development outbox', () => {
  const saved = { VITEST: process.env.VITEST, DEV_OUTBOX_FILE: process.env.DEV_OUTBOX_FILE };
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'outbox-'));
    delete process.env.VITEST; // act like the dev server and worker, which share the file
    process.env.DEV_OUTBOX_FILE = join(dir, 'outbox.jsonl');
  });
  afterEach(() => {
    process.env.VITEST = saved.VITEST;
    if (saved.DEV_OUTBOX_FILE === undefined) delete process.env.DEV_OUTBOX_FILE;
    else process.env.DEV_OUTBOX_FILE = saved.DEV_OUTBOX_FILE;
    sentByFake.length = 0;
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows texts sent by another process, such as the worker', async () => {
    expect(devOutbox()).toEqual([]);
    await fakeProvider.send('+32470112203', 'Demo Clinic: your visit link /v/abc');
    sentByFake.length = 0; // the reading process did not send it itself
    expect(devOutbox()).toMatchObject([{ to: '+32470112203', body: 'Demo Clinic: your visit link /v/abc' }]);
  });

  it('is off in production', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await fakeProvider.send('+32470112203', 'x');
      expect(existsSync(process.env.DEV_OUTBOX_FILE!)).toBe(false); // nothing with links or codes is written to disk
      expect(devOutbox()).toEqual(sentByFake.slice(-50));
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
