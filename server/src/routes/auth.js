import {
  verifyPassword, hashPassword, createSession, destroySession,
  destroyAllSessions, requireAuth, SESSION_COOKIE, generateReferralCode,
} from '../auth.js';
import { query, transaction } from '../db.js';
import { logEvent, initialsFor } from '../patients.js';

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

  /* Self-service signup, as an alternative to a staff-created account.
     Unlike POST /api/admin/patients, gdpr_accepted is set right here — the
     patient is the one ticking the box, as part of their own unauthenticated
     signup request. That is still "the patient's own act", just captured a
     moment earlier than a session exists rather than through POST /api/me/gdpr,
     so a self-registered patient skips the post-login GDPR gate entirely. An
     admin filling in the same fields on someone else's behalf is never the
     patient consenting, which is why that endpoint still cannot touch it. */
  app.post('/api/auth/register', {
    config: {
      rateLimit: { max: 10, timeWindow: '5 minutes' },
    },
  }, async (request, reply) => {
    const { name, email, phone, sex, password, gdprConsent, mediaConsent } = request.body ?? {};

    if (!name || !String(name).trim()) {
      return reply.code(400).send({ error: 'Numele este obligatoriu.' });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
      return reply.code(400).send({ error: 'Adresa de e-mail nu este validă.' });
    }
    if (!password || String(password).length < 8) {
      return reply.code(400).send({ error: 'Parola trebuie să aibă cel puțin 8 caractere.' });
    }
    if (sex && !['f', 'm'].includes(sex)) {
      return reply.code(400).send({ error: 'Sexul trebuie să fie „f” sau „m”.' });
    }
    if (gdprConsent !== true) {
      return reply.code(400).send({ error: 'Trebuie să confirmi informarea GDPR pentru a-ți crea contul.' });
    }
    /* Media consent is optional in substance (either answer is fine) but
       mandatory in form — the registration form forces an explicit DA/NU,
       never a silent default, so the same is enforced here. */
    if (typeof mediaConsent !== 'boolean') {
      return reply.code(400).send({ error: 'Alege DA sau NU pentru fotografii/video/testimoniale.' });
    }

    const existing = await query('select 1 from accounts where lower(email) = lower($1)',
      [String(email).trim()]);
    if (existing.rowCount > 0) {
      return reply.code(409).send({ error: 'Există deja un cont cu acest e-mail.' });
    }

    const passwordHash = await hashPassword(String(password));

    let accountId;
    try {
      accountId = await transaction(async (client) => {
        let patient;
        for (let attempt = 0; attempt < 5 && !patient; attempt += 1) {
          try {
            const res = await client.query(
              `insert into patients (name, initials, email, phone, sex, referral_code,
                                     gdpr_accepted, gdpr_accepted_at,
                                     media_consent, media_consent_at)
               values ($1, $2, $3, $4, $5, $6, true, now(), $7, now()) returning id`,
              [String(name).trim(), initialsFor(name), String(email).trim(),
                phone ?? '', sex ?? 'f', generateReferralCode(name), mediaConsent]);
            patient = res.rows[0];
          } catch (err) {
            if (err.constraint !== 'patients_referral_code_key') throw err;
          }
        }
        if (!patient) throw new Error('Could not allocate a unique referral code.');

        const acct = await client.query(
          `insert into accounts (email, password_hash, role, patient_id, must_change_password)
           values ($1, $2, 'patient', $3, false) returning id`,
          [String(email).trim(), passwordHash, patient.id]);

        await client.query(
          'insert into activity_log (patient_id, who, what) values ($1, $2, $3)',
          [patient.id, 'pacient',
            'Cont creat prin auto-înregistrare — acord GDPR acceptat; fotografii/video/testimoniale: ' +
              (mediaConsent ? 'DA' : 'NU')]);

        return acct.rows[0].id;
      });
    } catch (err) {
      request.log.error({ err }, 'failed to self-register patient');
      return reply.code(500).send({ error: 'Contul nu a putut fi creat.' });
    }

    const session = await createSession(accountId, {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    });
    reply.setCookie(SESSION_COOKIE, session.id, cookieOptions());

    const { rows } = await query(
      'select email, role, patient_id, must_change_password from accounts where id = $1', [accountId]);
    return reply.code(201).send({
      email: rows[0].email,
      role: rows[0].role,
      patientId: rows[0].patient_id,
      mustChangePassword: rows[0].must_change_password,
    });
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
