import { requireAdmin, hashPassword, generateReferralCode } from '../auth.js';
import { query, transaction } from '../db.js';
import { loadPatient, listPatients, logEvent, initialsFor } from '../patients.js';
import { ACTION_KEYS, ACTION_REWARD, REFERRAL_OPERATED, CODE_USED } from '../discounts.js';
import { uploadDocument } from './portal.js';
import * as storage from '../storage.js';

const STATUSES = ['evaluare', 'programata', 'finalizata'];
const REFERRAL_STATUSES = ['inscris', 'operat', 'anulat'];

export default async function adminRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  const who = (request) => request.session.email;

  /* ---- patients ------------------------------------------------------- */

  app.get('/api/admin/patients', async () => ({ patients: await listPatients() }));

  app.get('/api/admin/patients/:id', async (request, reply) => {
    const patient = await loadPatient(request.params.id);
    if (!patient) return reply.code(404).send({ error: 'Pacient inexistent.' });

    const { rows } = await query(
      'select email, must_change_password, last_login_at from accounts where patient_id = $1',
      [request.params.id]);

    return { ...patient, account: rows[0] ?? null };
  });

  /* Creates the patient record and the login that goes with it, in one
     transaction — a patient without an account cannot sign in, and an account
     without a patient has nothing to show. */
  app.post('/api/admin/patients', async (request, reply) => {
    const { name, email, phone, sex, password, gdprAccepted } = request.body ?? {};

    if (!name || !String(name).trim()) {
      return reply.code(400).send({ error: 'Numele este obligatoriu.' });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) {
      return reply.code(400).send({ error: 'Adresa de e-mail nu este validă.' });
    }
    if (!password || String(password).length < 8) {
      return reply.code(400).send({ error: 'Parola inițială trebuie să aibă cel puțin 8 caractere.' });
    }
    if (sex && !['f', 'm'].includes(sex)) {
      return reply.code(400).send({ error: 'Sexul trebuie să fie „f” sau „m”.' });
    }

    const existing = await query('select 1 from accounts where lower(email) = lower($1)',
      [String(email).trim()]);
    if (existing.rowCount > 0) {
      return reply.code(409).send({ error: 'Există deja un cont cu acest e-mail.' });
    }

    const passwordHash = await hashPassword(String(password));

    try {
      const patientId = await transaction(async (client) => {
        /* Retry on the astronomically unlikely referral-code collision rather
           than failing the whole creation. */
        let patient;
        for (let attempt = 0; attempt < 5 && !patient; attempt += 1) {
          try {
            const res = await client.query(
              `insert into patients (name, initials, email, phone, sex, referral_code,
                                     gdpr_accepted, gdpr_accepted_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
              [String(name).trim(), initialsFor(name), String(email).trim(),
                phone ?? '', sex ?? 'f', generateReferralCode(name),
                Boolean(gdprAccepted), gdprAccepted ? new Date() : null]);
            patient = res.rows[0];
          } catch (err) {
            if (err.constraint !== 'patients_referral_code_key') throw err;
          }
        }
        if (!patient) throw new Error('Could not allocate a unique referral code.');

        await client.query(
          `insert into accounts (email, password_hash, role, patient_id, must_change_password)
           values ($1, $2, 'patient', $3, true)`,
          [String(email).trim(), passwordHash, patient.id]);

        await client.query(
          'insert into activity_log (patient_id, who, what) values ($1, $2, $3)',
          [patient.id, who(request), 'A creat contul pacientului']);

        return patient.id;
      });

      return reply.code(201).send(await loadPatient(patientId));
    } catch (err) {
      request.log.error({ err }, 'failed to create patient');
      return reply.code(500).send({ error: 'Contul nu a putut fi creat.' });
    }
  });

  /* Identity, contact details, the free-text "Detalii" card and GDPR consent. */
  app.patch('/api/admin/patients/:id', async (request, reply) => {
    const id = request.params.id;
    const current = await query('select * from patients where id = $1 and deleted_at is null', [id]);
    if (current.rowCount === 0) return reply.code(404).send({ error: 'Pacient inexistent.' });
    const before = current.rows[0];

    const { name, phone, sex, details, gdprAccepted } = request.body ?? {};
    if (sex && !['f', 'm'].includes(sex)) {
      return reply.code(400).send({ error: 'Sexul trebuie să fie „f” sau „m”.' });
    }

    const nextGdpr = gdprAccepted === undefined ? before.gdpr_accepted : Boolean(gdprAccepted);

    await query(
      `update patients set
         name             = coalesce($2, name),
         initials         = case when $2::text is null then initials else $3 end,
         phone            = coalesce($4, phone),
         sex              = coalesce($5, sex),
         details          = coalesce($6, details),
         gdpr_accepted    = $7,
         gdpr_accepted_at = case
                              when $7 and not gdpr_accepted then now()
                              when not $7 then null
                              else gdpr_accepted_at
                            end
       where id = $1`,
      [id, name ?? null, name ? initialsFor(name) : null, phone ?? null,
        sex ?? null, details ?? null, nextGdpr]);

    if (details !== undefined && details !== before.details) {
      await logEvent(id, who(request),
        details ? 'A actualizat descrierea pacientului' : 'A șters descrierea pacientului');
    }
    if (nextGdpr !== before.gdpr_accepted) {
      await logEvent(id, who(request),
        nextGdpr ? 'Acord GDPR marcat ca semnat' : 'Acord GDPR retras');
    }

    return loadPatient(id);
  });

  /* ---- operations ------------------------------------------------------ */

  app.put('/api/admin/patients/:id/operations/:opId?', async (request, reply) => {
    const { id, opId } = request.params;
    const { name, detail, status, date, regions, viewMode, active } = request.body ?? {};

    if (!name || !String(name).trim()) {
      return reply.code(400).send({ error: 'Numele intervenției este obligatoriu.' });
    }
    if (status && !STATUSES.includes(status)) {
      return reply.code(400).send({ error: 'Status necunoscut.' });
    }

    await transaction(async (client) => {
      let savedId = opId;
      if (opId) {
        const res = await client.query(
          `update operations set name=$3, detail=$4, status=$5, date_text=$6,
                                 regions=$7, view_mode=$8, is_active=$9
             where id=$2 and patient_id=$1 returning id`,
          [id, opId, String(name).trim(), detail ?? '', status ?? 'evaluare',
            date ?? '', regions ?? '', viewMode ?? 'surface', Boolean(active)]);
        if (res.rowCount === 0) throw Object.assign(new Error('not found'), { statusCode: 404 });
        await client.query('insert into activity_log (patient_id, who, what) values ($1,$2,$3)',
          [id, who(request), `A actualizat intervenția „${name}”`]);
      } else {
        const res = await client.query(
          `insert into operations (patient_id, name, detail, status, date_text,
                                   regions, view_mode, is_active, position)
           values ($1,$2,$3,$4,$5,$6,$7,$8,
             coalesce((select max(position)+1 from operations where patient_id=$1), 0))
           returning id`,
          [id, String(name).trim(), detail ?? '', status ?? 'evaluare', date ?? '',
            regions ?? '', viewMode ?? 'surface', Boolean(active)]);
        savedId = res.rows[0].id;
        await client.query('insert into activity_log (patient_id, who, what) values ($1,$2,$3)',
          [id, who(request), `A adăugat intervenția „${name}”`]);
      }

      /* Exactly one operation drives the body map at a time. */
      if (active) {
        await client.query(
          'update operations set is_active = (id = $2) where patient_id = $1', [id, savedId]);
      }
    }).catch((err) => {
      if (err.statusCode === 404) return reply.code(404).send({ error: 'Intervenție inexistentă.' });
      throw err;
    });

    if (reply.sent) return;
    return loadPatient(id);
  });

  app.delete('/api/admin/patients/:id/operations/:opId', async (request, reply) => {
    const { id, opId } = request.params;
    const { rows } = await query(
      'delete from operations where id=$1 and patient_id=$2 returning name', [opId, id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Intervenție inexistentă.' });
    await logEvent(id, who(request), `A șters intervenția „${rows[0].name}”`);
    return loadPatient(id);
  });

  /* ---- trip agenda ----------------------------------------------------- */

  app.put('/api/admin/patients/:id/trip', async (request, reply) => {
    const { title, subtitle } = request.body ?? {};
    const { rowCount } = await query(
      `update patients set trip_title = coalesce($2, trip_title),
                           trip_subtitle = coalesce($3, trip_subtitle)
        where id = $1`,
      [request.params.id, title ?? null, subtitle ?? null]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Pacient inexistent.' });
    return loadPatient(request.params.id);
  });

  app.put('/api/admin/patients/:id/trip/items/:itemId?', async (request, reply) => {
    const { id, itemId } = request.params;
    const { date, desc, icon, surgery, hospital } = request.body ?? {};

    if (itemId) {
      const { rowCount } = await query(
        `update trip_items set date_text=$3, description=$4, icon=$5,
                               is_surgery=$6, hospital=$7
           where id=$2 and patient_id=$1`,
        [id, itemId, date ?? '', desc ?? '', icon ?? 'tag', Boolean(surgery), hospital ?? '']);
      if (rowCount === 0) return reply.code(404).send({ error: 'Etapă inexistentă.' });
    } else {
      await query(
        `insert into trip_items (patient_id, date_text, description, icon, is_surgery, hospital, position)
         values ($1,$2,$3,$4,$5,$6,
           coalesce((select max(position)+1 from trip_items where patient_id=$1), 0))`,
        [id, date ?? '', desc ?? '', icon ?? 'tag', Boolean(surgery), hospital ?? '']);
    }

    await logEvent(id, who(request),
      itemId ? 'A actualizat o etapă din program' : 'A adăugat o etapă în program');
    return loadPatient(id);
  });

  app.delete('/api/admin/patients/:id/trip/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params;
    const { rowCount } = await query(
      'delete from trip_items where id=$1 and patient_id=$2', [itemId, id]);
    if (rowCount === 0) return reply.code(404).send({ error: 'Etapă inexistentă.' });
    await logEvent(id, who(request), 'A șters o etapă din program');
    return loadPatient(id);
  });

  /* Swaps an item with its neighbour, so the agenda can be ordered by hand. */
  app.post('/api/admin/patients/:id/trip/items/:itemId/move', async (request, reply) => {
    const { id, itemId } = request.params;
    const direction = request.body?.direction === 'down' ? 'down' : 'up';

    const moved = await transaction(async (client) => {
      const { rows } = await client.query(
        'select id, position from trip_items where patient_id=$1 order by position', [id]);
      const index = rows.findIndex((r) => r.id === itemId);
      if (index < 0) return false;

      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= rows.length) return true;   // already at the end

      /* Positions can contain duplicates from earlier inserts, so rewrite the
         whole sequence rather than swapping two possibly-equal values. */
      const reordered = [...rows];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      for (const [position, row] of reordered.entries()) {
        await client.query('update trip_items set position=$2 where id=$1', [row.id, position]);
      }
      return true;
    });

    if (!moved) return reply.code(404).send({ error: 'Etapă inexistentă.' });
    return loadPatient(id);
  });

  /* ---- referrals and discounts ----------------------------------------- */

  app.post('/api/admin/patients/:id/referrals', async (request, reply) => {
    const name = String(request.body?.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'Numele recomandării este obligatoriu.' });

    await query('insert into referrals (patient_id, name) values ($1, $2)',
      [request.params.id, name]);
    await logEvent(request.params.id, who(request), `A înregistrat recomandarea „${name}”`);
    return loadPatient(request.params.id);
  });

  /* The €70 is only ever awarded here, by a member of staff, never claimed. */
  app.patch('/api/admin/patients/:id/referrals/:refId', async (request, reply) => {
    const { id, refId } = request.params;
    const { status } = request.body ?? {};
    if (!REFERRAL_STATUSES.includes(status)) {
      return reply.code(400).send({ error: 'Status necunoscut.' });
    }

    const { rows } = await query(
      `update referrals set status = $3,
                            operated_at = case when $3 = 'operat' then now() else null end
         where id = $2 and patient_id = $1 returning name`,
      [id, refId, status]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Recomandare inexistentă.' });

    const note = status === 'operat' ? `operat, ${REFERRAL_OPERATED} € acordați`
      : status === 'anulat' ? 'anulată' : 'înscris, în așteptare';
    await logEvent(id, who(request), `Recomandarea „${rows[0].name}” → ${note}`);
    return loadPatient(id);
  });

  app.delete('/api/admin/patients/:id/referrals/:refId', async (request, reply) => {
    const { id, refId } = request.params;
    const { rows } = await query(
      'delete from referrals where id=$1 and patient_id=$2 returning name', [refId, id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Recomandare inexistentă.' });
    await logEvent(id, who(request), `A șters recomandarea „${rows[0].name}”`);
    return loadPatient(id);
  });

  /* Records that this patient signed up on someone else's code, and creates the
     matching referral on the owner's side so both halves stay consistent. */
  app.put('/api/admin/patients/:id/used-code', async (request, reply) => {
    const id = request.params.id;
    const code = String(request.body?.code ?? '').trim().toUpperCase();

    const patientRes = await query('select * from patients where id = $1', [id]);
    const patient = patientRes.rows[0];
    if (!patient) return reply.code(404).send({ error: 'Pacient inexistent.' });

    if (!code) {
      await query('update patients set used_code = null, used_code_at = null where id = $1', [id]);
      if (patient.used_code) {
        await logEvent(id, who(request), 'A eliminat codul de reducere folosit');
      }
      return loadPatient(id);
    }

    if (code === patient.referral_code) {
      return reply.code(400).send({ error: 'Pacientul nu poate folosi propriul cod.' });
    }

    const ownerRes = await query('select * from patients where referral_code = $1', [code]);
    const owner = ownerRes.rows[0];
    if (!owner) return reply.code(404).send({ error: `Codul „${code}” nu există.` });

    await transaction(async (client) => {
      await client.query(
        'update patients set used_code = $2, used_code_at = now() where id = $1', [id, code]);
      await client.query('insert into activity_log (patient_id, who, what) values ($1,$2,$3)',
        [id, who(request), `Cod de reducere folosit: ${code} — ${CODE_USED} €`]);

      const already = await client.query(
        'select 1 from referrals where patient_id = $1 and referred_patient_id = $2',
        [owner.id, id]);
      if (already.rowCount === 0) {
        await client.query(
          'insert into referrals (patient_id, name, referred_patient_id) values ($1,$2,$3)',
          [owner.id, patient.name, id]);
        await client.query('insert into activity_log (patient_id, who, what) values ($1,$2,$3)',
          [owner.id, who(request),
            `${patient.name} folosește codul tău — ${REFERRAL_OPERATED} € după intervenție`]);
      }
    });

    return loadPatient(id);
  });

  /* Staff confirming a follow/review/share actually exists. This is the only
     way a social action becomes money. */
  app.post('/api/admin/patients/:id/actions/:key/verify', async (request, reply) => {
    const { id, key } = request.params;
    if (!ACTION_KEYS.includes(key)) {
      return reply.code(400).send({ error: 'Acțiune necunoscută.' });
    }
    const verified = request.body?.verified !== false;

    const { rowCount } = await query(
      `update discount_actions
          set verified_at = case when $3 then now() else null end,
              verified_by = case when $3 then $4 else null end
        where patient_id = $1 and action_key = $2`,
      [id, key, verified, who(request)]);

    if (rowCount === 0) {
      return reply.code(404).send({ error: 'Pacientul nu a revendicat această acțiune.' });
    }

    await logEvent(id, who(request), verified
      ? `A confirmat acțiunea „${key}” — ${ACTION_REWARD[key]} € acordați`
      : `A retras confirmarea pentru acțiunea „${key}”`);
    return loadPatient(id);
  });

  /* ---- documents ------------------------------------------------------- */

  app.post('/api/admin/patients/:id/documents', async (request, reply) =>
    uploadDocument(request, reply, request.params.id, 'staff'));

  app.delete('/api/admin/patients/:id/documents/:docId', async (request, reply) => {
    const { id, docId } = request.params;
    const { rows } = await query(
      'delete from documents where id=$1 and patient_id=$2 returning *', [docId, id]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Document inexistent.' });
    await storage.remove(rows[0].storage_key);
    await logEvent(id, who(request), `A șters documentul „${rows[0].name}”`);
    return loadPatient(id);
  });

  /* ---- leads ----------------------------------------------------------- */

  app.get('/api/admin/leads', async (request) => {
    const status = request.query?.status;
    const { rows } = status
      ? await query('select * from leads where status = $1 order by created_at desc limit 500', [status])
      : await query('select * from leads order by created_at desc limit 500');
    return { leads: rows };
  });

  app.patch('/api/admin/leads/:leadId', async (request, reply) => {
    const { status } = request.body ?? {};
    if (!['nou', 'contactat', 'inchis'].includes(status)) {
      return reply.code(400).send({ error: 'Status necunoscut.' });
    }
    const { rows } = await query(
      'update leads set status = $2 where id = $1 returning *', [request.params.leadId, status]);
    if (rows.length === 0) return reply.code(404).send({ error: 'Lead inexistent.' });
    return rows[0];
  });
}
