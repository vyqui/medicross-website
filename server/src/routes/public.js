import { query } from '../db.js';
import { sendMail } from '../mailer.js';
import { ACTION_REWARD, REFERRAL_OPERATED, CODE_USED, SOCIAL_MAX } from '../discounts.js';

/* Unauthenticated routes. The lead endpoint is the one the marketing site
   calls, so it is the only cross-origin POST the platform accepts. */
export default async function publicRoutes(app) {
  /* Until now every contact form called window.open('wa.me/…') and the enquiry
     existed nowhere unless the visitor also pressed send inside WhatsApp. */
  app.post('/api/leads', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const body = request.body ?? {};

    const name = String(body.name ?? '').trim().slice(0, 200);
    const phone = String(body.phone ?? '').trim().slice(0, 60);
    const email = String(body.email ?? '').trim().slice(0, 200);

    /* A lead with no way to reach the person back is not a lead. */
    if (!phone && !email) {
      return reply.code(400).send({ error: 'Lasă-ne un telefon sau un e-mail ca să te putem contacta.' });
    }

    /* Honeypot: a hidden field only an automated submitter fills in. Answer 200
       so the bot has no signal that it was rejected. */
    if (String(body.website ?? '').trim()) return { ok: true };

    const { rows } = await query(
      `insert into leads (name, phone, email, procedure, message, source_page)
       values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
      [name, phone, email,
        String(body.procedure ?? '').trim().slice(0, 200),
        String(body.message ?? '').trim().slice(0, 4000),
        String(body.sourcePage ?? '').trim().slice(0, 300)]);

    request.log.info({ leadId: rows[0].id, procedure: body.procedure }, 'lead captured');
    return reply.code(201).send({ ok: true, id: rows[0].id });
  });


  /* Public OPD consultation requests: server-side delivery through Resend. */
  app.post('/api/opd-consultatii', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Cerere invalidă.' });
    if (String(body.website ?? '').trim()) return { ok: true };
    const doctors = {
      ulu: 'Prof. Dr. Şahin Ulu',
      esen: 'Op. Dr. İkram Esen',
      tanriverdi: 'Op. Dr. Hasan Tanrıverdi',
      demirbaglar: 'Op. Dr. Çağrı Demirbağlar',
      help: 'Solicită recomandarea unui medic',
    };
    const doctorId = String(body.doctorId ?? '');
    const name = String(body.name ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const email = String(body.email ?? '').trim();
    const date = String(body.date ?? '').trim();
    const time = String(body.time ?? '').trim();
    const note = String(body.note ?? '').trim();
    if (!Object.hasOwn(doctors, doctorId) || name.length < 2 || name.length > 150 ||
        phone.replace(/\D/g, '').length < 9 || phone.length > 40 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200 ||
        note.length > 2000 || date.length > 80 || time.length > 30 ||
        (doctorId !== 'help' && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)))) {
      return reply.code(400).send({ error: 'Verifică datele introduse și încearcă din nou.' });
    }
    const text = [
      'Solicitare nouă de consultație online OPD Medicross',
      '',
      'Medic: ' + doctors[doctorId],
      'Data preferată: ' + (date || 'De stabilit'),
      'Ora preferată: ' + (time || 'De stabilit'),
      'Nume: ' + name,
      'Telefon: ' + phone,
      'Email pacient: ' + email,
      'Mesaj: ' + (note || '—'),
      '',
      'Sursa: https://www.tratamente-turcia.ro/opd-consultatii',
      'Solicitarea necesită confirmarea disponibilității de către echipa Medicross.',
    ].join('\n');
    try {
      await sendMail({
        to: ['office@tratamente-turcia.ro', 'victorgeorgescu22@gmail.com'],
        subject: 'OPD Medicross — solicitare consultație — ' + doctors[doctorId],
        text,
      });
    } catch (err) {
      request.log.error({ err }, 'OPD email delivery failed');
      return reply.code(502).send({ error: 'Solicitarea nu a putut fi transmisă. Încearcă din nou sau folosește WhatsApp.' });
    }
    return reply.code(200).send({ ok: true });
  });

  /* One source of truth for the amounts, so the portal renders what the server
     will actually award rather than its own copy of the numbers. */
  app.get('/api/config', async () => ({
    rewards: {
      actions: ACTION_REWARD,
      socialMax: SOCIAL_MAX,
      referralOperated: REFERRAL_OPERATED,
      codeUsed: CODE_USED,
    },
  }));
}
