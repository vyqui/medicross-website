# Medicross platform API

The backend behind the client portal and the admin console. Replaces the
`localStorage` prototype in `assets/portal-data.js` with a real database,
real password hashing, and discount amounts the browser cannot influence.

Node 22+, Fastify, Postgres. No build step, no native modules.

## What it does

- **Accounts.** Staff create a patient's login; the patient signs in and reads
  what the team has written. Passwords are hashed with scrypt (built into Node,
  so there is nothing to compile). Sessions live in Postgres behind a signed,
  httpOnly cookie and can be revoked.
- **WhatsApp magic links.** Staff can generate a passwordless link for a
  patient (`POST /api/admin/patients/:id/magic-link`) instead of relying on
  them having a password handy on their phone. Visiting it signs them
  straight into their own account — same session a password login creates —
  so it lands on whatever the portal shows first, GDPR gate included. Valid
  30 days, reusable until then (see `migrations/004_magic_links.sql`).
- **The medical record.** Operations, the Istanbul trip agenda, free-text
  details and uploaded documents — all authored by staff, all visible to
  exactly one patient.
- **GDPR consent, exclusively the patient's own act.** Admin creates the
  account unaccepted — there is no `gdprAccepted` field anywhere in the admin
  routes, not even in `PATCH`, so staff has no code path that could touch it.
  The patient accepts it themselves via `POST /api/me/gdpr`, which only runs
  inside their own session and only moves the flag false → true. The admin
  console shows the status read-only.
- **Discounts, decided server-side.** A patient claiming a follow earns nothing.
  Only a member of staff confirming it writes `verified_at`, and only
  `verified_at` counts. Amounts live in `src/discounts.js` and are never read
  from a request body.
- **Leads.** The contact forms currently open WhatsApp and record nothing. There
  is now a `POST /api/leads` endpoint that stores the enquiry first.

## Running it locally

You need a Postgres to point at. Then:

```bash
cp .env.example .env          # fill in DATABASE_URL and SESSION_SECRET
npm install
npm run migrate               # also runs automatically on boot
ADMIN_EMAIL=admin@medicross.ro ADMIN_PASSWORD=<12+ chars> npm run seed:admin
npm run dev
```

`npm run smoke` exercises the whole thing end to end — account creation, the
patient's view, every discount rule, cross-patient isolation, password changes
and lead capture. **Point it at a disposable database**, since it writes.

## Deploying to Railway

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. In the service settings set **Root Directory** to `server`, so Railway builds
   this folder rather than the marketing site at the repository root.
3. **Add a Postgres service** to the same project. Railway injects
   `DATABASE_URL` automatically — reference it rather than pasting a URL.
4. **Add a Volume** and mount it at `/data`. Without one, uploaded documents are
   deleted on every redeploy.
5. Set the remaining variables:

   | Variable | Value |
   |---|---|
   | `SESSION_SECRET` | 32+ random bytes — `openssl rand -hex 32` |
   | `STORAGE_DIR` | `/data/documents` |
   | `ALLOWED_ORIGINS` | `https://tratamente-turcia.ro` |
   | `COOKIE_DOMAIN` | `.tratamente-turcia.ro` |
   | `NODE_ENV` | `production` |

6. Deploy. Migrations run on boot, so there is no release command to configure.
7. Create the first administrator once, from the Railway shell:
   `ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run seed:admin`
8. Add the custom domain `platforma.tratamente-turcia.ro` and point a CNAME at the
   address Railway prints.

Pick the **EU region** when creating the project. Patient records are
special-category health data under GDPR Article 9, and moving the database
region later means recreating it.

## API

Everything is under `/api`. Session comes from the cookie; no tokens in URLs.

| Method | Path | Who |
|---|---|---|
| `POST` | `/api/auth/login` · `/logout` · `/password` | anyone / signed in |
| `GET` | `/api/auth/session` | anyone |
| `GET` | `/api/auth/magic/:token` | anyone with a valid link |
| `GET` | `/api/me` | patient |
| `POST` | `/api/me/gdpr` | patient — the only way consent is ever accepted |
| `POST` | `/api/me/actions/:key` · `/api/me/view` | patient |
| `POST`/`DELETE` | `/api/me/documents[/:id]` | patient |
| `GET` | `/api/documents/:id` | owner or staff |
| `GET`/`POST` | `/api/admin/patients` | staff |
| `GET`/`PATCH` | `/api/admin/patients/:id` | staff |
| `POST` | `…/magic-link` | staff |
| `PUT`/`DELETE` | `…/operations[/:opId]` | staff |
| `PUT` | `…/trip`, `…/trip/items[/:itemId]` | staff |
| `POST` | `…/trip/items/:itemId/move` | staff |
| `POST`/`PATCH`/`DELETE` | `…/referrals[/:refId]` | staff |
| `PUT` | `…/used-code` | staff |
| `POST` | `…/actions/:key/verify` | staff |
| `POST`/`DELETE` | `…/documents[/:docId]` | staff |
| `GET`/`PATCH` | `/api/admin/leads[/:id]` | staff |
| `POST` | `/api/leads` | anyone, rate limited |
| `POST` | `/api/gdpr-registration` | anyone, rate limited |
| `GET` | `/api/config` | anyone |

