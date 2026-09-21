import nodemailer from 'nodemailer';

/* ---------------------------------------------------------------------------
   A single SMTP transport, built lazily from env vars so a deploy without
   them configured yet doesn't crash on boot — only the one route that needs
   it fails, with a clear error, until SMTP_* is set in Railway.
   --------------------------------------------------------------------------- */

let transport = null;

function getTransport() {
  if (transport) return transport;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS must be set to send e-mail. See .env.example.');
  }

  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    /* Port 465 is implicit TLS; anything else (587, 25) starts in the clear
       and upgrades via STARTTLS, which nodemailer handles on its own. */
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transport;
}

export async function sendMail({ to, subject, text, attachments }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransport().sendMail({ from, to, subject, text, attachments });
}
