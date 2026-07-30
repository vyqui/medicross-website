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

  var DB_KEY = 'mcx_db_v2';
  var SESSION_KEY = 'mcx_session_v2';
  var MAX_STORED_FILE = 2 * 1024 * 1024;   // 2 MB per file kept inline (localStorage limit)

  /* ---------------- demo accounts (documented on the login screen) -------- */
  var ACCOUNTS = [
    { email: 'andreea@demo.ro', pass: 'demo', role: 'patient', patientId: 'p1' },
    { email: 'admin@medicross.ro', pass: 'admin', role: 'admin', patientId: null }
  ];

  /* ---------------- seed data --------------------------------------------- */
  function seed() {
    return {
      v: 2,
      patients: [{
        id: 'p1',
        name: 'Andreea M.',
        initials: 'AM',
        email: 'andreea@demo.ro',
        phone: '+40 7xx xxx xxx',
        sex: 'f',
        referralCode: 'MEDI-ANDREEA-2K6',
        referralCount: 1,
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
            { id: 't1', date: '11 Aug', desc: 'Zbor București→Istanbul + transfer privat', icon: 'plane', surgery: false },
            { id: 't2', date: '11 Aug', desc: 'Cazare hotel 5★', icon: 'building', surgery: false },
            { id: 't3', date: '12 Aug', desc: 'Consultație + analize', icon: 'tag', surgery: false },
            { id: 't4', date: '12 Aug', desc: 'Intervenție', icon: 'plus', surgery: true },
            { id: 't5', date: '13–15 Aug', desc: 'Recuperare & control', icon: 'star', surgery: false },
            { id: 't6', date: '16 Aug', desc: 'Întoarcere acasă', icon: 'home', surgery: false }
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
  function load() {
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) {
        var db = JSON.parse(raw);
        if (db && db.v === 2 && Array.isArray(db.patients)) return db;
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
    for (var i = 0; i < ACCOUNTS.length; i++) {
      var a = ACCOUNTS[i];
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

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  function requireRole(role) {
    var s = session();
    if (!s || (role && s.role !== role && s.role !== 'admin')) {
      location.href = 'login.html' + (role === 'admin' ? '#admin' : '');
      return null;
    }
    return s;
  }

  /* ---------------- public API -------------------------------------------- */
  window.MedicrossDB = {
    // auth
    login: login, logout: logout, session: session, requireRole: requireRole,
    demoAccounts: ACCOUNTS.map(function (a) { return { email: a.email, pass: a.pass, role: a.role }; }),

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
