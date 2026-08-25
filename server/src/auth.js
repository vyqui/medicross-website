import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db.js';

const scryptAsync = promisify(scrypt);

/* scrypt ships with Node, so there is no native module to compile and nothing
   to go wrong on a Railway build. These parameters cost ~16 MB and ~100 ms per
   hash, which is the point: it makes offline guessing expensive. */
const PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

export const SESSION_COOKIE = 'mcx_session';
const SESSION_DAYS = 14;

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p,
    salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(plain, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');

  const key = await scryptAsync(plain.normalize('NFKC'), salt, expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });

  /* Constant-time, so a wrong password can't be narrowed down by timing. */
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A referral code the patient can read out over the phone without ambiguity. */
export function generateReferralCode(name) {
  /* NFD then strip diacritics, so "Ștefan" becomes STEFAN rather than STFAN. */
  const slug = String(name || 'client')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'CLIENT';
  /* No 0/O/1/I: these are the characters people misread aloud. */
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (const byte of randomBytes(3)) suffix += alphabet[byte % alphabet.length];
  return `MEDI-${slug}-${suffix}`;
}

export async function createSession(accountId, { userAgent, ip } = {}) {
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const { rows } = await query(
    `insert into sessions (account_id, expires_at, user_agent, ip)
     values ($1, $2, $3, $4) returning id, expires_at`,
    [accountId, expires, userAgent ?? null, ip ?? null],
  );
  return rows[0];
}

export async function loadSession(sessionId) {
  if (!sessionId) return null;
  const { rows } = await query(
    `select s.id       as session_id,
            a.id       as account_id,
            a.email,
            a.role,
            a.patient_id,
            a.must_change_password
       from sessions s
       join accounts a on a.id = s.account_id
      where s.id = $1 and s.expires_at > now()`,
    [sessionId],
  );
  return rows[0] ?? null;
}

export async function destroySession(sessionId) {
  if (sessionId) await query('delete from sessions where id = $1', [sessionId]);
}

/** Logs every other device out — used after a password change. */
export async function destroyAllSessions(accountId) {
  await query('delete from sessions where account_id = $1', [accountId]);
}

export async function purgeExpiredSessions() {
  const { rowCount } = await query('delete from sessions where expires_at <= now()');
  return rowCount;
}

/* --------------------------------------------------------------------------
   Route guards. Registered as Fastify preHandlers.
   -------------------------------------------------------------------------- */

export async function requireAuth(request, reply) {
  if (!request.session) {
    return reply.code(401).send({ error: 'Trebuie să fii autentificat.' });
  }
}

export async function requireAdmin(request, reply) {
  if (!request.session) {
    return reply.code(401).send({ error: 'Trebuie să fii autentificat.' });
  }
  if (request.session.role !== 'admin') {
    /* 404 rather than 403: a patient poking at admin routes learns nothing
       about which of them exist. */
    return reply.code(404).send({ error: 'Resursă inexistentă.' });
  }
}