Patient-facing routes read the patient id from the session, never from the URL,
so there is no identifier to tamper with. Admin routes return **404** rather
than 403 to a patient, so probing them reveals nothing.

## GDPR travel-registration form

`POST /api/gdpr-registration` (called from `acord-gdpr-completare.html` on the
marketing site) validates the submission — including a real Romanian CNP
checksum — renders a PDF matching the old form's layout (`src/gdpr-pdf.js`,
via a bundled DejaVu Sans font: pdfkit's built-in Helvetica mangles ă/â/î/ș/ț),
e-mails it to `GDPR_NOTIFY_EMAIL` (`src/mailer.js`), and inserts a row into
`gdpr_registrations`. The CNP and the signature image are never written to
the database — they exist only in the emailed PDF (and, per explicit
direction, the CNP is also sent to the Google Sheet below — the signature
image itself still isn't, anywhere but the PDF).

`src/mailer.js` sends via **Resend** (an HTTPS API call) if `RESEND_API_KEY`
is set, otherwise via **SMTP** to the office@ mailbox directly. Resend is the
one actually confirmed working from Railway — the SMTP path was hitting a
clean `ETIMEDOUT` at the TCP connect stage (visible in Railway's own logs),
meaning something between Railway and Cyberfolks' mail server is blocking
the connection outright, before credentials are even checked. SMTP is kept
as a fallback in case that gets resolved on Cyberfolks' end later, but
Resend is what's actually recommended — see `.env.example` for both.

Required env either way: `GDPR_NOTIFY_EMAIL`, plus `RESEND_API_KEY` +
`RESEND_FROM`, or `SMTP_HOST`/`PORT`/`USER`/`PASS`. Optional:
`GDPR_SHEET_WEBHOOK_URL`, if the team also wants each registration logged to
a Google Sheet — see below.

### Logging to Google Sheets

There is no Google Sheets API credential anywhere in this app, on purpose.
Instead, `GDPR_SHEET_WEBHOOK_URL` points at a Google Apps Script Web App
bound to the sheet, which the route POSTs a plain JSON row to after every
registration (including the CNP; still never the signature image itself,
only whether one was drawn). Setting it up, once, on the sheet itself:

1. Open the sheet → **Extensions → Apps Script**.
2. Replace whatever's in `Code.gs` with:

   ```javascript
   function doPost(e) {
     var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
     var data = JSON.parse(e.postData.contents);

     var headers = ['Data înregistrării', 'Nume', 'E-mail', 'Telefon', 'CNP',
       'Intervenție', 'Categorie', 'Adresă', 'Data nașterii', 'Semnătură', 'Pagina sursă'];
     if (sheet.getLastRow() === 0) {
       sheet.appendRow(headers);
       // CNP is 13 digits — as a number, Sheets would render it in
       // scientific notation and could drop a leading digit. Column E (CNP)
       // stays formatted as plain text so it always displays exactly as sent.
       sheet.getRange('E:E').setNumberFormat('@');
     }

     sheet.appendRow([
       new Date(),
       data.name || '', data.email || '', data.phone || '', data.cnp || '',
       data.procedureName || '', data.procedureCategory || '',
       data.address || '', data.dateOfBirth || '',
       data.hasSignature ? 'SEMNAT' : '—',
       data.sourcePage || ''
     ]);

     return ContentService.createTextOutput(JSON.stringify({ ok: true }))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

3. Save the project (any name).
4. **Deploy → New deployment** → type **Web app**.
   Execute as **Me**, who has access **Anyone**.
5. **Deploy**, authorize the script when Google prompts (it needs permission
   to edit this one spreadsheet), then copy the URL ending in `/exec`.
6. Set that URL as `GDPR_SHEET_WEBHOOK_URL` in Railway on this service.

Leaving the variable unset just skips the sheet row — the registration is
still saved and still e-mailed.

## Still to do before real patients

- **Object storage.** `src/storage.js` writes to disk behind a three-function
  interface (`put` / `open` / `remove`) precisely so it can be swapped for
  Cloudflare R2 without touching anything else.
- **Malware scanning on upload.** Type and size are checked; contents are not.
- **Transactional e-mail** for password resets and lead notifications.
- **Erasure endpoint** for GDPR Article 17, including the stored documents.
- **Backups**, and a restore actually tested at least once.
