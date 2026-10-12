import { randomUUID } from 'node:crypto';

export const OFFER_NAMES = {
  'gastric-sleeve': 'Gastric Sleeve 2.000€',
  'implant-mamar': 'Implant Mamar 3.000€',
};
const RECIPIENTS = { victor: 'victorgeorgescu22@gmail.com', office: 'office@tratamente-turcia.ro' };
const clean = (value, max) => String(value ?? '').trim().slice(0, max);

export function validateOfferLead(body = {}) {
  if (clean(body.website, 200)) return { bot: true };
  if (!Object.hasOwn(OFFER_NAMES, body.offer)) throw new Error('Oferta este invalidă.');
  if (body.consent !== true) throw new Error('Bifează acordul pentru a fi contactat(ă).');
  const name = clean(body.name, 200);
  const phone = clean(body.phone, 60);
  const email = clean(body.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Verifică adresa de e-mail.');
  if (name.length < 2 || !/^[+\d\s().-]{7,30}$/.test(phone) || phone.replace(/\D/g, '').length < 7) {
    throw new Error('Completează numele și un număr de telefon valid.');
  }
  const id = clean(body.requestId, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Reîncarcă pagina și încearcă din nou.');
  }
  const lines = [clean(body.message, 3000)];
  if (body.offer === 'gastric-sleeve') {
    for (const [key, label] of [['weight', 'Greutate (kg)'], ['height', 'Înălțime (cm)']]) {
      if (body[key] !== '' && body[key] != null) {
        const value = Number(body[key]);
        if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new Error('Verifică greutatea și înălțimea.');
        lines.push(`${label}: ${value}`);
      }
    }
  }
  lines.push('Acord pentru contact: da');
  lines.push('Consimțământ marketing e-mail: ' + (body.marketingConsent === true ? 'DA, acordat explicit' : 'NU'));
  const tracking = body.tracking || {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) {
    if (tracking[key]) lines.push(`${key}: ${clean(tracking[key], 100)}`);
  }
  return { id, name, phone, email, procedure: OFFER_NAMES[body.offer], message: lines.filter(Boolean).join('\n'),
    sourcePage: `https://www.tratamente-turcia.ro/oferta-${body.offer}` };
}

export async function deliverOfferLead(row, { sendMail, fetchImpl = fetch, env = process.env }) {
  if (row.destination === 'sheet') {
    const url = env.OFFER_SHEET_WEBHOOK_URL;
    const token = env.OFFER_SHEET_WEBHOOK_TOKEN;
    if (!url || !token) throw new Error('sheet_not_configured');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('invalid_sheet_url');
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, id: row.id, createdAt: row.created_at, name: row.name,
        phone: row.phone, email: row.email, procedure: row.procedure, message: row.message, sourcePage: row.source_page }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('sheet_http_error');
    const result = await response.json();
    if (result.ok !== true || result.id !== row.id) throw new Error('sheet_rejected');
    return;
  }
  const to = RECIPIENTS[row.destination];
  if (!to) throw new Error('invalid_destination');
  await sendMail({ to, subject: `Cerere nouă Medicross — ${row.procedure}`,
    text: [`Cerere: ${row.id}`, `Data: ${new Date(row.created_at).toISOString()}`,
      `Nume: ${row.name}`, `Telefon: ${row.phone}`, `E-mail: ${row.email || ''}`, `Ofertă: ${row.procedure}`,
      row.message, `Pagina: ${row.source_page}`].join('\n'),
    idempotencyKey: `offer-${row.id}-${row.destination}` });
}

export default async function offerLeadRoutes(app, { pool, transaction, sendMail }) {
  app.post('/api/offer-leads', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    let lead;
    try { lead = validateOfferLead(request.body); }
    catch (error) { return reply.code(400).send({ error: error.message }); }
    if (lead.bot) return reply.code(201).send({ ok: true, id: randomUUID() });
    await transaction(async (client) => {
      const result = await client.query(`insert into leads(id,name,phone,email,procedure,message,source_page)
        values($1,$2,$3,$4,$5,$6,$7) on conflict(id) do nothing returning id`,
        [lead.id, lead.name, lead.phone, lead.email, lead.procedure, lead.message, lead.sourcePage]);
      if (result.rowCount) await client.query(`insert into offer_lead_deliveries(lead_id,destination)
        select $1, unnest(array['victor','office','sheet'])`, [lead.id]);
    });
    void drain();
    return reply.code(201).send({ ok: true, id: lead.id });
  });

  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      for (let i = 0; i < 12; i++) {
        const { rows } = await pool.query(`with pending as (
          select lead_id,destination from offer_lead_deliveries
          where delivered_at is null and next_attempt_at <= now()
          order by next_attempt_at for update skip locked limit 1
        ), claimed as (
          update offer_lead_deliveries d set attempts=d.attempts+1,next_attempt_at=now()+interval '2 minutes'
          from pending p where d.lead_id=p.lead_id and d.destination=p.destination
          returning d.lead_id,d.destination,d.attempts
        ) select l.*,c.destination,c.attempts from claimed c join leads l on l.id=c.lead_id`);
        if (!rows.length) break;
        const row = rows[0];
        try {
          await deliverOfferLead(row, { sendMail });
          await pool.query('update offer_lead_deliveries set delivered_at=now() where lead_id=$1 and destination=$2', [row.id,row.destination]);
        } catch {
          // Log IDs only; provider failures may contain private form fields or credentials.
          app.log.warn({ leadId: row.id, destination: row.destination }, 'offer delivery pending retry');
          const seconds = Math.min(3600, 30 * 2 ** Math.min(row.attempts, 7));
          await pool.query("update offer_lead_deliveries set next_attempt_at=now()+$3*interval '1 second' where lead_id=$1 and destination=$2", [row.id,row.destination,seconds]);
        }
      }
    } catch { app.log.error('offer delivery worker unavailable'); }
    finally { running = false; }
  }
  const timer = setInterval(() => void drain(), 30000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}
