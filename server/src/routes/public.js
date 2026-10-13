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

    const doctor = doctors[doctorId];
    const dateReadable = date ? new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z')) : 'de stabilit';
    const appointment = date && time ? dateReadable + ', ora ' + time : 'data și ora vor fi stabilite de echipa Medicross';
    const safe = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const wrap = (heading, content, footer) => '<!doctype html><html lang="ro"><head><meta charset="utf-8"></head><body style="background:#f4f6f8;margin:0;padding:24px;font-family:Arial,sans-serif;color:#203047"><div style="max-width:580px;margin:auto;background:white;border-radius:14px;overflow:hidden;border:1px solid #e5e8ed"><div style="height:6px;background:#d42b2b"></div><div style="padding:30px"><div style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#bd2525">MEDICROSS | CONSULTAȚII ONLINE</div><h1 style="font-size:23px;margin:18px 0 24px">' + heading + '</h1>' + content + '</div><div style="padding:18px 30px;background:#f8f9fb;font-size:12px;color:#677489;line-height:1.6">' + footer + '</div></div></body></html>';
    const detail = (label, value) => '<tr><td style="padding:10px 14px 10px 0;color:#718096;vertical-align:top;font-size:13px">' + label + '</td><td style="padding:10px 0;font-size:14px;font-weight:600">' + safe(value) + '</td></tr>';
    const internalText = ['Solicitare consultație online Medicross', 'Medic: ' + doctor, '', 'Nume: ' + name, 'Data preferată: ' + (date || 'De stabilit'), 'Ora preferată: ' + (time || 'De stabilit'), '', 'Telefon: ' + phone, 'Email pacient: ' + email, 'Mesaj: ' + (note || '—'), '', 'Sursa: https://www.tratamente-turcia.ro/opd-consultatii', 'Solicitarea necesită confirmarea disponibilității de către echipa Medicross.'].join('\n');
    const internalHtml = wrap('Solicitare nouă de consultație', '<p style="padding:16px;background:#fff3f1;border-radius:9px"><strong>Medic: ' + safe(doctor) + '</strong></p><table style="width:100%;border-collapse:collapse">' + detail('Nume', name) + detail('Data preferată', date || 'De stabilit') + detail('Ora preferată', time || 'De stabilit') + detail('Telefon', phone) + detail('Email pacient', email) + detail('Mesaj', note || '—') + '</table><p style="font-size:12px;margin-top:22px">Sursa: <a href="https://www.tratamente-turcia.ro/opd-consultatii">Pagina OPD Consultații</a></p>', 'Solicitarea necesită confirmarea disponibilității de către echipa Medicross.');
    const patientText = ['Bună ziua, ' + name + '!', '', 'Solicitarea dumneavoastră de consultație online Medicross a fost înregistrată.', 'Medic: ' + doctor, 'Data și ora solicitate: ' + appointment, '', 'Echipa Medicross vă va contacta pentru confirmarea disponibilității și detaliile consultației.', 'Dacă doriți să anulați solicitarea, vă rugăm să răspundeți la acest email.', '', 'Cu respect,', 'Echipa Medicross'].join('\n');
    const patientHtml = wrap('Solicitarea a fost înregistrată', '<p>Bună ziua, <strong>' + safe(name) + '</strong>!</p><p>Am înregistrat solicitarea dumneavoastră pentru o consultație online.</p><div style="background:#f4f6f8;border-radius:10px;padding:18px"><p style="margin:0 0 8px;color:#68768a;font-size:13px">Medic</p><strong>' + safe(doctor) + '</strong><p style="margin:18px 0 8px;color:#68768a;font-size:13px">Data și ora solicitate</p><strong>' + safe(appointment) + '</strong></div><p style="line-height:1.6">Echipa Medicross vă va contacta pentru confirmarea disponibilității și detaliile de conectare.</p><p style="line-height:1.6">Dacă doriți să anulați solicitarea, vă rugăm să răspundeți la acest email.</p><p>Cu respect,<br><strong>Echipa Medicross</strong></p>', 'Tratamente Turcia by Medicross');
    try {
      await sendMail({ to: ['office@tratamente-turcia.ro', 'victorgeorgescu22@gmail.com'], subject: 'Solicitare consultație online Medicross', text: internalText, html: internalHtml });
    } catch (err) {
      request.log.error({ err }, 'OPD internal notification failed');
      return reply.code(502).send({ error: 'Solicitarea nu a putut fi transmisă. Încearcă din nou sau folosește WhatsApp.' });
    }
    try {
      await sendMail({ to: email, subject: 'Medicross — solicitarea dumneavoastră a fost înregistrată', text: patientText, html: patientHtml, replyTo: 'office@tratamente-turcia.ro' });
    } catch (err) {
      request.log.error({ err }, 'OPD patient confirmation failed');
      return reply.code(200).send({ ok: true, warning: 'Solicitarea a ajuns la echipa Medicross, dar emailul de confirmare nu a putut fi trimis.' });
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
