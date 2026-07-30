/* Medicross admin console — manages the same demo store the patient portal
 * reads (assets/portal-data.js). Every mutation here is visible in
 * portal.html on its next load, and vice-versa. */
(function () {
  'use strict';

  var sess = MedicrossDB.requireRole('admin');
  if (!sess) return;

  document.getElementById('logoutBtn').addEventListener('click', function () {
    MedicrossDB.logout();
    location.href = 'login.html';
  });

  var currentId = MedicrossDB.patients()[0] && MedicrossDB.patients()[0].id;

  /* ---------------- helpers ---------------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtSize(b) {
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  }
  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short' }) + ' ' +
             d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  var STATUS_LABEL = { programata: 'Programată', evaluare: 'În evaluare', finalizata: 'Finalizată' };
  var ACTION_LABEL = {
    google: 'Recenzie Google', video: 'Video de mulțumire',
    photos: 'Poze înainte/după', referral: 'Recomandare prieten'
  };

  /* ---------------- patient list ---------------- */
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';

  function renderPatients() {
    var box = document.getElementById('patientList');
    box.querySelectorAll('.prow').forEach(function (r) { r.remove(); });
    MedicrossDB.patients().forEach(function (p) {
      var b = el('button', 'prow' + (p.id === currentId ? ' sel' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'av', p.initials));
      var g = el('div', 'grow');
      g.appendChild(el('div', 'nm', p.name));
      g.appendChild(el('div', 'em', p.email));
      // GDPR status right in the side menu
      var badge = el('span', 'gdpr-badge' + (p.gdprAccepted ? '' : ' missing'));
      badge.innerHTML = p.gdprAccepted ? TICK + ' GDPR' : '! GDPR lipsă';
      badge.title = p.gdprAccepted
        ? 'Acord GDPR semnat' + (p.gdprAcceptedAt ? ' · ' + fmtTime(p.gdprAcceptedAt) : '')
        : 'Acordul GDPR nu este semnat';
      g.appendChild(badge);
      b.appendChild(g);
      b.appendChild(el('span', 'disc', MedicrossDB.discount(p.id) + '%'));
      b.addEventListener('click', function () { currentId = p.id; renderAll(); });
      box.appendChild(b);
    });
  }

  /* ---------------- account + GDPR ---------------- */
  function renderAccount(p) {
    var box = document.getElementById('acctInfo');
    box.textContent = '';
    var acct = MedicrossDB.accountForPatient(p.id);
    [['Nume', p.name], ['E-mail', p.email || (acct && acct.email) || '—'],
     ['Telefon', p.phone || '—'], ['Model 3D', p.sex === 'm' ? 'Masculin' : 'Feminin'],
     ['Cod invitație', p.referralCode]].forEach(function (row) {
      var line = el('div', 'acct-line');
      line.appendChild(el('span', 'k', row[0]));
      line.appendChild(el('span', 'v', row[1]));
      box.appendChild(line);
    });

    var boxg = document.getElementById('gdprBox');
    boxg.checked = !!p.gdprAccepted;
    document.getElementById('gdprWhen').textContent =
      p.gdprAccepted && p.gdprAcceptedAt ? 'semnat ' + fmtTime(p.gdprAcceptedAt) : '';
    boxg.onchange = function () {
      MedicrossDB.setGdpr(p.id, boxg.checked, 'admin');
      renderAll();
    };
  }

  document.getElementById('newAcct').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var errBox = document.getElementById('naErr');
    errBox.hidden = true;
    var res = MedicrossDB.createPatient({
      name: document.getElementById('naName').value,
      email: document.getElementById('naEmail').value,
      phone: document.getElementById('naPhone').value,
      sex: document.getElementById('naSex').value,
      pass: document.getElementById('naPass').value,
      gdpr: document.getElementById('naGdpr').checked,
      by: 'admin'
    });
    if (res.error) { errBox.textContent = res.error; errBox.hidden = false; return; }
    this.reset();
    document.getElementById('naPass').value = 'medicross';
    currentId = res.patient.id;
    renderAll();
  });

  /* ---------------- discount ---------------- */
  function renderDiscount(p) {
    var total = MedicrossDB.discount(p.id);
    var deg = Math.round((total / 25) * 360);
    document.getElementById('aRing').style.background =
      'conic-gradient(var(--brand) ' + deg + 'deg, var(--ring-track) ' + deg + 'deg)';
    document.getElementById('aNum').textContent = total + '%';

    var box = document.getElementById('aActions');
    box.textContent = '';
    Object.keys(p.actions).forEach(function (k) {
      var a = p.actions[k];
      var earned = a.done && (!a.needsConsent || a.consent);
      var line = el('div', 'disc-line ' + (earned ? 'on' : 'off'));
      line.appendChild(el('span', 'k', ACTION_LABEL[k] || k));
      var state = !a.done ? 'neînceput'
        : (a.needsConsent && !a.consent ? 'finalizat, fără consimțământ' : 'activ');
      if (a.needsConsent) state += a.consent ? ' · consimțământ DA' : ' · consimțământ NU';
      line.appendChild(el('span', 'v', state));
      line.appendChild(el('span', 'pctv', '+' + a.pct + '%'));
      box.appendChild(line);
    });
  }

  /* ---------------- operations ---------------- */
  var editingOp = null;
  function renderOps(p) {
    var box = document.getElementById('opList');
    box.textContent = '';
    p.operations.forEach(function (op) {
      var row = el('div', 'itemrow');
      var g = el('div', 'grow');
      var t = el('div', 't', op.name + (op.active ? ' · activă' : ''));
      g.appendChild(t);
      g.appendChild(el('div', 'm', (op.detail || '—') + (op.date ? ' · ' + op.date : '')));
      row.appendChild(g);
      var st = el('span', 'st ' + op.status, STATUS_LABEL[op.status] || op.status);
      row.appendChild(st);
      var edit = el('button', 'ibtn', 'Editează'); edit.type = 'button';
      edit.addEventListener('click', function () { openOpForm(op); });
      row.appendChild(edit);
      var del = el('button', 'ibtn danger', 'Șterge'); del.type = 'button';
      del.addEventListener('click', function () {
        if (confirm('Ștergi intervenția „' + op.name + '”?')) {
          MedicrossDB.removeOperation(p.id, op.id);
          renderAll();
        }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  /* ---- standard procedure catalogue drives the picker + the 3D zone ---- */
  var VALID_REGIONS = {
    surface: ['abdomen', 'arm', 'breast', 'buttocks', 'chest', 'foot', 'hand', 'head', 'hip', 'jaw', 'neck', 'nose', 'thigh'],
    internal: ['stomach', 'intestine', 'esophagus']
  };

  function buildCatalogSelect() {
    var sel = document.getElementById('opCatalog');
    sel.textContent = '';
    var cats = {};
    MedicrossDB.PROCEDURES.forEach(function (pr) { (cats[pr.cat] = cats[pr.cat] || []).push(pr); });
    Object.keys(cats).forEach(function (cat) {
      var grp = document.createElement('optgroup');
      grp.label = MedicrossDB.CATEGORY_LABEL[cat] || cat;
      cats[cat].forEach(function (pr) {
        var o = document.createElement('option');
        o.value = pr.key; o.textContent = pr.name;
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
    var other = document.createElement('option');
    other.value = '__custom'; other.textContent = 'Altă intervenție (personalizată)…';
    sel.appendChild(other);
  }

  // applies a catalogue entry: name, detail, 3D regions and view mode
  function applyCatalog(key, keepDetail) {
    var custom = key === '__custom';
    document.getElementById('opNameWrap').hidden = !custom;
    if (custom) { document.getElementById('opName').focus(); checkRegions(); return; }
    var pr = MedicrossDB.procedure(key);
    if (!pr) return;
    document.getElementById('opName').value = pr.name;
    if (!keepDetail) document.getElementById('opDetail').value = pr.detail;
    document.getElementById('opRegions').value = pr.regions;   // 3D zone, automatic
    document.getElementById('opMode').value = pr.viewMode;
    checkRegions();
  }

  // warn if a hand-typed zone will not highlight anything on the mannequin
  function checkRegions() {
    var warn = document.getElementById('regionWarn');
    var mode = document.getElementById('opMode').value;
    var allowed = VALID_REGIONS[mode];
    var bad = document.getElementById('opRegions').value.split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { return s && allowed.indexOf(s) === -1; });
    if (bad.length) {
      warn.className = 'region-warn';
      warn.textContent = 'Zone necunoscute pentru vederea „' +
        (mode === 'internal' ? 'Organe interne' : 'Suprafață') + '”: ' + bad.join(', ') +
        '. Valori acceptate: ' + allowed.join(', ') + '.';
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  document.getElementById('opCatalog').addEventListener('change', function () {
    applyCatalog(this.value, false);
  });
  document.getElementById('opRegions').addEventListener('input', checkRegions);
  document.getElementById('opMode').addEventListener('change', checkRegions);

  // find the catalogue entry an existing operation came from
  function catalogKeyFor(op) {
    var found = '__custom';
    MedicrossDB.PROCEDURES.forEach(function (pr) {
      if (pr.name.toLowerCase() === String(op.name || '').toLowerCase()) found = pr.key;
    });
    return found;
  }

  function openOpForm(op) {
    editingOp = op || null;
    var f = document.getElementById('opForm');
    f.hidden = false;
    var sel = document.getElementById('opCatalog');

    if (op) {
      sel.value = catalogKeyFor(op);
      document.getElementById('opNameWrap').hidden = sel.value !== '__custom';
      document.getElementById('opName').value = op.name;
      document.getElementById('opDetail').value = op.detail || '';
      document.getElementById('opRegions').value = op.regions || '';
      document.getElementById('opMode').value = op.viewMode || 'surface';
    } else {
      sel.selectedIndex = 0;
      document.getElementById('opDetail').value = '';
      applyCatalog(sel.value, false);   // pre-fills the 3D zone for the default pick
    }
    document.getElementById('opStatus').value = op ? op.status : 'programata';
    document.getElementById('opDate').value = op ? op.date : '';
    document.getElementById('opActive').checked = !!(op && op.active);
    checkRegions();
  }
  document.getElementById('opAdd').addEventListener('click', function () { openOpForm(null); });
  document.getElementById('opCancel').addEventListener('click', function () {
    document.getElementById('opForm').hidden = true; editingOp = null;
  });
  document.getElementById('opForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var key = document.getElementById('opCatalog').value;
    var name = key === '__custom'
      ? document.getElementById('opName').value.trim()
      : (MedicrossDB.procedure(key) || {}).name;
    if (!name) { document.getElementById('opName').focus(); return; }
    MedicrossDB.saveOperation(currentId, {
      id: editingOp ? editingOp.id : null,
      name: name,
      detail: document.getElementById('opDetail').value.trim(),
      status: document.getElementById('opStatus').value,
      date: document.getElementById('opDate').value.trim(),
      regions: document.getElementById('opRegions').value.trim(),
      viewMode: document.getElementById('opMode').value,
      active: document.getElementById('opActive').checked
    });
    document.getElementById('opForm').hidden = true;
    editingOp = null;
    renderAll();
  });

  /* ---------------- trip agenda ---------------- */
  var editingTrip = null;
  function renderTrip(p) {
    document.getElementById('tmTitle').value = p.trip.title;
    document.getElementById('tmSub').value = p.trip.subtitle;
    var box = document.getElementById('tripList');
    box.textContent = '';
    p.trip.items.forEach(function (it, i) {
      var row = el('div', 'itemrow' + (it.surgery ? ' surgery-row' : ''));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', it.date + ' — ' + it.desc));
      g.appendChild(el('div', 'm', (it.surgery ? 'Ziua intervenției · ' : '') + 'pictogramă: ' + it.icon));
      row.appendChild(g);
      var up = el('button', 'ibtn', '↑'); up.type = 'button'; up.disabled = i === 0;
      up.setAttribute('aria-label', 'Mută mai sus');
      up.addEventListener('click', function () { MedicrossDB.moveTripItem(p.id, it.id, -1); renderAll(); });
      row.appendChild(up);
      var down = el('button', 'ibtn', '↓'); down.type = 'button'; down.disabled = i === p.trip.items.length - 1;
      down.setAttribute('aria-label', 'Mută mai jos');
      down.addEventListener('click', function () { MedicrossDB.moveTripItem(p.id, it.id, 1); renderAll(); });
      row.appendChild(down);
      var edit = el('button', 'ibtn', 'Editează'); edit.type = 'button';
      edit.addEventListener('click', function () { openTripForm(it); });
      row.appendChild(edit);
      var del = el('button', 'ibtn danger', 'Șterge'); del.type = 'button';
      del.addEventListener('click', function () {
        if (confirm('Ștergi etapa „' + it.desc + '”?')) { MedicrossDB.removeTripItem(p.id, it.id); renderAll(); }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function openTripForm(it) {
    editingTrip = it || null;
    var f = document.getElementById('tripForm');
    f.hidden = false;
    document.getElementById('tiDate').value = it ? it.date : '';
    document.getElementById('tiDesc').value = it ? it.desc : '';
    document.getElementById('tiIcon').value = it ? it.icon : 'plane';
    document.getElementById('tiSurgery').checked = !!(it && it.surgery);
    document.getElementById('tiDate').focus();
  }
  document.getElementById('tripAdd').addEventListener('click', function () { openTripForm(null); });
  document.getElementById('tripCancel').addEventListener('click', function () {
    document.getElementById('tripForm').hidden = true; editingTrip = null;
  });
  document.getElementById('tripForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var date = document.getElementById('tiDate').value.trim();
    var desc = document.getElementById('tiDesc').value.trim();
    if (!date || !desc) return;
    MedicrossDB.saveTripItem(currentId, {
      id: editingTrip ? editingTrip.id : null,
      date: date, desc: desc,
      icon: document.getElementById('tiIcon').value,
      surgery: document.getElementById('tiSurgery').checked
    });
    document.getElementById('tripForm').hidden = true;
    editingTrip = null;
    renderAll();
  });
  document.getElementById('tripMeta').addEventListener('submit', function (ev) {
    ev.preventDefault();
    MedicrossDB.saveTripMeta(currentId,
      document.getElementById('tmTitle').value.trim(),
      document.getElementById('tmSub').value.trim());
    renderAll();
  });

  /* ---------------- documents ---------------- */
  function renderDocs(p) {
    var box = document.getElementById('docList');
    box.textContent = '';
    if (!p.documents.length) box.appendChild(el('div', 'm', 'Niciun document încă.'));
    p.documents.forEach(function (d) {
      var row = el('div', 'itemrow');
      if (d.dataUrl && /^image\//.test(d.type)) {
        var img = document.createElement('img');
        img.className = 'doc-thumb'; img.src = d.dataUrl; img.alt = '';
        row.appendChild(img);
      } else {
        row.appendChild(el('span', 'doc-ph', '📄'));
      }
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', d.name));
      g.appendChild(el('div', 'm',
        fmtSize(d.size) + ' · ' + (d.by === 'staff' ? 'echipă' : 'pacient') + ' · ' + fmtTime(d.uploadedAt) +
        (d.dataUrl ? '' : ' · doar metadate (fișierul depășește limita demo de 2 MB)')));
      row.appendChild(g);
      if (d.dataUrl) {
        var dl = document.createElement('a');
        dl.className = 'ibtn'; dl.textContent = 'Descarcă';
        dl.href = d.dataUrl; dl.download = d.name;
        row.appendChild(dl);
      }
      var del = el('button', 'ibtn danger', 'Șterge'); del.type = 'button';
      del.addEventListener('click', function () {
        if (confirm('Ștergi „' + d.name + '”?')) { MedicrossDB.removeDocument(p.id, d.id); renderAll(); }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  document.getElementById('adminUpload').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    var pending = files.length;
    if (!pending) return;
    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        MedicrossDB.addDocument(currentId, f, reader.result, 'staff');
        if (--pending === 0) renderAll();
      };
      reader.onerror = function () {
        MedicrossDB.addDocument(currentId, f, null, 'staff');
        if (--pending === 0) renderAll();
      };
      reader.readAsDataURL(f);
    });
    this.value = '';
  });

  /* ---------------- log ---------------- */
  function renderLog(p) {
    var ul = document.getElementById('logList');
    ul.textContent = '';
    if (!p.log.length) {
      var li = el('li'); li.appendChild(el('span', 'm', 'Nimic încă.')); ul.appendChild(li); return;
    }
    p.log.forEach(function (e) {
      var li = el('li');
      li.appendChild(el('span', 'lt', fmtTime(e.t)));
      li.appendChild(el('span', 'lw', e.who));
      li.appendChild(el('span', null, e.what));
      ul.appendChild(li);
    });
  }

  /* ---------------- render ---------------- */
  function renderAll() {
    var p = MedicrossDB.patient(currentId);
    if (!p) return;
    renderPatients();
    renderAccount(p);
    renderDiscount(p);
    renderOps(p);
    renderTrip(p);
    renderDocs(p);
    renderLog(p);
  }
  buildCatalogSelect();
  renderAll();
})();
