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
| `GET` | `/api/me` | patient |
| `POST` | `/api/me/gdpr` | patient — the only way consent is ever accepted |
| `POST` | `/api/me/actions/:key` · `/api/me/view` | patient |
| `POST`/`DELETE` | `/api/me/documents[/:id]` | patient |
| `GET` | `/api/documents/:id` | owner or staff |
| `GET`/`POST` | `/api/admin/patients` | staff |
| `GET`/`PATCH` | `/api/admin/patients/:id` | staff |
| `PUT`/`DELETE` | `…/operations[/:opId]` | staff |
| `PUT` | `…/trip`, `…/trip/items[/:itemId]` | staff |
| `POST` | `…/trip/items/:itemId/move` | staff |
| `POST`/`PATCH`/`DELETE` | `…/referrals[/:refId]` | staff |
| `PUT` | `…/used-code` | staff |
| `POST` | `…/actions/:key/verify` | staff |
| `POST`/`DELETE` | `…/documents[/:docId]` | staff |
| `GET`/`PATCH` | `/api/admin/leads[/:id]` | staff |
| `POST` | `/api/leads` | anyone, rate limited |
| `GET` | `/api/config` | anyone |

Patient-facing routes read the patient id from the session, never from the URL,
so there is no identifier to tamper with. Admin routes return **404** rather
than 403 to a patient, so probing them reveals nothing.

## Still to do before real patients

- **Object storage.** `src/storage.js` writes to disk behind a three-function
  interface (`put` / `open` / `remove`) precisely so it can be swapped for
  Cloudflare R2 without touching anything else.
- **Malware scanning on upload.** Type and size are checked; contents are not.
- **Transactional e-mail** for password resets and lead notifications.
- **Erasure endpoint** for GDPR Article 17, including the stored documents.
- **Backups**, and a restore actually tested at least once.
