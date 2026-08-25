import { query } from '../db.js';
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
