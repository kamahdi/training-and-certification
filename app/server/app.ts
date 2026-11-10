import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import { checkSession, type Staff } from './modules/auth/sessions.js';
import { AccessDenied, FormError } from './modules/privacy/form.js';
import { RightsError } from './modules/privacy/rights.js';
import { ConflictError, NotAllowedError } from './modules/queue/calls.js';
import { Hub } from './live/hub.js';
import { managerRoutes } from './routes/manager.js';
import { patientRoutes } from './routes/patient.js';
import { staffRoutes } from './routes/staff.js';

export interface Deps {
  db: pg.Pool;
  hub: Hub;
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: Staff;
  }
}

export const SESSION_COOKIE = 'wr_session';
export const DEVICE_COOKIE = 'wr_device';

/** Simple in-memory rate limit for check-in and code endpoints (architecture.md › Security). */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const key = `${req.ip}:${req.routeOptions.url}`;
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    list.push(now);
    hits.set(key, list);
    if (list.length > max) return reply.code(429).send({ error: 'too_many_requests' });
  };
}

export function requireStaff(deps: Deps, roles?: Staff['role'][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await checkSession(deps.db, req.cookies[SESSION_COOKIE]);
    if (!s.ok) return reply.code(401).send({ error: s.locked ? 'locked' : 'signed_out' });
    if (roles && !roles.includes(s.staff.role)) return reply.code(403).send({ error: 'forbidden' });
    req.staff = s.staff;
  };
}

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger
      ? {
          // Logs carry route patterns, never raw paths: a visit token must never reach a log (ADR-004).
          serializers: {
            req: (req) => ({ method: req.method, route: (req as any).routeOptions?.url ?? 'unknown' }),
            res: (res) => ({ statusCode: res.statusCode }),
          },
        }
      : false,
    trustProxy: true,
  });
  await app.register(cookie);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.reason });
    if (err instanceof NotAllowedError) return reply.code(400).send({ error: err.message });
    if (err instanceof AccessDenied) return reply.code(403).send({ error: err.message });
    if (err instanceof FormError || err instanceof RightsError) return reply.code(400).send({ error: err.message });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: err.message });
    app.log.error({ err: { message: err.message, stack: err.stack } }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  await app.register(async (r) => patientRoutes(r, deps));
  await app.register(async (r) => staffRoutes(r, deps));
  await app.register(async (r) => managerRoutes(r, deps));

  app.get('/api/health', async () => ({ ok: true }));

  // Serve the built React app in production, with client-side routing.
  const here = dirname(fileURLToPath(import.meta.url));
  const webDir = [join(here, '../../web'), join(here, '../dist/web')].find((d) => existsSync(join(d, 'index.html')));
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
