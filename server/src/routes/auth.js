import {
  verifyPassword, hashPassword, createSession, destroySession,
  destroyAllSessions, requireAuth, SESSION_COOKIE,
} from '../auth.js';
import { query } from '../db.js';
import { logEvent } from '../patients.js';

const SESSION_DAYS = 14;

export function cookieOptions() {
  return {
    httpOnly: true,
    /* Railway terminates TLS, so cookies are Secure everywhere but localhost. */
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    signed: true,
    maxAge: SESSION_DAYS * 86_400,
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
}

export default async function authRoutes(app) {
  app.post('/api/auth/login', {
    config: {
      /* Brute force protection: this is the one endpoint worth hammering. */
      rateLimit: { max: 10, timeWindow: '5 minutes' },
    },
  }, async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'E-mail și parolă sunt obligatorii.' });
    }

    const { rows } = await query(
      'select * from accounts where lower(email) = lower($1)', [String(email).trim()]);
    const account = rows[0];

    /* Verify even when the account is missing, against a throwaway hash, so a
       wrong e-mail and a wrong password take the same amount of time. */
    const ok = account
      ? await verifyPassword(password, account.password_hash)
      : await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

    if (!account || !ok) {
      return reply.code(401).send({ error: 'E-mail sau parolă greșită.' });
    }

    const session = await createSession(account.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });

    await query('update accounts set last_login_at = now() where id = $1', [account.id]);
    if (account.patient_id) {
      await logEvent(account.patient_id, 'pacient', 'Autentificare în portal');
    }

    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions());
    return {
      email: account.email,
      role: account.role,
      patientId: account.patient_id,
      mustChangePassword: account.must_change_password,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.session) await destroySession(request.session.session_id);
    reply.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ok: true };
  });

  app.get('/api/auth/session', async (request) => {
    if (!request.session) return { authenticated: false };
    return {
      authenticated: true,
      email: request.session.email,
      role: request.session.role,
      patientId: request.session.patient_id,
      mustChangePassword: request.session.must_change_password,
    };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body ?? {};

    if (!newPassword || String(newPassword).length < 10) {
      return reply.code(400).send({ error: 'Parola nouă trebuie să aibă cel puțin 10 caractere.' });
    }

    const { rows } = await query('select * from accounts where id = $1',
      [request.session.account_id]);
    const account = rows[0];

    /* An account still on its issued password may set a new one without
       repeating it; everyone else must prove they know the current one. */
    if (!account.must_change_password) {
      if (!currentPassword || !await verifyPassword(currentPassword, account.password_hash)) {
        return reply.code(403).send({ error: 'Parola curentă este greșită.' });
      }
    }

    await query(
      'update accounts set password_hash = $1, must_change_password = false where id = $2',
      [await hashPassword(String(newPassword)), account.id]);

    if (account.patient_id) {
      await logEvent(account.patient_id, 'pacient', 'Și-a schimbat parola');
    }

    /* Every other device is signed out, then this one is signed back in. */
    await destroyAllSessions(account.id);
    const session = await createSession(account.id, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions());

    return { ok: true };
  });
}
