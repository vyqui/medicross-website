/* Medicross portal — real API client.
 *
 * This used to be a localStorage-only demo store. It is now a thin client
 * around the Fastify + Postgres API in server/src — the actual database is
 * the source of truth, not the browser.
 *
 * portal.js and admin.js were written against the demo store's shape on
 * purpose (see server/src/serialize.js): every read here is synchronous,
 * backed by a small in-memory cache that is refreshed right after login and
 * after every mutation (each mutating endpoint hands back the patient's full,
 * fresh record, so there is always something to refresh the cache with).
 * That is what let the render code in portal.js/admin.js stay almost
 * completely unchanged — only the call sites that used to get a value back
 * immediately now `await` a promise first.
 */
(function () {
  'use strict';

  /* ---------------- static catalogue (no server round-trip needed) -------- */
  var PROCEDURES = [
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
    { key: 'gastric-sleeve', name: 'Gastric Sleeve', cat: 'bariatrica',
      detail: 'Chirurgie bariatrică', regions: 'stomach', viewMode: 'internal', page: 'gastric-sleeve.html' },
    { key: 'gastric-bypass', name: 'Gastric Bypass', cat: 'bariatrica',
      detail: 'Chirurgie bariatrică', regions: 'stomach,intestine', viewMode: 'internal', page: 'gastric-bypass.html' },
    { key: 'balon-gastric', name: 'Balon Gastric', cat: 'bariatrica',
      detail: 'Procedură bariatrică nechirurgicală', regions: 'stomach,esophagus', viewMode: 'internal', page: 'balon-gastric.html' }
  ];
  var CATEGORY_LABEL = { estetica: 'Chirurgie Estetică', bariatrica: 'Chirurgie Bariatrică' };
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
  var SOCIAL_LINKS = { instagram: '', facebook: '', review: '', share: '' };
  function procedure(key) {
    for (var i = 0; i < PROCEDURES.length; i++) if (PROCEDURES[i].key === key) return PROCEDURES[i];
    return null;
  }
  var ACTION_LABEL = {
    instagram: 'Follow pe Instagram', facebook: 'Follow pe Facebook',
    review: 'Recenzie', share: 'Distribuie o postare'
  };
  /* Placeholders until GET /api/config answers (requireRole awaits it before
     anything renders), so a value is always available even if that call were
     ever skipped. */
  var REWARDS = { actions: { instagram: 7.5, facebook: 7.5, review: 7.5, share: 7.5 },
    socialMax: 30, referralOperated: 70, codeUsed: 20 };

  /* ---------------- HTTP -------------------------------------------------- */
  function ApiError(message, status) { this.message = message; this.status = status; }
  ApiError.prototype = Object.create(Error.prototype);

  function request(method, path, body) {
    var opts = { method: method, credentials: 'include' };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
        if (!res.ok) throw new ApiError((data && data.error) || 'A apărut o eroare de rețea.', res.status);
        return data;
      });
    });
  }

  /* ---------------- session + caches -------------------------------------- */
  var sessionInfo = null;      // { email, role, patientId, mustChangePassword }
  var patientsSummary = [];    // admin: the patient-table list
  var currentPatient = null;   // admin: selected patient's full record; portal: the signed-in patient's own record

  function login(email, pass) {
    return request('POST', '/api/auth/login', { email: email, password: pass })
      .then(function (s) { sessionInfo = s; return s; })
      .catch(function () { return null; });
  }

  function logout() {
    return request('POST', '/api/auth/logout').catch(function () {}).then(function () {
      sessionInfo = null; patientsSummary = []; currentPatient = null;
    });
  }

  function session() {
    return request('GET', '/api/auth/session').then(function (s) {
      return s.authenticated ? s : null;
    }).catch(function () { return null; });
  }

  function loadConfig() {
    return request('GET', '/api/config').then(function (cfg) {
      REWARDS = {
        actions: cfg.rewards.actions,
        socialMax: Object.keys(cfg.rewards.actions).reduce(
          function (sum, k) { return sum + cfg.rewards.actions[k]; }, 0),
        referralOperated: cfg.rewards.referralOperated,
        codeUsed: cfg.rewards.codeUsed
      };
    }).catch(function () { /* keep the placeholders above */ });
  }

  /** Refreshes the admin patient-table cache. */
  function refreshPatientsList() {
    return request('GET', '/api/admin/patients').then(function (res) {
      patientsSummary = res.patients;
      return patientsSummary;
    });
  }

  /** Refreshes the full-detail cache for one patient (admin view of anyone,
      or the signed-in patient's own record via /api/me). */
  function refreshCurrentPatient(id) {
    var p = (sessionInfo && sessionInfo.role === 'admin')
      ? request('GET', '/api/admin/patients/' + id)
      : request('GET', '/api/me');
    return p.then(function (patient) { currentPatient = patient; return patient; });
  }

  /* requireRole() replaces the old synchronous "read a localStorage session"
     check. It performs the same redirect logic as before, but also primes the
     caches admin.js/portal.js immediately start reading from — so by the time
     it resolves, patients()/patient() already have something to return. */
  function requireRole(role) {
    var here = location.pathname.split('/').pop() || 'index.html';
    return Promise.all([session(), loadConfig()]).then(function (results) {
      var s = results[0];
      if (!s) {
        location.replace('login.html?next=' + encodeURIComponent(here));
        return null;
      }
      if (role === 'admin' && s.role !== 'admin') {
        location.replace('login.html?next=' + encodeURIComponent(here) + '&denied=1');
        return null;
      }
      sessionInfo = s;
      if (role === 'admin') {
        return refreshPatientsList().then(function () { return s; });
      }
      /* The patient portal, opened by an admin previewing it read-only, has no
         patientId of its own on the session — same crude "show whichever
         patient comes first" fallback the demo store always used here; there
         was never a per-patient preview link. */
      var pid = s.patientId;
      return (pid ? Promise.resolve() : refreshPatientsList()).then(function () {
        var targetId = pid || (patientsSummary[0] && patientsSummary[0].id);
        if (!targetId) { currentPatient = null; return s; }
        return refreshCurrentPatient(targetId).then(function () {
          s.patientId = targetId;
          return s;
        });
      });
    });
  }

  function patients() { return patientsSummary; }
  function patient(id) { return (currentPatient && currentPatient.id === id) ? currentPatient : null; }
  function accountForPatient(id) {
    /* The admin table never had a separate "accounts" list to browse in the
       real backend — GET /api/admin/patients/:id already returns { account }
       for exactly this patient, which is the only place admin.js reads it
       from (see the small `.account` merge below). */
    return (currentPatient && currentPatient.id === id && currentPatient.account) || null;
  }

  /* ---------------- patient-facing actions --------------------------------- */
  function acceptGdpr() {
    return request('POST', '/api/me/gdpr').then(function (p) { currentPatient = p; return p; });
  }
  function setAction(pid, key, patch) {
    return request('POST', '/api/me/actions/' + key, { done: !!patch.done })
      .then(function (p) { currentPatient = p; return p; });
  }
  function setView(pid, activeOp, mode) {
    return request('POST', '/api/me/view', { activeOp: activeOp, mode: mode })
      .then(function (p) { currentPatient = p; return p; });
  }
  function addDocument(pid, file) {
    var fd = new FormData();
    fd.append('file', file);
    var path = (sessionInfo && sessionInfo.role === 'admin')
      ? '/api/admin/patients/' + pid + '/documents'
      : '/api/me/documents';
    return request('POST', path, fd).then(function (p) { currentPatient = p; return p; });
  }
  function removeDocument(pid, docId) {
    var path = (sessionInfo && sessionInfo.role === 'admin')
      ? '/api/admin/patients/' + pid + '/documents/' + docId
      : '/api/me/documents/' + docId;
    return request('DELETE', path).then(function (p) { currentPatient = p; return p; });
  }

  /* ---------------- admin-only mutations ----------------------------------- */
  function createPatient(opts) {
    return request('POST', '/api/admin/patients', {
      name: opts.name, email: opts.email, phone: opts.phone, sex: opts.sex, password: opts.pass
    }).then(function (p) {
      currentPatient = p;
      return refreshPatientsList().then(function () { return { patient: p }; });
    }).catch(function (err) { return { error: err.message }; });
  }
  function saveDetails(pid, text) {
    return request('PATCH', '/api/admin/patients/' + pid, { details: String(text || '') })
      .then(function (p) { currentPatient = p; return p; });
  }
  function discountBreakdown(pid) {
    var p = patient(pid);
    return p ? p.discount : { lines: [], social: 0, socialMax: 0, referral: 0, operated: 0, pending: 0, code: 0, total: 0, potential: 0 };
  }
  function saveOperation(pid, op) {
    var path = '/api/admin/patients/' + pid + '/operations' + (op.id ? '/' + op.id : '');
    return request('PUT', path, op).then(function (p) { currentPatient = p; return p; });
  }
  function removeOperation(pid, opId) {
    return request('DELETE', '/api/admin/patients/' + pid + '/operations/' + opId)
      .then(function (p) { currentPatient = p; return p; });
  }
  function saveTripMeta(pid, title, subtitle) {
    return request('PUT', '/api/admin/patients/' + pid + '/trip', { title: title, subtitle: subtitle })
      .then(function (p) { currentPatient = p; return p; });
  }
  function saveTripItem(pid, item) {
    var path = '/api/admin/patients/' + pid + '/trip/items' + (item.id ? '/' + item.id : '');
    return request('PUT', path, item).then(function (p) { currentPatient = p; return p; });
  }
  function removeTripItem(pid, itemId) {
    return request('DELETE', '/api/admin/patients/' + pid + '/trip/items/' + itemId)
      .then(function (p) { currentPatient = p; return p; });
  }
  function moveTripItem(pid, itemId, dir) {
    return request('POST', '/api/admin/patients/' + pid + '/trip/items/' + itemId + '/move',
      { direction: dir > 0 ? 'down' : 'up' }).then(function (p) { currentPatient = p; return p; });
  }
  function verifyAction(pid, key, verified) {
    return request('POST', '/api/admin/patients/' + pid + '/actions/' + key + '/verify', { verified: verified })
      .then(function (p) { currentPatient = p; return p; });
  }
  function addReferral(pid, name) {
    return request('POST', '/api/admin/patients/' + pid + '/referrals', { name: name })
      .then(function (p) { currentPatient = p; return p; }).catch(function () { return null; });
  }
  function setReferralStatus(pid, refId, status) {
    return request('PATCH', '/api/admin/patients/' + pid + '/referrals/' + refId, { status: status })
      .then(function (p) { currentPatient = p; return p; });
  }
  function removeReferral(pid, refId) {
    return request('DELETE', '/api/admin/patients/' + pid + '/referrals/' + refId)
      .then(function (p) { currentPatient = p; return p; });
  }
  function setUsedCode(pid, code) {
    return request('PUT', '/api/admin/patients/' + pid + '/used-code', { code: code })
      .then(function (p) { currentPatient = p; return { ok: true, patient: p }; })
      .catch(function (err) { return { error: err.message }; });
  }

  /* ---------------- formatting --------------------------------------------- */
  function eur(n) {
    var v = Math.round(Number(n) * 100) / 100;
    return (v % 1 === 0 ? String(v) : v.toFixed(2).replace('.', ',')) + ' €';
  }

  window.MedicrossDB = {
    login: login, logout: logout, session: session, requireRole: requireRole,
    createPatient: createPatient, acceptGdpr: acceptGdpr, saveDetails: saveDetails,
    HOSPITALS: HOSPITALS,
    accountForPatient: accountForPatient,

    PROCEDURES: PROCEDURES, CATEGORY_LABEL: CATEGORY_LABEL, procedure: procedure,

    patients: patients, patient: patient,
    refreshPatientsList: refreshPatientsList, refreshCurrentPatient: refreshCurrentPatient,

    setAction: setAction, setView: setView, discountBreakdown: discountBreakdown,
    verifyAction: verifyAction,
    addReferral: addReferral, setReferralStatus: setReferralStatus, removeReferral: removeReferral,
    setUsedCode: setUsedCode,

    addDocument: addDocument, removeDocument: removeDocument,

    saveOperation: saveOperation, removeOperation: removeOperation,
    saveTripMeta: saveTripMeta, saveTripItem: saveTripItem,
    removeTripItem: removeTripItem, moveTripItem: moveTripItem,

    SOCIAL_LINKS: SOCIAL_LINKS,
    get REWARDS() { return REWARDS; },
    ACTION_LABEL: ACTION_LABEL,
    eur: eur
  };
})();
