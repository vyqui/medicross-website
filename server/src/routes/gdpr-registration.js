import { query } from '../db.js';
import { renderGdprRegistrationPdf } from '../gdpr-pdf.js';
import { sendMail } from '../mailer.js';

/* The same procedure catalogue the platform's body map uses (assets/portal-
   data.js PROCEDURES), duplicated here in the one place on the server side
   that needs to turn a key into a human label — this route is the only
   thing validating what a marketing-site page is allowed to claim it is. */
const PROCEDURES = {
  rinoplastie: { label: 'Rinoplastie', category: 'Chirurgie Estetică' },
  'lifting-facial-si-gat': { label: 'Lifting facial și gât', category: 'Chirurgie Estetică' },
  'transplant-par': { label: 'Transplant de păr', category: 'Chirurgie Estetică' },
  'transplant-sprancene': { label: 'Transplant de sprâncene', category: 'Chirurgie Estetică' },
  'marire-mamara': { label: 'Mărire mamară', category: 'Chirurgie Estetică' },
  'micsorare-mamara': { label: 'Micșorare mamară', category: 'Chirurgie Estetică' },
  'lifting-mamar': { label: 'Lifting mamar', category: 'Chirurgie Estetică' },
  abdominoplastie: { label: 'Abdominoplastie', category: 'Chirurgie Estetică' },
  liposuctie: { label: 'Liposucție', category: 'Chirurgie Estetică' },
  bbl: { label: 'Brazilian Butt Lift (BBL)', category: 'Chirurgie Estetică' },
  'mommy-makeover': { label: 'Mommy Makeover', category: 'Chirurgie Estetică' },
  'gastric-sleeve': { label: 'Gastric Sleeve', category: 'Chirurgie Bariatrică' },
  'gastric-bypass': { label: 'Gastric Bypass', category: 'Chirurgie Bariatrică' },
  'balon-gastric': { label: 'Balon Gastric', category: 'Chirurgie Bariatrică' },
  altele: { label: 'Altă intervenție', category: 'Chirurgie' },
};

/** Romanian CNP: 13 digits, the 13th a checksum over the first 12. Catches
    typos before they reach a human, not a claim that the person exists. */
function isValidCnp(cnp) {
  if (!/^\d{13}$/.test(cnp)) return false;
  const weights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  const sum = weights.reduce((total, w, i) => total + w * Number(cnp[i]), 0);
  const control = sum % 11 === 10 ? 1 : sum % 11;
  return control === Number(cnp[12]);
}

/** data: URL -> raw bytes, rejecting anything that isn't a small PNG the
    signature pad itself produced. */
function decodeSignaturePng(dataUrl) {
  const match = /^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const buffer = Buffer.from(match[1], 'base64');
  return buffer.length > 0 && buffer.length <= 500_000 ? buffer : null;
}

/** Best-effort row in the office's Google Sheet, via an Apps Script Web App
    bound to it (see server/README.md) — there is no Sheets API credential
    anywhere in this app, deliberately, so this is the entire integration.
    Includes the CNP (explicitly requested), but never the signature image
    itself, only whether one was drawn; a failure here never blocks the
    actual registration. */
async function logToSheet(row) {
  const url = process.env.GDPR_SHEET_WEBHOOK_URL;
  if (!url) return false;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`sheet webhook responded ${res.status}`);
  return true;
}

