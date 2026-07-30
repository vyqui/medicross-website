# Client Portal — implementation notes

The portal is now a **complete same-browser demo** of the full product:

| Page | Role |
|---|---|
| `login.html` | Sign-in for patients and admins (demo accounts below) |
| `portal.html` | Patient dashboard: 3D body map, operations, trip agenda, discount system, documents, referral code |
| `admin.html` | Admin console: manage each patient's interventions, trip agenda A–Z, see uploaded files, discount %, activity log |
| `assets/portal-data.js` | The shared data layer (`MedicrossDB`) both UIs read/write |
| `materials/bodymap.html` | The three.js 3D body map (iframe + postMessage API) |

**Demo accounts** — patient `andreea@demo.ro` / `demo`, admin `admin@medicross.ro` / `admin`.

Because GitHub Pages is a static host, `MedicrossDB` simulates the backend in `localStorage`
(key `mcx_db_v2`). Everything is functional *within one browser*: the patient's uploads appear in
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
   Files to move: `login.html`, `portal.html`, `admin.html`, `assets/portal*.js|css`,
   `assets/admin*`, `materials/bodymap.html`.
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
