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
  var SCHEMA = 3;
  var MAX_STORED_FILE = 2 * 1024 * 1024;   // 2 MB per file kept inline (localStorage limit)

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
    { name: 'BHT Clinic Istanbul Tema Hospital', page: 'parteneri.html' },
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
        referralCount: 1,
        gdprAccepted: true,
        gdprAcceptedAt: '2026-06-28T09:12:00Z',
        details: 'Pacientă evaluată pentru Mommy Makeover (abdominoplastie + mamare) la Liv Hospital. '
          + 'Analizele pre-operatorii sunt complete și în parametri. Urmează consultația cu medicul '
          + 'chirurg pe 12 august, în ziua sosirii, iar intervenția în aceeași zi. Recuperare '
          + 'estimată 3 zile în Istanbul, cu control înainte de întoarcere. Gastric Sleeve rămâne '
          + 'în discuție pentru anul viitor, după stabilizarea greutății.',
        actions: {
          google:   { done: true,  needsConsent: false, consent: false, pct: 4 },
          video:    { done: false, needsConsent: true,  consent: false, pct: 10 },
          photos:   { done: false, needsConsent: true,  consent: false, pct: 5 },
          referral: { done: true,  needsConsent: false, consent: false, pct: 3 }
        },
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
      if (typeof p.referralCount !== 'number') p.referralCount = 0;
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
      referralCode: referralCodeFor(name), referralCount: 0,
      gdprAccepted: true, gdprAcceptedAt: now,
      details: '',
      actions: {
        google:   { done: false, needsConsent: false, consent: false, pct: 4 },
        video:    { done: false, needsConsent: true,  consent: false, pct: 10 },
        photos:   { done: false, needsConsent: true,  consent: false, pct: 5 },
        referral: { done: false, needsConsent: false, consent: false, pct: 3 }
      },
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
  window.MedicrossDB = {
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
    discount: function (pid) {
      var p = patient(pid); if (!p) return 0;
      var sum = 0;
      for (var k in p.actions) {
        var a = p.actions[k];
        if (a.done && (!a.needsConsent || a.consent)) sum += a.pct;
      }
      return Math.min(sum, 25);
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
    MAX_STORED_FILE: MAX_STORED_FILE
  };
})();
