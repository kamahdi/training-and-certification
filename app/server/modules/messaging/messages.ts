import type { PoolClient } from 'pg';
import { clock } from '../../clock.js';
import { config } from '../../config.js';
import { linkToken } from '../../crypto.js';
import type { Db } from '../../db/pool.js';
import { write, type VisitRef } from '../../events.js';
import { enqueue } from '../../jobs.js';
import { getProvider, ProviderError } from './provider.js';
import { render, type TemplateName, type TemplateVars } from './templates.js';

const REDACTED = { visitUrl: '[visit link]', formUrl: '[form link]', code: '••••' };

export function visitUrl(visitId: string) {
  return `${config.publicUrl}/v/${linkToken(visitId, 'visit')}`;
}
export function formUrl(visitId: string) {
  return `${config.publicUrl}/f/${linkToken(visitId, 'form')}`;
}

async function visitRef(c: Db, visitId: string | null): Promise<VisitRef | null> {
  if (!visitId) return null;
  const r = await c.query('SELECT id, trail_id, professional_id, day FROM visit WHERE id = $1', [visitId]);
  return r.rows[0] ?? null;
}

/**
 * Queue a text for a visit. Links are added at send time; the stored body has them redacted,
 * so the database never holds a usable link token.
 */
export async function queueText(
  c: PoolClient,
  opts: { visitId: string; to: string; template: TemplateName; vars: TemplateVars; language: string; dedupeKey?: string; runAt?: Date },
): Promise<string | null> {
  const body = render(opts.template, { ...opts.vars, ...REDACTED }, opts.language);
  const m = await c.query(
    `INSERT INTO message (visit_id, to_phone, template, language, body, vars, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [opts.visitId, opts.to, opts.template, opts.language, body, opts.vars, clock.now()],
  );
  const messageId = m.rows[0].id;
  const queued = await enqueue(c, 'send_message', { messageId }, { runAt: opts.runAt, dedupeKey: opts.dedupeKey, visitId: opts.visitId });
  if (!queued) {
    await c.query('DELETE FROM message WHERE id = $1', [messageId]);
    return null;
  }
  return messageId;
}

/** Job handler: render with real links and send. */
export async function sendMessageJob(payload: { messageId: string }, c: PoolClient) {
  const r = await c.query('SELECT * FROM message WHERE id = $1 FOR UPDATE', [payload.messageId]);
  const msg = r.rows[0];
  if (!msg || msg.status !== 'queued') return;
  const visit = await visitRef(c, msg.visit_id);
  const vs = visit ? (await c.query('SELECT status FROM visit WHERE id = $1', [visit.id])).rows[0] : null;
  if (!visit || vs?.status === 'cancelled') {
    await c.query("UPDATE message SET status = 'cancelled' WHERE id = $1", [msg.id]);
    return;
  }
  const body = render(msg.template, { ...msg.vars, visitUrl: visitUrl(visit.id), formUrl: formUrl(visit.id) }, msg.language);
  try {
    const res = await getProvider().send(msg.to_phone, body);
    const status = res.delivered ? 'delivered' : 'sent';
    await c.query('UPDATE message SET status = $2, provider_id = $3, sent_at = $4 WHERE id = $1', [msg.id, status, res.providerId, clock.now()]);
    await write(c, { type: 'message_sent', actor: 'worker', visit, details: { template: msg.template } });
    if (res.delivered) await write(c, { type: 'message_delivered', actor: 'provider', visit, details: { template: msg.template } });
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e; // retried by the job runner
    await c.query("UPDATE message SET status = 'failed', error = $2 WHERE id = $1", [msg.id, e.message]);
    await write(c, { type: 'message_failed', actor: 'worker', visit, details: { template: msg.template, reason: e.message } });
  }
}

/** Delivery report from the provider (webhook). */
export async function recordDelivery(c: PoolClient, providerId: string, delivered: boolean, reason?: string) {
  const r = await c.query('SELECT * FROM message WHERE provider_id = $1 FOR UPDATE', [providerId]);
  const msg = r.rows[0];
  if (!msg) return false;
  const visit = await visitRef(c, msg.visit_id);
  if (delivered) {
    await c.query("UPDATE message SET status = 'delivered' WHERE id = $1", [msg.id]);
    await write(c, { type: 'message_delivered', actor: 'provider', visit, details: { template: msg.template } });
  } else {
    await c.query("UPDATE message SET status = 'failed', error = $2 WHERE id = $1", [msg.id, reason ?? 'not delivered']);
    await write(c, { type: 'message_failed', actor: 'provider', visit, details: { template: msg.template, reason } });
  }
  return true;
}

/**
 * Send a code at once (check-in or export). The code is never stored in clear:
 * the message row keeps a redacted body.
 */
export async function sendCodeNow(
  c: PoolClient,
  opts: { to: string; template: 'checkin_code' | 'export_code'; vars: TemplateVars; language: string; visitId?: string | null },
): Promise<boolean> {
  const body = render(opts.template, { ...opts.vars, ...REDACTED }, opts.language);
  const visit = await visitRef(c, opts.visitId ?? null);
  const m = await c.query(
    `INSERT INTO message (visit_id, to_phone, template, language, body, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [opts.visitId ?? null, opts.to, opts.template, opts.language, body, clock.now()],
  );
  try {
    const res = await getProvider().send(opts.to, render(opts.template, opts.vars, opts.language));
    await c.query("UPDATE message SET status = $2, provider_id = $3, sent_at = $4 WHERE id = $1", [m.rows[0].id, res.delivered ? 'delivered' : 'sent', res.providerId, clock.now()]);
    await write(c, { type: 'message_sent', actor: 'system', visit, details: { template: opts.template } });
    return true;
  } catch (e) {
    await c.query("UPDATE message SET status = 'failed', error = $2 WHERE id = $1", [m.rows[0].id, String((e as Error).message)]);
    await write(c, { type: 'message_failed', actor: 'system', visit, details: { template: opts.template } });
    return false;
  }
}