export default async function gdprRegistrationRoutes(app) {
  app.post('/api/gdpr-registration', {
    config: { rateLimit: { max: 20, timeWindow: '10 minutes' } },
  }, async (request, reply) => {
    const body = request.body ?? {};

    /* Honeypot, same pattern as /api/leads: a hidden field only a bot fills
       in. Answered as success so the bot has no signal it was rejected. */
    if (String(body.website ?? '').trim()) return { ok: true };

    const name = String(body.name ?? '').trim().slice(0, 200);
    const email = String(body.email ?? '').trim().slice(0, 200);
    const phone = String(body.phone ?? '').trim().slice(0, 60);
    const cnp = String(body.cnp ?? '').trim();
    const addressLine1 = String(body.addressLine1 ?? '').trim().slice(0, 300);
    const addressLine2 = String(body.addressLine2 ?? '').trim().slice(0, 300);
    const dateOfBirth = String(body.dateOfBirth ?? '').trim();
    const procedureKey = String(body.procedure ?? '').trim();
    const sourcePage = String(body.sourcePage ?? '').trim().slice(0, 300);

    if (!name) return reply.code(400).send({ error: 'Numele este obligatoriu.' });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return reply.code(400).send({ error: 'Adresa de e-mail nu este validă.' });
    }
    if (!phone) return reply.code(400).send({ error: 'Telefonul este obligatoriu.' });
    if (!isValidCnp(cnp)) return reply.code(400).send({ error: 'CNP-ul introdus nu este valid.' });
    if (!addressLine1) return reply.code(400).send({ error: 'Adresa este obligatorie.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return reply.code(400).send({ error: 'Data nașterii nu este validă.' });
    }
    if (body.gdprAccepted !== true) {
      return reply.code(400).send({ error: 'Trebuie să accepți acordul GDPR.' });
    }
    const procedure = PROCEDURES[procedureKey] ?? PROCEDURES.altele;

    const signaturePng = decodeSignaturePng(body.signature);
    if (!signaturePng) {
      return reply.code(400).send({ error: 'Semnătura lipsește sau este invalidă.' });
    }

    const pdfBuffer = await renderGdprRegistrationPdf({
      categoryLabel: procedure.category,
      procedureLabel: procedure.label,
      name, email, phone, cnp, addressLine1, addressLine2, dateOfBirth,
      signaturePng,
      sourcePage: sourcePage || 'https://tratamente-turcia.ro',
    });

    const notifyEmail = process.env.GDPR_NOTIFY_EMAIL;
    if (!notifyEmail) {
      request.log.error('GDPR_NOTIFY_EMAIL is not set — cannot send the registration e-mail');
      return reply.code(500).send({ error: 'Formularul nu a putut fi trimis. Te rugăm să ne contactezi direct.' });
    }

    const pdfFilename = `acord-gdpr-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;

    let emailSent = false;
    try {
      await sendMail({
        to: notifyEmail,
        subject: `Acord GDPR — ${procedure.label} — ${name}`,
        text: `Înregistrare nouă pentru ${procedure.label} (${procedure.category}).\n\n` +
          `Nume: ${name}\nE-mail: ${email}\nTelefon: ${phone}\n\n` +
          `Detaliile complete (inclusiv CNP și semnătura) sunt în PDF-ul atașat.`,
        attachments: [{ filename: pdfFilename, content: pdfBuffer }],
      });
      emailSent = true;
    } catch (err) {
      /* The registration itself still gets recorded even if the mailbox is
         unreachable right now — better a delayed follow-up than a silently
         lost signature that the patient believes was received. */
      request.log.error({ err }, 'failed to send GDPR registration e-mail');
    }

    /* The patient's own copy is a courtesy, not the record of truth — the
       team follows up with each patient separately, so a failure here is
       logged and otherwise ignored: it never touches emailSent, the stored
       row, or what the patient sees in the response. */
    try {
      await sendMail({
        to: email,
        subject: `Acordul tău GDPR — ${procedure.label} — Tratamente Turcia by Medicross`,
        text: `Salut, ${name}!\n\n` +
          `Îți mulțumim pentru completare. Atașat găsești o copie a acordului GDPR ` +
          `trimis echipei Tratamente Turcia by Medicross pentru ${procedure.label}.\n\n` +
          `Dacă ai întrebări, ne găsești la office@tratamente-turcia.ro sau pe WhatsApp.\n\n` +
          `Echipa Tratamente Turcia`,
        attachments: [{ filename: pdfFilename, content: pdfBuffer }],
      });
    } catch (err) {
      request.log.error({ err }, 'failed to send the patient their own copy of the GDPR registration e-mail');
    }

    const fullAddress = [addressLine1, addressLine2].filter(Boolean).join(', ');

    await query(
      `insert into gdpr_registrations
         (name, email, phone, address, date_of_birth, procedure_category, procedure_name, source_page, email_sent)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [name, email, phone, fullAddress,
        dateOfBirth, procedure.category, procedure.label, sourcePage, emailSent]);

    try {
      await logToSheet({
        name, email, phone, cnp,
        address: fullAddress,
        dateOfBirth,
        procedureName: procedure.label,
        procedureCategory: procedure.category,
        sourcePage,
        hasSignature: true,
      });
    } catch (err) {
      request.log.error({ err }, 'failed to log GDPR registration to Google Sheet');
    }

    if (!emailSent) {
      return reply.code(502).send({
        error: 'Datele au fost înregistrate, dar nu am putut trimite e-mailul de confirmare. ' +
          'Te rugăm să ne scrii și direct la office@tratamente-turcia.ro sau pe WhatsApp, ca să fim siguri că am primit totul.',
      });
    }
    return reply.code(201).send({ ok: true });
  });
}
