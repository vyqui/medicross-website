# Client Portal — implementation notes

The portal is now a **complete same-browser demo** of the full product:

| Page | Role |
|---|---|
| `login.html` | Sign-in for patients and admins (demo accounts below) |
| `register.html` | Patient self-service sign-up (name, e-mail, phone, sex, password, GDPR tick) |
| `portal.html` | Patient dashboard: 3D body map, operations, trip agenda, discount system, documents, referral code |
| `admin.html` | Admin console: create accounts, manage interventions, trip agenda A–Z, uploaded files, discount %, GDPR status, activity log |
| `assets/portal-data.js` | The shared data layer (`MedicrossDB`) both UIs read/write, incl. the procedure catalogue |
| `materials/bodymap.html` | The three.js 3D body map (iframe + postMessage API) |

## Standard procedure catalogue

`PROCEDURES` in `assets/portal-data.js` is the single source of truth for every
aesthetic and bariatric procedure the site offers. Each entry carries the 3D body-map
regions and the view mode, so choosing a procedure in the admin console sets the
mannequin highlight automatically — no one has to know the mesh names:

| Procedure | 3D zone | View |
|---|---|---|
| Rinoplastie | `nose` | surface |
| Lifting facial și gât | `head,jaw,neck` | surface |
| Transplant de păr | `head` | surface |
| Transplant de sprâncene | `head` | surface |
| Mărire / Micșorare / Lifting mamar | `breast,chest` | surface |
| Abdominoplastie | `abdomen` | surface |
| Liposucție | `abdomen,hip` | surface |
| Brazilian Butt Lift (BBL) | `buttocks` | surface |
| Mommy Makeover | `abdomen,breast,chest` | surface |
| Gastric Sleeve | `stomach` | internal |
| Gastric Bypass | `stomach,intestine` | internal |
| Balon Gastric | `stomach,esophagus` | internal |

"Altă intervenție (personalizată)" allows a free-text name; the admin form then
validates the zones against the meshes the body map actually registers and warns
before saving something that would highlight nothing. To add a procedure, append one
entry to `PROCEDURES` — the admin picker, the patient's chips and the highlight all
follow.

## Accounts and the GDPR step

Accounts live in the store (`db.accounts`) so both paths persist:
- **Patients sign themselves up** at `register.html`. Sex is captured because it picks
  the 3D body model.
- **Admins create accounts** from the "Cont nou" card in the console.

Both paths **require the GDPR tick** and refuse to create the account without it. The
acceptance is stored with a timestamp (`gdprAccepted`, `gdprAcceptedAt`) and written to
the activity log. The patient list in the admin console shows **✓ GDPR** next to each
patient, or an amber "GDPR lipsă" when unsigned, and the selected patient's card has a
tick-box to record or withdraw it (also logged). The GDPR agreement text itself is a
placeholder — drop the real copy in and link it from the checkbox on `register.html`.

**Demo accounts** — patient `andreea@demo.ro` / `demo`, admin `admin@medicross.ro` / `admin`.
Accounts created by the admin get the initial password shown in the form (`medicross` by
default). Passwords are stored in clear text in localStorage because there is no server —
never put a real account in this prototype; production auth must hash server-side.

Because GitHub Pages is a static host, `MedicrossDB` simulates the backend in `localStorage`
(key `mcx_db_v3`). Everything is functional *within one browser*: the patient's uploads appear in
the admin console, admin edits to interventions/agenda appear in the patient portal, every
login/upload/consent change is written to a per-patient activity log, and files up to 2 MB are
stored inline (base64) so they can be previewed and downloaded from the admin side. Larger files
keep metadata only. This is a faithful functional prototype — **not** production infrastructure:
data does not leave the browser, and anyone can read localStorage.

## What you need to add to go live (platforms)

Every `MedicrossDB` function maps 1:1 onto an API endpoint, so the swap is mechanical. Two ways
to do it:

**Option A — Backend-as-a-Service (fastest, recommended): [Supabase](https://supabase.com)**
- **Auth** → Supabase Auth (email+password, magic links; roles via row-level security).
  Replaces `login()` / `session()` / `requireRole()`.
- **Database** → Supabase Postgres. Tables: `patients`, `operations`, `trip_items`, `documents`,
  `discount_actions`, `consent_log`, `activity_log` — the exact shapes are the objects in
  `portal-data.js`'s `seed()`.
- **File storage + CDN** → Supabase Storage (S3-compatible, CDN-fronted). Replaces the base64
  `dataUrl` hack; store the object key instead and serve signed URLs.
  Firebase (Auth + Firestore + Cloud Storage) is an equivalent alternative.

**Option B — own API**: any small API (Node/Laravel/Django) + Postgres + object storage
(Cloudflare R2 or AWS S3) behind a CDN (Cloudflare). More work, more control.

**Independent of A/B you will want:**
- **Cloudflare** (free tier) in front of the whole site — CDN for `materials/` (the
  ~250 MB of images/videos now hosted in-repo), plus the DNS you need for the subdomain below.
- **A transactional e-mail service** (Resend, Postmark) for login links / notifications.

## Non-negotiables before real patient data (GDPR)

- Server-side re-validation of every discount action before it is honored (review actually
  posted, media actually received, referral actually enrolled) — the client UI is only a mirror
  of verified state. The demo's activity log shows the shape of the required **auditable consent
  record**: who consented to what, when, and every revocation, all timestamped.
- Consent revocation must propagate to stored media (delete/quarantine), not just zero the
  discount.
- Uploaded video/photos + procedure data are health-adjacent personal data: encrypt at rest,
  restrict access, support erasure. Add malware scanning on upload.

## Subdomain plan (portal.tratamente-turcia.ro)

Requested: the portal should later live on its own subdomain. On GitHub Pages today it lives at
`/portal.html`; the code is already prepared for the move:

1. All portal-side links are **relative** (`login.html`, `admin.html`, `assets/…`,
   `materials/bodymap.html`), so the portal pages + their assets can be lifted into a separate
   repo/deployment served at `portal.tratamente-turcia.ro` without link rewrites.
   Files to move: `login.html`, `register.html`, `portal.html`, `admin.html`,
   `assets/portal*.js|css`, `assets/admin*`, `assets/auth.css`, `materials/bodymap.html`.
2. Create the `portal` CNAME in Cloudflare DNS → point it at the new deployment (GitHub Pages
   supports one custom domain per repo, so the subdomain needs its own repo — or host the portal
   on Cloudflare Pages/Vercel, which is also where the API from Option A/B will live).
3. On the marketing site, change the header's `portal.html` links to
   `https://portal.tratamente-turcia.ro` (one string in the shared header, present on every page).
4. Cookies/sessions: set the auth cookie on `.tratamente-turcia.ro` if you want sign-on shared
   between the main site and the portal.

## 3D body map

`materials/bodymap.html` is a verbatim port of the handoff's `BodyMap.html` (three.js r0.184.0
via `unpkg.com` import map). If it is later folded into a component framework, keep the
`sex`/`mode`/`regions` inputs and the synchronous first-render + `ResizeObserver` +
`visibilitychange` re-render (it prevents a blank canvas inside iframes/backgrounded tabs).
Consider self-hosting the three.js bundle when the backend work happens, so the portal has no
third-party runtime dependency.
