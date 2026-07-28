# Client Portal — implementation notes

`portal.html` / `assets/portal.css` / `assets/portal.js` / `materials/bodymap.html` implement the
patient dashboard from the `design_handoff_medicross_portal` handoff. This is a **static-site
demo**: there is no server, no auth, and no database anywhere in this repo. Everything a logged-in
patient would normally get from an API is instead a hardcoded fixture in `portal.js`
(`defaultState`) and the markup in `portal.html` (operations list, trip schedule, documents,
referral code). The only thing that's actually dynamic is the discount/consent state, which is
persisted client-side to `localStorage` under the key `medicross_portal_state_v1` purely so a page
reload doesn't reset the demo.

None of this is a substitute for a real backend. Before this portal is connected to real patient
data, the following must exist server-side:

## Auth & identity
- Real login/registration + session handling. The handoff explicitly excludes this ("login was
  simulated") — `portal.html` is reachable by anyone who knows the URL, with `noindex, nofollow`
  as the only gate.
- Registration must capture patient **sex (`f`/`m`)**, since it selects the 3D body model in
  `materials/bodymap.html`. Right now it's hardcoded to `'f'` in `portal.js`.

## Operations, schedule, documents
- `operations[]`, `schedule[]`, and `documents[]` must come from a real per-patient record
  (coordinator-managed), not the static arrays currently baked into `portal.html`.
- Document downloads need real access-controlled storage; the upload dropzone in `portal.js`
  (`addUploadedRow`) only renders an uploaded file's name in the DOM for the current session — it
  does not upload or store anything. A real implementation needs authenticated upload, malware
  scanning, and per-patient access control, since these are medical documents.

## Discount ledger — server-side verification required
The discount math in `portal.js` (`earned()` / `computeDiscount()`) matches the spec exactly:

```
earned(action) = action.done && (!action.needsConsent || action.consent)
total = min(sum of earned action percentages, 25)   // 25% cap
```

But it is **entirely client-side and trivially spoofable** — anyone can open devtools and flip
`localStorage["medicross_portal_state_v1"]` to claim the full 25%. Before this discount is honored
against a real invoice, a backend must:
- Independently verify each action actually happened: the Google review exists and is attributed
  to this patient, the video/photos were actually received, the referred friend actually enrolled.
- Recompute the discount server-side from that verified state — never trust a total posted from
  the client.
- Treat the Google-review action as verified-once-earned and non-revocable from the UI (this repo
  already disables that row's toggle button client-side, `portal.js` line ~145, but the real
  enforcement has to happen server-side too).

## Consent — GDPR
Video/photo consent here is a checkbox whose state lives in `localStorage` — there is no audit
trail. A real implementation needs, per patient:
- A durable, auditable consent record: what was consented to, when, and any subsequent revocation
  (also timestamped) — not just the current boolean.
- Revocation to actually stop use of the material (delete/quarantine stored media), not just
  toggle a discount off, since unchecking consent in this UI currently only zeroes out the discount
  contribution — it doesn't touch any stored file (there's nothing to store yet, but a real backend
  must wire revocation through to deletion).
- Because video/photos and the underlying medical procedures are personal, health-adjacent data,
  this consent and any stored media should be treated as GDPR special-category data — encrypt at
  rest, restrict access, and support the patient's right to erasure.

## 3D body map
`materials/bodymap.html` is a verbatim port of the handoff's `BodyMap.html` (three.js r0.184.0 via
import map, loaded from `unpkg.com`). It works as-is for real site visitors. Two things worth
knowing if this is later folded into a component framework instead of staying an iframe:
- Keep the `sex` / `mode` / `regions` inputs as props/state, same as the current `postMessage` API
  (see the handoff README's *Integration API* section) — the iframe/postMessage layer is only
  needed while it stays a standalone static page.
- Keep the synchronous first-render + `ResizeObserver` + `visibilitychange` re-render — it's there
  to avoid a real bug (empty canvas when the viewer starts inside an iframe or a backgrounded tab).
