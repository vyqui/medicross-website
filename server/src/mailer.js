import nodemailer from 'nodemailer';

/* ---------------------------------------------------------------------------
   Two ways to send mail, tried in this order:

   1. Resend (RESEND_API_KEY set) — a plain HTTPS POST, so it isn't subject
      to whatever is blocking outbound SMTP from Railway to the Cyberfolks
      mailbox (confirmed via Railway's own logs: a clean ETIMEDOUT at the TCP
      connect stage, before authentication even starts — nothing SMTP_* can
      fix on our end).
   2. SMTP (SMTP_HOST/PORT/USER/PASS set) — the office@ mailbox directly.

   Whichever is configured is used; if both are, Resend wins. Neither being
   set throws with a clear message rather than crashing the whole app on
   boot — only the route that actually needs to send mail fails.
   --------------------------------------------------------------------------- */

let transport = null;

function getSmtpTransport() {
  if (transport) return transport;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    /* Port 465 is implicit TLS; anything else (587, 25) starts in the clear
       and upgrades via STARTTLS, which nodemailer handles on its own. */
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    /* nodemailer's defaults (2 minutes each) leave a patient staring at a
       spinner for minutes before the form can tell them anything. A mail
       host that's actually reachable responds in well under this; if it
       doesn't, failing fast matters more than waiting out a hung socket. */
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
  });
  return transport;
}

async function sendViaResend({ to, subject, text, attachments }) {
  const from = process.env.RESEND_FROM || process.env.SMTP_FROM || process.env.SMTP_USER;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      attachments: (attachments ?? []).map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
      })),
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend responded ${res.status}: ${body.slice(0, 500)}`);
  }
}

async function sendViaSmtp({ to, subject, text, attachments }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getSmtpTransport().sendMail({ from, to, subject, text, attachments });
}

export async function sendMail(message) {
  if (process.env.RESEND_API_KEY) return sendViaResend(message);

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'Set RESEND_API_KEY, or SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS, to send e-mail. See .env.example.');
  }
  return sendViaSmtp(message);
}
