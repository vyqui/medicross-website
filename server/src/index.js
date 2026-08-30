import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';

import { pool } from './db.js';
import { migrate } from './migrate.js';
import { loadSession, purgeExpiredSessions, SESSION_COOKIE } from './auth.js';
import * as storage from './storage.js';

import authRoutes from './routes/auth.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';
import documentRoutes from './routes/documents.js';
import publicRoutes from './routes/public.js';

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters. See .env.example.');
}

const app = Fastify({
  logger: isProduction
    ? { level: 'info' }
    : { level: 'info', transport: undefined },
  /* Railway sits behind a proxy, so the client IP the rate limiter sees has to
     come from the forwarded header rather than the socket. */
  trustProxy: true,
  bodyLimit: 1024 * 1024,
});

await app.register(cookie, { secret: process.env.SESSION_SECRET });

await app.register(cors, {
  origin(origin, cb) {
    /* Same-origin requests and curl send no Origin header at all. */
    if (!origin) return cb(null, true);
    const allowed = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    cb(null, allowed.includes(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
});

await app.register(rateLimit, {
  global: false,
  max: 300,
  timeWindow: '1 minute',
});

await app.register(multipart, {
  limits: { fileSize: storage.MAX_UPLOAD_BYTES, files: 1 },
});

/* Resolves the signed session cookie into request.session for every route.
   A cookie that fails signature verification is treated as absent. */
app.decorateRequest('session', null);
app.addHook('onRequest', async (request) => {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  request.session = await loadSession(unsigned.value);
});

app.get('/health', async () => {
  await pool.query('select 1');
  return { ok: true };
});

await app.register(authRoutes);
await app.register(publicRoutes);
await app.register(documentRoutes);
await app.register(portalRoutes);
await app.register(adminRoutes);

/* The platform serves the portal's own pages — login.html, register.html,
   portal.html, admin.html — plus exactly the assets they use, copied into
   server/public/ (see server/README.md for the exact file list). This
   directory travels with the server everywhere it deploys, whereas the
   repository root does not: Railway's Root Directory setting means only
   server/ itself is ever present in the deployed container. */
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(import.meta.dirname, '..', 'public'));
await app.register(fastifyStatic, { root: STATIC_DIR, extensions: ['html'] });

/* There is no marketing homepage here — that lives on the main domain. The
   platform's own front door is the sign-in page. */
app.get('/', (request, reply) => reply.redirect('/login'));

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Rută inexistentă.' });
  }
  return reply.code(404).type('text/html; charset=utf-8').send('<h1>404</h1><p>Pagina nu există.</p>');
});

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, 'request failed');
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  /* Never leak an internal message to the client on a 500. */
  reply.code(status).send({
    error: status >= 500 ? 'Eroare internă. Încearcă din nou.' : (error.message || 'Cerere invalidă.'),
  });
});

await storage.init();
const applied = await migrate({ log: app.log });
if (applied > 0) app.log.info(`applied ${applied} migration(s)`);

/* Expired rows are dead weight and, for sessions, a liability. */
const sweeper = setInterval(() => {
  purgeExpiredSessions().catch((err) => app.log.error({ err }, 'session sweep failed'));
}, 6 * 60 * 60 * 1000);
sweeper.unref();

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
