import { requireAuth } from '../auth.js';
import { query } from '../db.js';
import { loadPatient, logEvent } from '../patients.js';
import { ACTION_KEYS } from '../discounts.js';
import * as storage from '../storage.js';

/* Routes a signed-in patient uses on their own record. Every one of them reads
   the patient id from the session, never from the request, so there is no
   parameter to tamper with. */
export default async function portalRoutes(app) {
  app.addHook('preHandler', requireAuth);

  function ownPatientId(request, reply) {
    const id = request.session.patient_id;
    if (!id) {
      reply.code(400).send({ error: 'Contul acesta nu este legat de un pacient.' });
      return null;
    }
    return id;
  }

  app.get('/api/me', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;
    const patient = await loadPatient(id);
    if (!patient) return reply.code(404).send({ error: 'Pacient inexistent.' });
    return patient;
  });

  /* The only way gdpr_accepted ever becomes true. One-directional (there is
     no reverse of this endpoint) and always logged as the patient, because
     this can only run inside the patient's own authenticated session — an
     admin viewing on the patient's behalf has no patient_id of their own to
     call it with. A patient who wants to withdraw consent contacts the team
     directly (see acord-gdpr.html); that is handled off-system, not by an
     in-app toggle. */
  app.post('/api/me/gdpr', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;

    const { rowCount } = await query(
      `update patients set gdpr_accepted = true, gdpr_accepted_at = now()
        where id = $1 and not gdpr_accepted`,
      [id]);
    if (rowCount > 0) await logEvent(id, 'pacient', 'Acord GDPR acceptat');

    return loadPatient(id);
  });

  /* The patient claims a social action. It earns nothing until a member of
     staff verifies it — see src/discounts.js. */
  app.post('/api/me/actions/:key', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;

    const { key } = request.params;
    if (!ACTION_KEYS.includes(key)) {
      return reply.code(400).send({ error: 'Acțiune necunoscută.' });
    }

    const done = request.body?.done !== false;

    if (done) {
      const { rowCount } = await query(
        `insert into discount_actions (patient_id, action_key)
         values ($1, $2) on conflict (patient_id, action_key) do nothing`,
        [id, key]);
      if (rowCount > 0) {
        await logEvent(id, 'pacient', `A marcat acțiunea „${key}” — așteaptă verificarea echipei`);
      }
    } else {
      const { rowCount } = await query(
        'delete from discount_actions where patient_id = $1 and action_key = $2', [id, key]);
      if (rowCount > 0) await logEvent(id, 'pacient', `A retras acțiunea „${key}”`);
    }

    return loadPatient(id);
  });

  /* 3D body map state: which operation is highlighted and from which view. */
  app.post('/api/me/view', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;

    const { activeOp, mode } = request.body ?? {};
    if (mode && !['surface', 'internal'].includes(mode)) {
      return reply.code(400).send({ error: 'Mod de vizualizare necunoscut.' });
    }

    await query(
      `update patients
          set active_op = coalesce($2, active_op),
              view_mode = coalesce($3, view_mode)
        where id = $1`,
      [id, activeOp ?? null, mode ?? null]);

    return loadPatient(id);
  });

  app.post('/api/me/documents', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;
    return uploadDocument(request, reply, id, 'pacient');
  });

  app.delete('/api/me/documents/:docId', async (request, reply) => {
    const id = ownPatientId(request, reply);
    if (!id) return;

    /* Scoped to the session's own patient, so the id in the URL cannot reach
       another patient's file. */
    const { rows } = await query(
      'delete from documents where id = $1 and patient_id = $2 returning *',
      [request.params.docId, id]);

    if (rows.length === 0) return reply.code(404).send({ error: 'Document inexistent.' });

    await storage.remove(rows[0].storage_key);
    await logEvent(id, 'pacient', `A șters documentul „${rows[0].name}”`);
    return loadPatient(id);
  });
}

/** Shared by the patient and admin upload routes. */
export async function uploadDocument(request, reply, patientId, who) {
  const file = await request.file();
  if (!file) return reply.code(400).send({ error: 'Niciun fișier primit.' });

  const buffer = await file.toBuffer().catch(() => null);
  if (!buffer) {
    return reply.code(413).send({
      error: `Fișierul depășește limita de ${Math.round(storage.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
    });
  }

  if (!storage.ALLOWED_MIME.has(file.mimetype)) {
    return reply.code(415).send({
      error: 'Sunt acceptate doar PDF, imagini și documente Word.',
    });
  }

  const key = await storage.put(patientId, buffer);
  const name = String(file.filename || 'document').slice(0, 200);

  await query(
    `insert into documents (patient_id, name, size_bytes, mime, storage_key, uploaded_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [patientId, name, buffer.length, file.mimetype, key, who]);

  await logEvent(patientId, who,
    `A încărcat „${name}” (${Math.round(buffer.length / 1024)} KB)`);

  return loadPatient(patientId);
}
