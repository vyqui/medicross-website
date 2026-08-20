/* Medicross portal — shared data layer (demo backend).
 *
 * GitHub Pages is a static host: there is no server, database or file store
 * behind this site. This module simulates all of that in localStorage so the
 * patient portal (portal.html) and the admin interface (admin.html) are fully
 * functional as a same-browser demo: what the patient uploads, the admin sees;
 * what the admin edits, the patient sees.
 *
 * Every function here maps 1:1 onto the API a real backend must provide.
 * See README-PORTAL.md for the production architecture (auth, DB, object
 * storage + CDN) and the subdomain migration plan.
 */
(function () {
  'use strict';

  var DB_KEY = 'mcx_db_v3';
  var SESSION_KEY = 'mcx_session_v2';
  var SCHEMA = 4;
  var MAX_STORED_FILE = 2 * 1024 * 1024;   // 2 MB per file kept inline (localStorage limit)

  /* ---------------- reward amounts (single source of truth) ---------------
   * Fixed euro amounts, not percentages, and they stack:
   *
   *   · social bundle .... 30 € in total for following Instagram and
   *     Facebook, leaving a review and sharing a post — 7,50 € per action,
   *     so a patient who only does two of the four collects 15 €.
   *   · referral ......... 70 € to the patient whose code was used, paid
   *     only once the referred person actually has surgery.
   *   · code used ........ 20 € to the patient who signs up with someone
   *     else's code.
   *
   * ACTION_REWARD is what the UI renders and what discount() adds up, so a
   * price change happens here and nowhere else. Every amount still has to be
   * re-verified server-side before it is honoured (see README-PORTAL.md) —
   * localStorage is trivially editable by the patient.
   * ---------------------------------------------------------------------- */
  var ACTION_REWARD = { instagram: 7.5, facebook: 7.5, review: 7.5, share: 7.5 };

  /* Where the "Deschide ↗" button sends the patient. Left blank until the real
     profile and review URLs are known — a blank entry simply hides the button,
     so the action still works as a self-declaration. */
  var SOCIAL_LINKS = { instagram: '', facebook: '', review: '', share: '' };
  var SOCIAL_BUNDLE = 30;      // the four actions above, completed
  var REFERRAL_OPERATED = 70;  // per referred patient who goes through with surgery
  var CODE_USED = 20;          // for signing up with someone else's code

  function freshActions(seedState) {
    var s = seedState || {};
    var out = {};
    Object.keys(ACTION_REWARD).forEach(function (k) {
      out[k] = {
        done: !!s[k],
        needsConsent: false,
        consent: false,
        eur: ACTION_REWARD[k]
      };
    });
    return out;
  }

  /* ---------------- standard procedure catalogue --------------------------
   * Every aesthetic + bariatric procedure the site offers. `regions` are the
   * mesh names the 3D body map actually registers (surface: abdomen, arm,
   * breast, buttocks, chest, foot, hand, head, hip, jaw, neck, nose, thigh;
   * internal: stomach, intestine, esophagus), so picking a procedure in the
   * admin console sets the mannequin highlight automatically.
   * ---------------------------------------------------------------------- */
  var PROCEDURES = [
    // ---- chirurgie estetică ----
    { key: 'rinoplastie', name: 'Rinoplastie', cat: 'estetica',
      detail: 'Chirurgie estetică facială', regions: 'nose', viewMode: 'surface', page: 'rinoplastie.html' },
    { key: 'lifting-facial', name: 'Lifting facial și gât', cat: 'estetica',
      detail: 'Chirurgie estetică facială', regions: 'head,jaw,neck', viewMode: 'surface', page: 'lifting-facial-si-gat.html' },
    { key: 'transplant-par', name: 'Transplant de păr', cat: 'estetica',
      detail: 'Transplant capilar FUE / DHI', regions: 'head', viewMode: 'surface', page: 'transplant-de-par.html' },
    { key: 'transplant-sprancene', name: 'Transplant de sprâncene', cat: 'estetica',
      detail: 'Transplant capilar — sprâncene', regions: 'head', viewMode: 'surface', page: 'transplant-de-sprancene.html' },
    { key: 'marire-mamara', name: 'Mărire mamară', cat: 'estetica',
      detail: 'Intervenții mamare · implant', regions: 'breast,chest', viewMode: 'surface', page: 'interventii-mamare.html' },
    { key: 'micsorare-mamara', name: 'Micșorare mamară', cat: 'estetica',
      detail: 'Intervenții mamare · reducție', regions: 'breast,chest', viewMode: 'surface', page: 'interventii-mamare.html' },
    { key: 'lifting-mamar', name: 'Lifting mamar', cat: 'estetica',
      detail: 'Intervenții mamare · mastopexie', regions: 'breast,chest', viewMode: 'surface', page: 'interventii-mamare.html' },
    { key: 'abdominoplastie', name: 'Abdominoplastie', cat: 'estetica',
      detail: 'Remodelare abdominală', regions: 'abdomen', viewMode: 'surface', page: 'abdominoplastie.html' },
    { key: 'liposuctie', name: 'Liposucție', cat: 'estetica',
      detail: 'Remodelare corporală', regions: 'abdomen,hip', viewMode: 'surface', page: 'liposuctie.html' },
    { key: 'bbl', name: 'Brazilian Butt Lift (BBL)', cat: 'estetica',
      detail: 'Remodelare fesieră cu grăsime proprie', regions: 'buttocks', viewMode: 'surface', page: 'brazilian-butt-lift.html' },
    { key: 'mommy-makeover', name: 'Mommy Makeover', cat: 'estetica',
      detail: 'Abdominoplastie + Mamare', regions: 'abdomen,breast,chest', viewMode: 'surface', page: 'abdominoplastie.html' },
    // ---- chirurgie bariatrică ----
    { key: 'gastric-sleeve', name: 'Gastric Sleeve', cat: 'bariatrica',
      detail: 'Chirurgie bariatrică', regions: 'stomach', viewMode: 'internal', page: 'gastric-sleeve.html' },
    { key: 'gastric-bypass', name: 'Gastric Bypass', cat: 'bariatrica',
      detail: 'Chirurgie bariatrică', regions: 'stomach,intestine', viewMode: 'internal', page: 'gastric-bypass.html' },
    { key: 'balon-gastric', name: 'Balon Gastric', cat: 'bariatrica',
      detail: 'Procedură bariatrică nechirurgicală', regions: 'stomach,esophagus', viewMode: 'internal', page: 'balon-gastric.html' }
  ];
  var CATEGORY_LABEL = { estetica: 'Chirurgie Estetică', bariatrica: 'Chirurgie Bariatrică' };

  /* ---------------- partner hospitals & clinics ---------------------------
   * The network the trip agenda draws from; `page` links the site's own
   * detail page for that hospital.
   * ---------------------------------------------------------------------- */
  var HOSPITALS = [
    { name: 'Liv Hospital Vadistanbul', page: 'spitalul-liv.html' },
    { name: 'Medical Park Bahçelievler Hospital', page: 'medical-park-bahcelievler-hospital.html' },
    { name: 'Medical Park Gaziosmanpaşa', page: 'medical-park-gaziosmanpasa.html' },
    { name: 'VM Medical Park Florya', page: 'vm-medical-park-florya.html' },
    { name: 'Medicana Health Group', page: 'medicana-health-group.html' },
    { name: 'Academic Hospital Istanbul', page: 'academic-hospital-istanbul.html' },
    { name: 'Avrasya Hospital International', page: 'avrasya-hospital-international.html' },
    { name: 'Central Hospital Istanbul', page: 'central-hospital.html' },
    { name: 'HAB Dental Clinic Vadistanbul', page: 'hab-dental-clinic-vadistanbul.html' },
    { name: 'Emine Erdem Hair Clinic', page: 'emine-erdem-hair-clinic.html' }
  ];

  function procedure(key) {
    for (var i = 0; i < PROCEDURES.length; i++) if (PROCEDURES[i].key === key) return PROCEDURES[i];
    return null;
  }

  /* ---------------- seed data --------------------------------------------- */
  function seed() {
    return {
      v: SCHEMA,
      // Demo credentials only. Passwords sit here in clear text because this is a
      // localStorage prototype with no server — never put a real patient account
      // in it. Production auth must hash server-side (bcrypt/argon2); see
      // README-PORTAL.md.
      accounts: [
        { email: 'andreea@demo.ro', pass: 'demo', role: 'patient', patientId: 'p1' },
        { email: 'admin@medicross.ro', pass: 'admin', role: 'admin', patientId: null }
      ],
      patients: [{
        id: 'p1',
        name: 'Andreea M.',
        initials: 'AM',
        email: 'andreea@demo.ro',
        phone: '+40 7xx xxx xxx',
        sex: 'f',
        referralCode: 'MEDI-ANDREEA-2K6',
        // one friend signed up and operated (70 €), one is still only signed up (0 € yet)
        referrals: [
          { id: 'r1', name: 'Ioana P.', status: 'operat', at: '2026-05-04T10:00:00Z', operatedAt: '2026-07-19T08:30:00Z' },
          { id: 'r2', name: 'Cristina D.', status: 'inscris', at: '2026-07-02T16:40:00Z', operatedAt: null }
        ],
        // she joined with a friend's code, so the 20 € applies to her too
        usedCode: { code: 'MEDI-RALUCA-8F1', at: '2026-04-11T12:00:00Z' },
        gdprAccepted: true,
        gdprAcceptedAt: '2026-06-28T09:12:00Z',
        details: 'Pacientă evaluată pentru Mommy Makeover (abdominoplastie + mamare) la Liv Hospital. '
          + 'Analizele pre-operatorii sunt complete și în parametri. Urmează consultația cu medicul '
          + 'chirurg pe 12 august, în ziua sosirii, iar intervenția în aceeași zi. Recuperare '
          + 'estimată 3 zile în Istanbul, cu control înainte de întoarcere. Gastric Sleeve rămâne '
          + 'în discuție pentru anul viitor, după stabilizarea greutății.',
        actions: freshActions({ instagram: true, review: true }),
        activeOp: 'mommy',
        mode: 'surface',
        operations: [
          { id: 'op1', name: 'Mommy Makeover', detail: 'Abdominoplastie + Mamare · Liv Hospital',
            status: 'programata', date: '12 Aug 2026', regions: 'abdomen,breast', viewMode: 'surface', active: true },
          { id: 'op2', name: 'Gastric Sleeve', detail: 'Chirurgie bariatrică · în discuție',
            status: 'evaluare', date: '', regions: 'stomach', viewMode: 'internal', active: false },
          { id: 'op3', name: 'Rinoplastie', detail: 'Finalizată · control la 6 luni',
            status: 'finalizata', date: '02 Mar 2026', regions: 'nose', viewMode: 'surface', active: false }
        ],
        trip: {
          title: 'Călătoria mea · Istanbul',
          subtitle: 'Mommy Makeover · 11–16 August 2026 · totul organizat de echipa Medicross',
          items: [
            { id: 't1', date: '11 Aug', desc: 'Zbor București→Istanbul + transfer privat', icon: 'plane', surgery: false, hospital: '' },
            { id: 't2', date: '11 Aug', desc: 'Cazare hotel 5★', icon: 'building', surgery: false, hospital: '' },
            { id: 't3', date: '12 Aug', desc: 'Consultație + analize', icon: 'tag', surgery: false, hospital: 'Liv Hospital Vadistanbul' },
            { id: 't4', date: '12 Aug', desc: 'Intervenție', icon: 'plus', surgery: true, hospital: 'Liv Hospital Vadistanbul' },
            { id: 't5', date: '13–15 Aug', desc: 'Recuperare & control', icon: 'star', surgery: false, hospital: 'Liv Hospital Vadistanbul' },
            { id: 't6', date: '16 Aug', desc: 'Întoarcere acasă', icon: 'home', surgery: false, hospital: '' }
          ]
        },
        documents: [
          { id: 'd1', name: 'Analize pre-operatorii.pdf', size: 1258291, type: 'application/pdf',
            uploadedAt: '2026-07-01T10:00:00Z', by: 'staff', dataUrl: null },
          { id: 'd2', name: 'Plan de tratament.pdf', size: 655360, type: 'application/pdf',
            uploadedAt: '2026-07-05T14:30:00Z', by: 'staff', dataUrl: null }
        ],
        log: [
          { t: '2026-07-05T14:30:00Z', who: 'staff', what: 'A încărcat „Plan de tratament.pdf”' },
          { t: '2026-07-01T10:00:00Z', who: 'staff', what: 'A încărcat „Analize pre-operatorii.pdf”' }
        ]
      }]
    };
  }

  /* ---------------- persistence ------------------------------------------- */
  // Fills in fields added by later versions so an older saved store keeps working.
  function normalize(db) {
    db.v = SCHEMA;
    db.patients.forEach(function (p) {
      if (typeof p.details !== 'string') p.details = '';
      if (typeof p.gdprAccepted !== 'boolean') p.gdprAccepted = false;
      if (!('gdprAcceptedAt' in p)) p.gdprAcceptedAt = null;
      /* Schema 4 moved discounts from percentages to fixed euro amounts.
         Carry old accounts over instead of wiping them: the four new social
         actions start from whatever the patient had already done (the old
         "google" review becomes the new "review"), and a bare referralCount
         becomes that many pending referrals — pending, not paid, because the
         old model never recorded whether the friend actually operated. */
      if (!p.actions || !('instagram' in p.actions)) {
        var was = p.actions || {};
        p.actions = freshActions({
          review: !!(was.google && was.google.done),
          share: !!(was.photos && was.photos.done && was.photos.consent)
        });
      }
      Object.keys(ACTION_REWARD).forEach(function (k) {
        if (!p.actions[k]) p.actions[k] = { done: false, needsConsent: false, consent: false, eur: ACTION_REWARD[k] };
        p.actions[k].eur = ACTION_REWARD[k];   // amounts always come from the table
        delete p.actions[k].pct;
      });
      Object.keys(p.actions).forEach(function (k) {
        if (!(k in ACTION_REWARD)) delete p.actions[k];   // drop retired actions
      });
      if (!Array.isArray(p.referrals)) {
        var n = typeof p.referralCount === 'number' ? p.referralCount : 0;
        p.referrals = [];
        for (var i = 0; i < n; i++) {
          p.referrals.push({ id: uid('r'), name: 'Recomandare ' + (i + 1), patientId: null,
            status: 'inscris', at: p.gdprAcceptedAt || new Date().toISOString(), operatedAt: null });
        }
      }
      delete p.referralCount;
      if (!('usedCode' in p)) p.usedCode = null;
      if (!p.trip) p.trip = { title: 'Călătoria mea · Istanbul', subtitle: '', items: [] };
      if (!Array.isArray(p.trip.items)) p.trip.items = [];
      p.trip.items.forEach(function (t) { if (typeof t.hospital !== 'string') t.hospital = ''; });
      if (!Array.isArray(p.operations)) p.operations = [];
      if (!Array.isArray(p.documents)) p.documents = [];
      if (!Array.isArray(p.log)) p.log = [];
    });
    return db;
  }

  function load() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) {
        var db = JSON.parse(raw);
        // Migrate rather than reseed, so accounts created earlier survive an update,
        // and persist the upgrade so the stored shape matches the current schema.
        if (db && Array.isArray(db.patients) && Array.isArray(db.accounts)) {
          var stale = db.v !== SCHEMA;
          normalize(db);
          if (stale) save(db);
          return db;
        }
      }
    } catch (e) { /* corrupted — reseed */ }
    var fresh = seed();
    save(fresh);
    return fresh;
  }

  function save(db) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      // quota exceeded — drop inline file bodies (keep metadata) and retry once
      db.patients.forEach(function (p) {
        p.documents.forEach(function (d) { if (d.dataUrl) d.dataUrl = null; });
      });
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
      catch (e2) { return false; }
    }
  }

  var db = load();

  function patient(id) {
    for (var i = 0; i < db.patients.length; i++) if (db.patients[i].id === id) return db.patients[i];
    return null;
  }

  function logEvent(p, who, what) {
    p.log.unshift({ t: new Date().toISOString(), who: who, what: what });
    if (p.log.length > 200) p.log.length = 200;
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 9);
  }

  /* ---------------- auth --------------------------------------------------- */
  function login(email, pass) {
    email = String(email || '').trim().toLowerCase();
    for (var i = 0; i < db.accounts.length; i++) {
      var a = db.accounts[i];
      if (a.email === email && a.pass === pass) {
        var s = { email: a.email, role: a.role, patientId: a.patientId, at: new Date().toISOString() };
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        if (a.patientId) {
          var p = patient(a.patientId);
          if (p) { logEvent(p, 'pacient', 'Autentificare în portal'); save(db); }
        }
        return s;
      }
    }
    return null;
  }

  function logout() { localStorage.removeItem(SESSION_KEY); }

  function accountFor(email) {
    email = String(email || '').trim().toLowerCase();
    for (var i = 0; i < db.accounts.length; i++) if (db.accounts[i].email === email) return db.accounts[i];
    return null;
  }

  function initialsOf(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function referralCodeFor(name) {
    var base = String(name || 'client').trim().split(/\s+/)[0]
      .toUpperCase().replace(/[^A-Z]/g, '') || 'CLIENT';
    return 'MEDI-' + base + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  /* Creates a patient account + its patient record.
   * `gdpr` must be true — the consent step is mandatory for both the
   * self-service sign-up and admin-created accounts. */
  function patientByCode(code) {
    var c = String(code || '').trim().toUpperCase();
    for (var i = 0; i < db.patients.length; i++) {
      if (String(db.patients[i].referralCode || '').toUpperCase() === c) return db.patients[i];
    }
    return null;
  }

  // an action pays out only when it is done and, where the material is the
  // patient's own, only while the marketing consent still stands
  function earnedAction(a) { return !!a && a.done && (!a.needsConsent || a.consent); }

  function createPatient(opts) {
    var name = String(opts.name || '').trim();
    var email = String(opts.email || '').trim().toLowerCase();
    var pass = String(opts.pass || '');
    var sex = opts.sex === 'm' ? 'm' : 'f';

    if (name.length < 3) return { error: 'Introdu numele complet.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Adresa de e-mail nu este validă.' };
    if (pass.length < 4) return { error: 'Parola trebuie să aibă minim 4 caractere.' };
    if (accountFor(email)) return { error: 'Există deja un cont cu acest e-mail.' };
    if (!opts.gdpr) return { error: 'Trebuie să accepți prelucrarea datelor (GDPR) pentru a continua.' };

    var now = new Date().toISOString();
    var p = {
      id: uid('p'), name: name, initials: initialsOf(name), email: email,
      phone: String(opts.phone || '').trim(), sex: sex,
      referralCode: referralCodeFor(name), referrals: [],
      usedCode: null,
      gdprAccepted: true, gdprAcceptedAt: now,
      details: '',
      actions: freshActions(),
      activeOp: null, mode: 'surface',
      operations: [],
      trip: { title: 'Călătoria mea · Istanbul', subtitle: 'Se stabilește după evaluarea medicală.', items: [] },
      documents: [],
      log: [
        { t: now, who: 'sistem', what: 'Acord GDPR acceptat la crearea contului' },
        { t: now, who: opts.by === 'admin' ? 'admin' : 'pacient',
          what: opts.by === 'admin' ? 'Cont creat de echipa Medicross' : 'Cont creat prin înregistrare' }
      ]
    };
    db.patients.push(p);
    db.accounts.push({ email: email, pass: pass, role: 'patient', patientId: p.id });

    /* A referral code entered at sign-up credits both sides: 20 € to the new
       patient straight away, and a pending 70 € to whoever owns the code —
       pending because it is only earned once this patient actually operates.
       An unknown or own code is ignored rather than rejected, so a typo never
       blocks a registration. */
    var code = String(opts.code || '').trim().toUpperCase();
    if (code && code !== p.referralCode) {
      var owner = patientByCode(code);
      if (owner) {
        p.usedCode = { code: owner.referralCode, at: now };
        logEvent(p, 'sistem', 'S-a înscris cu codul ' + owner.referralCode +
          ' — reducere de ' + CODE_USED + ' € aplicată');
        owner.referrals.push({
          id: uid('r'), name: p.name, patientId: p.id,
          status: 'inscris', at: now, operatedAt: null
        });
        logEvent(owner, 'sistem', p.name + ' s-a înscris cu codul tău — ' +
          REFERRAL_OPERATED + ' € se acordă după ce se operează');
      }
    }

    save(db);
    return { patient: p };
  }

  function saveDetails(pid, text, who) {
    var p = patient(pid); if (!p) return;
    var next = String(text || '');
    if (p.details === next) return;
    p.details = next;
    logEvent(p, who || 'admin', next ? 'A actualizat descrierea pacientului' : 'A șters descrierea pacientului');
    save(db);
  }

  function setGdpr(pid, accepted, who) {
    var p = patient(pid); if (!p) return;
    if (p.gdprAccepted === !!accepted) return;
    p.gdprAccepted = !!accepted;
    p.gdprAcceptedAt = accepted ? new Date().toISOString() : null;
    logEvent(p, who || 'admin', accepted ? 'Acord GDPR marcat ca semnat' : 'Acord GDPR retras');
    save(db);
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function requireRole(role) {
    var s = session();
    var here = location.pathname.split('/').pop() || 'index.html';
    // Never bounce silently: carry the intended destination so the login screen
    // can explain what happened and send you back here once you have the right
    // account. location.replace keeps the back button from ping-ponging.
    if (!s) {
      location.replace('login.html?next=' + encodeURIComponent(here));
      return null;
    }
    // Admins may open the patient portal read-only (portal.js marks the session
    // as staff so nothing is attributed to the patient). Patients have no access
    // to the admin console.
    if (role === 'admin' && s.role !== 'admin') {
      location.replace('login.html?next=' + encodeURIComponent(here) + '&denied=1');
      return null;
    }
    return s;
  }

  /* ---------------- public API -------------------------------------------- */
  var API = window.MedicrossDB = {
    // auth
    login: login, logout: logout, session: session, requireRole: requireRole,
    createPatient: createPatient, setGdpr: setGdpr, saveDetails: saveDetails,
    HOSPITALS: HOSPITALS,
    accounts: function () { return db.accounts; },
    accountForPatient: function (pid) {
      for (var i = 0; i < db.accounts.length; i++) if (db.accounts[i].patientId === pid) return db.accounts[i];
      return null;
    },

    // standard procedure catalogue (drives the admin picker + 3D highlight)
    PROCEDURES: PROCEDURES,
    CATEGORY_LABEL: CATEGORY_LABEL,
    procedure: procedure,

    // reads
    patients: function () { return db.patients; },
    patient: patient,

    // discount / actions (patient side)
    setAction: function (pid, key, patch, who) {
      var p = patient(pid); if (!p || !p.actions[key]) return;
      var a = p.actions[key];
      if ('done' in patch && patch.done !== a.done) {
        logEvent(p, who || 'pacient', (patch.done ? 'A finalizat' : 'A anulat') + ' acțiunea „' + key + '”');
      }
      if ('consent' in patch && patch.consent !== a.consent) {
        logEvent(p, who || 'pacient', (patch.consent ? 'A acordat' : 'A retras') +
          ' consimțământul de marketing pentru „' + key + '”');
      }
      for (var k in patch) a[k] = patch[k];
      save(db);
    },
    setView: function (pid, activeOp, mode) {
      var p = patient(pid); if (!p) return;
      if (activeOp) p.activeOp = activeOp;
      if (mode) p.mode = mode;
      save(db);
    },
    /* The amounts, in euro, and how they were reached. Both the patient view
       and the admin console render straight off this, so neither can drift
       from the other or from ACTION_REWARD. */
    discountBreakdown: function (pid) {
      var p = patient(pid);
      if (!p) return { lines: [], social: 0, referral: 0, code: 0, total: 0, potential: 0 };

      var lines = [], social = 0, socialMax = 0;
      Object.keys(p.actions).forEach(function (k) {
        var a = p.actions[k];
        var got = earnedAction(a);
        socialMax += a.eur;
        if (got) social += a.eur;
        lines.push({ key: k, kind: 'social', eur: a.eur, earned: got, action: a });
      });

      var operated = p.referrals.filter(function (r) { return r.status === 'operat'; }).length;
      var pending = p.referrals.filter(function (r) { return r.status === 'inscris'; }).length;
      var referral = operated * REFERRAL_OPERATED;
      lines.push({
        key: 'referral', kind: 'referral', eur: REFERRAL_OPERATED,
        earned: operated > 0, count: operated, pending: pending
      });

      var code = p.usedCode ? CODE_USED : 0;
      lines.push({ key: 'usedCode', kind: 'code', eur: CODE_USED, earned: !!p.usedCode,
        code: p.usedCode ? p.usedCode.code : null });

      return {
        lines: lines,
        social: social, socialMax: socialMax,
        referral: referral, operated: operated, pending: pending,
        code: code,
        total: social + referral + code,
        // what is on the table right now: the full social bundle, the 20 € if a
        // code was used, and 70 € for each referral already recorded
        potential: socialMax + code + (operated + pending) * REFERRAL_OPERATED
      };
    },
    discount: function (pid) { return API.discountBreakdown(pid).total; },

    // ---- referrals (admin-managed: the 70 € is only earned on surgery) ----
    addReferral: function (pid, name, who) {
      var p = patient(pid); if (!p) return null;
      var nm = String(name || '').trim();
      if (!nm) return null;
      var r = { id: uid('r'), name: nm, patientId: null, status: 'inscris',
                at: new Date().toISOString(), operatedAt: null };
      p.referrals.push(r);
      logEvent(p, who || 'admin', 'A înregistrat recomandarea „' + nm + '”');
      save(db);
      return r;
    },
    setReferralStatus: function (pid, rid, status, who) {
      var p = patient(pid); if (!p) return;
      if (['inscris', 'operat', 'anulat'].indexOf(status) < 0) return;
      p.referrals.forEach(function (r) {
        if (r.id !== rid || r.status === status) return;
        r.status = status;
        r.operatedAt = status === 'operat' ? new Date().toISOString() : null;
        logEvent(p, who || 'admin', 'Recomandarea „' + r.name + '” → ' +
          (status === 'operat' ? 'operat, ' + REFERRAL_OPERATED + ' € acordați'
           : status === 'anulat' ? 'anulată' : 'înscris, în așteptare'));
      });
      save(db);
    },
    removeReferral: function (pid, rid, who) {
      var p = patient(pid); if (!p) return;
      p.referrals = p.referrals.filter(function (r) {
        if (r.id === rid) logEvent(p, who || 'admin', 'A șters recomandarea „' + r.name + '”');
        return r.id !== rid;
      });
      save(db);
    },
    setUsedCode: function (pid, code, who) {
      var p = patient(pid); if (!p) return { error: 'Pacient inexistent.' };
      var c = String(code || '').trim().toUpperCase();
      if (!c) {
        if (p.usedCode) logEvent(p, who || 'admin', 'A eliminat codul de reducere folosit');
        p.usedCode = null; save(db); return { ok: true };
      }
      if (c === p.referralCode) return { error: 'Pacientul nu poate folosi propriul cod.' };
      var owner = patientByCode(c);
      if (!owner) return { error: 'Codul „' + c + '” nu există.' };
      p.usedCode = { code: owner.referralCode, at: new Date().toISOString() };
      logEvent(p, who || 'admin', 'Cod de reducere folosit: ' + owner.referralCode +
        ' — ' + CODE_USED + ' €');
      if (!owner.referrals.some(function (r) { return r.patientId === p.id; })) {
        owner.referrals.push({ id: uid('r'), name: p.name, patientId: p.id,
          status: 'inscris', at: new Date().toISOString(), operatedAt: null });
        logEvent(owner, who || 'admin', p.name + ' folosește codul tău — ' +
          REFERRAL_OPERATED + ' € după intervenție');
      }
      save(db);
      return { ok: true };
    },

    // documents
    addDocument: function (pid, file, dataUrl, who) {
      var p = patient(pid); if (!p) return null;
      var doc = {
        id: uid('d'), name: file.name, size: file.size, type: file.type || 'application/octet-stream',
        uploadedAt: new Date().toISOString(), by: who || 'pacient',
        dataUrl: (dataUrl && file.size <= MAX_STORED_FILE) ? dataUrl : null
      };
      p.documents.push(doc);
      logEvent(p, who || 'pacient', 'A încărcat „' + file.name + '” (' + Math.round(file.size / 1024) + ' KB)');
      save(db);
      return doc;
    },
    removeDocument: function (pid, docId, who) {
      var p = patient(pid); if (!p) return;
      p.documents = p.documents.filter(function (d) {
        if (d.id === docId) logEvent(p, who || 'admin', 'A șters documentul „' + d.name + '”');
        return d.id !== docId;
      });
      save(db);
    },

    // operations (admin side)
    saveOperation: function (pid, op, who) {
      var p = patient(pid); if (!p) return;
      if (op.id) {
        for (var i = 0; i < p.operations.length; i++) {
          if (p.operations[i].id === op.id) { p.operations[i] = op; break; }
        }
        logEvent(p, who || 'admin', 'A actualizat intervenția „' + op.name + '”');
      } else {
        op.id = uid('op');
        p.operations.push(op);
        logEvent(p, who || 'admin', 'A adăugat intervenția „' + op.name + '”');
      }
      if (op.active) p.operations.forEach(function (o) { o.active = (o.id === op.id); });
      save(db);
    },
    removeOperation: function (pid, opId, who) {
      var p = patient(pid); if (!p) return;
      p.operations = p.operations.filter(function (o) {
        if (o.id === opId) logEvent(p, who || 'admin', 'A șters intervenția „' + o.name + '”');
        return o.id !== opId;
      });
      save(db);
    },

    // trip agenda (admin side)
    saveTripMeta: function (pid, title, subtitle, who) {
      var p = patient(pid); if (!p) return;
      p.trip.title = title; p.trip.subtitle = subtitle;
      logEvent(p, who || 'admin', 'A actualizat detaliile călătoriei');
      save(db);
    },
    saveTripItem: function (pid, item, who) {
      var p = patient(pid); if (!p) return;
      if (item.id) {
        for (var i = 0; i < p.trip.items.length; i++) {
          if (p.trip.items[i].id === item.id) { p.trip.items[i] = item; break; }
        }
        logEvent(p, who || 'admin', 'A actualizat etapa „' + item.desc + '”');
      } else {
        item.id = uid('t');
        p.trip.items.push(item);
        logEvent(p, who || 'admin', 'A adăugat etapa „' + item.desc + '”');
      }
      save(db);
    },
    removeTripItem: function (pid, itemId, who) {
      var p = patient(pid); if (!p) return;
      p.trip.items = p.trip.items.filter(function (t) {
        if (t.id === itemId) logEvent(p, who || 'admin', 'A șters etapa „' + t.desc + '”');
        return t.id !== itemId;
      });
      save(db);
    },
    moveTripItem: function (pid, itemId, dir) {
      var p = patient(pid); if (!p) return;
      var arr = p.trip.items;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === itemId) {
          var j = i + dir;
          if (j < 0 || j >= arr.length) return;
          var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
          break;
        }
      }
      save(db);
    },

    log: function (pid) { var p = patient(pid); return p ? p.log : []; },
    reset: function () { localStorage.removeItem(DB_KEY); db = load(); },
    _save: function () { save(db); },
    MAX_STORED_FILE: MAX_STORED_FILE,

    // the reward table, so no view has to hard-code an amount
    SOCIAL_LINKS: SOCIAL_LINKS,
    REWARDS: {
      actions: ACTION_REWARD,
      socialBundle: SOCIAL_BUNDLE,
      referralOperated: REFERRAL_OPERATED,
      codeUsed: CODE_USED
    },
    ACTION_LABEL: {
      instagram: 'Follow pe Instagram',
      facebook: 'Follow pe Facebook',
      review: 'Recenzie',
      share: 'Distribuie o postare'
    },
    // 7.5 -> "7,50 €", 30 -> "30 €"
    eur: function (n) {
      var v = Math.round(Number(n) * 100) / 100;
      return (v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ',')) + ' €';
    }
  };
})();
