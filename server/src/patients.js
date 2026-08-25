import { query } from './db.js';
import { serializePatient } from './serialize.js';
import { computeDiscount } from './discounts.js';

/** Writes one line to a patient's audit trail. Never fails the caller. */
export async function logEvent(patientId, who, what, client) {
  const run = client ? client.query.bind(client) : query;
  await run('insert into activity_log (patient_id, who, what) values ($1, $2, $3)',
    [patientId, who || 'sistem', what]);
}

const LOG_LIMIT = 200;

/**
 * Loads every row belonging to one patient and returns the nested object the
 * portal and admin UIs expect. Returns null when the patient does not exist.
 */
export async function loadPatient(patientId) {
  const patientRes = await query(
    'select * from patients where id = $1 and deleted_at is null', [patientId]);
  const patient = patientRes.rows[0];
  if (!patient) return null;

  /* Six independent reads — issued together rather than awaited in sequence. */
  const [operations, tripItems, documents, referrals, actions, log] = await Promise.all([
    query('select * from operations where patient_id = $1 order by position, name', [patientId]),
    query('select * from trip_items where patient_id = $1 order by position', [patientId]),
    query('select * from documents where patient_id = $1 order by uploaded_at desc', [patientId]),
    query('select * from referrals where patient_id = $1 order by created_at', [patientId]),
    query('select * from discount_actions where patient_id = $1', [patientId]),
    query('select at, who, what from activity_log where patient_id = $1 order by at desc limit $2',
      [patientId, LOG_LIMIT]),
  ]);

  return serializePatient({
    patient,
    operations: operations.rows,
    tripItems: tripItems.rows,
    documents: documents.rows,
    referrals: referrals.rows,
    actions: actions.rows,
    log: log.rows,
  });
}

/** The admin console's patient list, with each discount total recomputed. */
export async function listPatients() {
  const { rows: patients } = await query(
    'select * from patients where deleted_at is null order by created_at desc');
  if (patients.length === 0) return [];

  const ids = patients.map((p) => p.id);
  const [actions, referrals] = await Promise.all([
    query('select * from discount_actions where patient_id = any($1::uuid[])', [ids]),
    query('select * from referrals where patient_id = any($1::uuid[])', [ids]),
  ]);

  const actionsBy = new Map();
  for (const a of actions.rows) {
    if (!actionsBy.has(a.patient_id)) actionsBy.set(a.patient_id, []);
    actionsBy.get(a.patient_id).push(a);
  }
  const referralsBy = new Map();
  for (const r of referrals.rows) {
    if (!referralsBy.has(r.patient_id)) referralsBy.set(r.patient_id, []);
    referralsBy.get(r.patient_id).push(r);
  }

  return patients.map((p) => ({
    id: p.id,
    name: p.name,
    initials: p.initials,
    email: p.email,
    phone: p.phone,
    sex: p.sex,
    referralCode: p.referral_code,
    gdprAccepted: p.gdpr_accepted,
    createdAt: p.created_at?.toISOString?.() ?? null,
    discountTotal: computeDiscount(
      p, actionsBy.get(p.id) ?? [], referralsBy.get(p.id) ?? []).total,
  }));
}

/** Initials the admin console shows in the avatar chip. */
export function initialsFor(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Guards a route so a patient can only ever reach their own record. */
export function assertCanAccess(session, patientId, reply) {
  if (session.role === 'admin') return true;
  if (session.patient_id === patientId) return true;
  reply.code(404).send({ error: 'Resursă inexistentă.' });
  return false;
}
