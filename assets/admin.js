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
      b.appendChild(g);
      b.appendChild(el('span', 'disc', MedicrossDB.discount(p.id) + '%'));
      b.addEventListener('click', function () { currentId = p.id; renderAll(); });
      box.appendChild(b);
    });
  }

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
  function openOpForm(op) {
    editingOp = op || null;
    var f = document.getElementById('opForm');
    f.hidden = false;
    document.getElementById('opName').value = op ? op.name : '';
    document.getElementById('opDetail').value = op ? op.detail : '';
    document.getElementById('opStatus').value = op ? op.status : 'programata';
    document.getElementById('opDate').value = op ? op.date : '';
    document.getElementById('opRegions').value = op ? op.regions : '';
    document.getElementById('opMode').value = op ? op.viewMode : 'surface';
    document.getElementById('opActive').checked = !!(op && op.active);
    document.getElementById('opName').focus();
  }
  document.getElementById('opAdd').addEventListener('click', function () { openOpForm(null); });
  document.getElementById('opCancel').addEventListener('click', function () {
    document.getElementById('opForm').hidden = true; editingOp = null;
  });
  document.getElementById('opForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = document.getElementById('opName').value.trim();
    if (!name) return;
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
    renderDiscount(p);
    renderOps(p);
    renderTrip(p);
    renderDocs(p);
    renderLog(p);
  }
  renderAll();
})();
