/* Medicross admin console — talks to the real API in server/src (see
 * assets/portal-data.js). Every mutation here is visible in portal.html on
 * its next load, and vice-versa, because both read the same Postgres rows. */
(async function () {
  'use strict';

  var sess = await MedicrossDB.requireRole('admin');
  if (!sess) return;

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await MedicrossDB.logout();
    location.href = 'login.html';
  });

  var currentId = MedicrossDB.patients()[0] && MedicrossDB.patients()[0].id;
  if (currentId) await MedicrossDB.refreshCurrentPatient(currentId);

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
  var ACTION_LABEL = MedicrossDB.ACTION_LABEL;
  var EUR = MedicrossDB.eur;
  var REF_STATUS = { inscris: 'Înscris — în așteptare', operat: 'Operat', anulat: 'Anulat' };

  /* ---------------- patient table ---------------- */
  var TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';

  // The intervention shown in the table, and the one "data intervenției"
  // refers to: whichever operation the admin has flagged active drives the
  // 3D highlight in the portal too, so it is the one that matters here.
  // Falling back to a scheduled one, then to whatever exists, keeps the
  // column meaningful even before an operation has been marked active.
  function headlineOp(p) {
    if (!p.operations || !p.operations.length) return null;
    var active = p.operations.filter(function (o) { return o.active; })[0];
    if (active) return active;
    var scheduled = p.operations.filter(function (o) { return o.status === 'programata'; })[0];
    return scheduled || p.operations[0];
  }

  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

  // Name, phone (digit- or text-matched) and every intervention the patient
  // has ever had — not just the one shown in the table — so a search for a
  // finished procedure still finds the patient.
  function matchesSearch(p, query) {
    var q = query.trim().toLowerCase();
    if (!q) return true;
    if (p.name.toLowerCase().indexOf(q) > -1) return true;
    var qDigits = onlyDigits(q);
    if (qDigits && onlyDigits(p.phone).indexOf(qDigits) > -1) return true;
    if (!qDigits && (p.phone || '').toLowerCase().indexOf(q) > -1) return true;
    return (p.operations || []).some(function (o) { return o.name.toLowerCase().indexOf(q) > -1; });
  }

  function renderPatients() {
    var body = document.getElementById('patientRows');
    var emptyNote = document.getElementById('patientEmpty');
    body.textContent = '';

    var query = document.getElementById('patientSearch').value;
    var list = MedicrossDB.patients().filter(function (p) { return matchesSearch(p, query); });

    emptyNote.hidden = list.length > 0;

    list.forEach(function (p) {
      var op = headlineOp(p);
      var tr = el('tr', p.id === currentId ? 'sel' : '');
      tr.tabIndex = 0;

      var tdName = el('td');
      var wrap = el('div', 'pname');
      wrap.appendChild(el('span', 'av', p.initials));
      var txt = el('div', 'pname-txt');
      txt.appendChild(el('div', 'nm', p.name));
      var badge = el('span', 'gdpr-badge' + (p.gdprAccepted ? '' : ' missing'));
      badge.innerHTML = p.gdprAccepted ? TICK + ' GDPR' : '! GDPR lipsă';
      badge.title = p.gdprAccepted
        ? 'Acord GDPR acceptat' + (p.gdprAcceptedAt ? ' · ' + fmtTime(p.gdprAcceptedAt) : '')
        : 'Acordul GDPR nu a fost acceptat încă';
      txt.appendChild(badge);
      wrap.appendChild(txt);
      tdName.appendChild(wrap);
      tr.appendChild(tdName);

      tr.appendChild(el('td', p.phone ? null : 'muted-cell', p.phone || '—'));
      tr.appendChild(el('td', op ? null : 'muted-cell', op ? op.name : '—'));
      tr.appendChild(el('td', op && op.date ? null : 'muted-cell', (op && op.date) || '—'));
      tr.appendChild(el('td', 'muted-cell', p.createdAt ? fmtTime(p.createdAt) : '—'));

      async function select() {
        currentId = p.id;
        await MedicrossDB.refreshCurrentPatient(currentId);
        renderAll();
      }
      tr.addEventListener('click', select);
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(); }
      });
      body.appendChild(tr);
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

    // Read-only status — there is no control here for staff to change, on
    // purpose. Consent is the patient's own act; see acord-gdpr.html.
    var statusBox = document.getElementById('gdprStatus');
    statusBox.className = 'gdpr-status' + (p.gdprAccepted ? '' : ' missing');
    statusBox.innerHTML = p.gdprAccepted
      ? TICK + ' <strong>Acord GDPR acceptat</strong>' +
        (p.gdprAcceptedAt ? '<span class="gdpr-when">' + fmtTime(p.gdprAcceptedAt) + '</span>' : '')
      : '<strong>Acordul GDPR nu a fost acceptat încă</strong>' +
        '<span class="gdpr-when">Pacientul va fi întrebat la prima autentificare</span>';
  }

  // Live filter — every keystroke re-renders just the table, not the whole
  // detail panel, so the currently open patient stays selected underneath.
  document.getElementById('patientSearch').addEventListener('input', renderPatients);

  document.getElementById('newAcct').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var form = this;
    var errBox = document.getElementById('naErr');
    errBox.hidden = true;
    var res = await MedicrossDB.createPatient({
      name: document.getElementById('naName').value,
      email: document.getElementById('naEmail').value,
      phone: document.getElementById('naPhone').value,
      sex: document.getElementById('naSex').value,
      pass: document.getElementById('naPass').value
    });
    if (res.error) { errBox.textContent = res.error; errBox.hidden = false; return; }
    form.reset();
    document.getElementById('naPass').value = 'medicross';
    currentId = res.patient.id;
    renderAll();
  });

  /* ---------------- general description ---------------- */
  function renderDetails(p) {
    document.getElementById('detailsText').value = p.details || '';
    document.getElementById('detailsSaved').hidden = true;
  }
  document.getElementById('detailsForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    await MedicrossDB.saveDetails(currentId, document.getElementById('detailsText').value);
    var note = document.getElementById('detailsSaved');
    note.hidden = false;
    setTimeout(function () { note.hidden = true; }, 1800);
    renderLog(MedicrossDB.patient(currentId));
  });

  /* ---------------- discount ---------------- */
  function renderDiscount(p) {
    var d = MedicrossDB.discountBreakdown(p.id);
    var deg = d.potential > 0 ? Math.round((d.total / d.potential) * 360) : 0;
    document.getElementById('aRing').style.background =
      'conic-gradient(var(--brand) ' + deg + 'deg, var(--ring-track) ' + deg + 'deg)';
    document.getElementById('aNum').textContent = EUR(d.total);
    document.getElementById('aCap').textContent = 'DIN ' + EUR(d.potential);

    var box = document.getElementById('aActions');
    box.textContent = '';
    d.lines.forEach(function (ln) {
      var line = el('div', 'disc-line ' + (ln.earned ? 'on' : 'off'));
      if (ln.kind === 'action') {
        line.appendChild(el('span', 'k', ACTION_LABEL[ln.key] || ln.key));
        line.appendChild(el('span', 'v', ln.earned ? 'confirmată — plătită'
          : ln.claimed ? 'declarată de pacient — așteaptă confirmarea ta' : 'neînceput'));
        line.appendChild(el('span', 'pctv', EUR(ln.eur)));
        if (ln.claimed) {
          var verifyBtn = el('button', 'ibtn' + (ln.earned ? '' : ' primary'),
            ln.earned ? 'Retrage confirmarea' : 'Confirmă');
          verifyBtn.type = 'button';
          verifyBtn.addEventListener('click', async function () {
            await MedicrossDB.verifyAction(p.id, ln.key, !ln.earned);
            renderAll();
          });
          line.appendChild(verifyBtn);
        }
      } else if (ln.kind === 'referral') {
        line.appendChild(el('span', 'k', 'Prieteni operați'));
        line.appendChild(el('span', 'v', ln.count + ' × ' + EUR(ln.eur) +
          (ln.pending ? ' · ' + ln.pending + ' în așteptare' : '')));
        line.appendChild(el('span', 'pctv', EUR(ln.count * ln.eur)));
      } else {
        line.appendChild(el('span', 'k', 'Cod folosit la înscriere'));
        line.appendChild(el('span', 'v', ln.code || 'niciunul'));
        line.appendChild(el('span', 'pctv', EUR(ln.eur)));
      }
      box.appendChild(line);
    });
  }

  /* ---------------- referrals + used code ---------------- */
  function renderReferrals(p) {
    document.getElementById('aOwnCode').textContent = p.referralCode;
    var box = document.getElementById('refList');
    box.textContent = '';
    if (!p.referrals.length) {
      box.appendChild(el('div', 'ref-empty', 'Nicio recomandare înregistrată.'));
    }
    p.referrals.forEach(function (r) {
      var line = el('div', 'ref-line');
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', r.name));
      g.appendChild(el('div', 'm', 'înscris ' + fmtTime(r.at) +
        (r.status === 'operat' && r.operatedAt ? ' · operat ' + fmtTime(r.operatedAt) : '') +
        (r.status === 'operat' ? ' · ' + EUR(MedicrossDB.REWARDS.referralOperated) + ' acordați' : '')));
      line.appendChild(g);

      var sel = el('select');
      Object.keys(REF_STATUS).forEach(function (k) {
        var o = el('option', null, REF_STATUS[k]); o.value = k;
        if (r.status === k) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', async function () {
        await MedicrossDB.setReferralStatus(p.id, r.id, sel.value);
        renderAll();
      });
      line.appendChild(sel);

      var del = el('button', 'ibtn danger', 'Șterge');
      del.type = 'button';
      del.addEventListener('click', async function () {
        await MedicrossDB.removeReferral(p.id, r.id);
        renderAll();
      });
      line.appendChild(del);
      box.appendChild(line);
    });

    document.getElementById('codeInput').value = p.usedCode ? p.usedCode.code : '';
    document.getElementById('codeErr').hidden = true;
  }

  document.getElementById('refAdd').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var input = document.getElementById('refName');
    if (await MedicrossDB.addReferral(currentId, input.value)) { input.value = ''; renderAll(); }
  });

  document.getElementById('codeForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var errBox = document.getElementById('codeErr');
    var res = await MedicrossDB.setUsedCode(currentId, document.getElementById('codeInput').value);
    if (res.error) { errBox.textContent = res.error; errBox.hidden = false; return; }
    errBox.hidden = true;
    renderAll();
  });

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
      del.addEventListener('click', async function () {
        if (confirm('Ștergi intervenția „' + op.name + '”?')) {
          await MedicrossDB.removeOperation(p.id, op.id);
          renderAll();
        }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  /* ---- standard procedure catalogue drives the picker + the 3D zone ----
   * The zone is never chosen by hand: every procedure carries the regions it
   * operates on, so the mannequin highlight follows from the procedure alone.
   * The form only reports which zone will light up.                        */
  var ZONE_LABEL = {
    abdomen: 'abdomen', arm: 'brațe', breast: 'sâni', buttocks: 'fesieri', chest: 'torace',
    foot: 'picioare', hand: 'mâini', head: 'cap / față', hip: 'flancuri', jaw: 'maxilar',
    neck: 'gât', nose: 'nas', thigh: 'coapse',
    stomach: 'stomac', intestine: 'intestin', esophagus: 'esofag'
  };

  // hidden state: filled from the catalogue, submitted with the operation
  var zoneState = { regions: '', viewMode: 'surface' };

  function renderZoneInfo() {
    var box = document.getElementById('opZoneInfo');
    var list = zoneState.regions.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!list.length) {
      box.className = 'full zoneinfo none';
      box.innerHTML = 'Intervenție personalizată — nicio zonă atribuită, deci nu se evidențiază ' +
        'nimic pe manechin. Alege o intervenție standard dacă vrei evidențierea automată.';
      return;
    }
    box.className = 'full zoneinfo';
    box.innerHTML = 'Zona evidențiată pe manechinul 3D: <strong>' +
      list.map(function (r) { return ZONE_LABEL[r] || r; }).join(', ') + '</strong> ' +
      '<code>' + list.join(',') + '</code> · vedere ' +
      (zoneState.viewMode === 'internal' ? '<strong>organe interne</strong>' : '<strong>suprafață</strong>') +
      ' — atribuită automat de intervenție.';
  }

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

  // applies a catalogue entry: name, detail and — automatically — the 3D zone
  function applyCatalog(key, keepDetail) {
    var custom = key === '__custom';
    document.getElementById('opNameWrap').hidden = !custom;
    if (custom) {
      zoneState = { regions: '', viewMode: 'surface' };
      renderZoneInfo();
      document.getElementById('opName').focus();
      return;
    }
    var pr = MedicrossDB.procedure(key);
    if (!pr) return;
    document.getElementById('opName').value = pr.name;
    if (!keepDetail) document.getElementById('opDetail').value = pr.detail;
    zoneState = { regions: pr.regions, viewMode: pr.viewMode };
    renderZoneInfo();
  }

  document.getElementById('opCatalog').addEventListener('change', function () {
    applyCatalog(this.value, false);
  });

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
      if (sel.value === '__custom') {
        zoneState = { regions: op.regions || '', viewMode: op.viewMode || 'surface' };
      } else {
        // re-read from the catalogue so the zone always matches the procedure
        var pr = MedicrossDB.procedure(sel.value);
        zoneState = { regions: pr.regions, viewMode: pr.viewMode };
      }
      renderZoneInfo();
    } else {
      sel.selectedIndex = 0;
      document.getElementById('opDetail').value = '';
      applyCatalog(sel.value, false);   // assigns the 3D zone for the default pick
    }
    document.getElementById('opStatus').value = op ? op.status : 'programata';
    document.getElementById('opDate').value = op ? op.date : '';
    document.getElementById('opActive').checked = !!(op && op.active);
  }
  document.getElementById('opAdd').addEventListener('click', function () { openOpForm(null); });
  document.getElementById('opCancel').addEventListener('click', function () {
    document.getElementById('opForm').hidden = true; editingOp = null;
  });
  document.getElementById('opForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var key = document.getElementById('opCatalog').value;
    var name = key === '__custom'
      ? document.getElementById('opName').value.trim()
      : (MedicrossDB.procedure(key) || {}).name;
    if (!name) { document.getElementById('opName').focus(); return; }
    await MedicrossDB.saveOperation(currentId, {
      id: editingOp ? editingOp.id : null,
      name: name,
      detail: document.getElementById('opDetail').value.trim(),
      status: document.getElementById('opStatus').value,
      date: document.getElementById('opDate').value.trim(),
      regions: zoneState.regions,       // assigned by the procedure, not typed
      viewMode: zoneState.viewMode,
      active: document.getElementById('opActive').checked
    });
    document.getElementById('opForm').hidden = true;
    editingOp = null;
    renderAll();
  });

  /* ---------------- trip agenda ---------------- */
  var editingTrip = null;

  function buildHospitalSelect() {
    var sel = document.getElementById('tiHospital');
    sel.textContent = '';
    var none = document.createElement('option');
    none.value = ''; none.textContent = '— fără spital —';
    sel.appendChild(none);
    MedicrossDB.HOSPITALS.forEach(function (h) {
      var o = document.createElement('option');
      o.value = h.name; o.textContent = h.name;
      sel.appendChild(o);
    });
  }
  function renderTrip(p) {
    document.getElementById('tmTitle').value = p.trip.title;
    document.getElementById('tmSub').value = p.trip.subtitle;
    var box = document.getElementById('tripList');
    box.textContent = '';
    p.trip.items.forEach(function (it, i) {
      var row = el('div', 'itemrow' + (it.surgery ? ' surgery-row' : ''));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', it.date + ' — ' + it.desc));
      g.appendChild(el('div', 'm',
        (it.surgery ? 'Ziua intervenției · ' : '') +
        (it.hospital ? it.hospital + ' · ' : '') + 'pictogramă: ' + it.icon));
      row.appendChild(g);
      var up = el('button', 'ibtn', '↑'); up.type = 'button'; up.disabled = i === 0;
      up.setAttribute('aria-label', 'Mută mai sus');
      up.addEventListener('click', async function () { await MedicrossDB.moveTripItem(p.id, it.id, -1); renderAll(); });
      row.appendChild(up);
      var down = el('button', 'ibtn', '↓'); down.type = 'button'; down.disabled = i === p.trip.items.length - 1;
      down.setAttribute('aria-label', 'Mută mai jos');
      down.addEventListener('click', async function () { await MedicrossDB.moveTripItem(p.id, it.id, 1); renderAll(); });
      row.appendChild(down);
      var edit = el('button', 'ibtn', 'Editează'); edit.type = 'button';
      edit.addEventListener('click', function () { openTripForm(it); });
      row.appendChild(edit);
      var del = el('button', 'ibtn danger', 'Șterge'); del.type = 'button';
      del.addEventListener('click', async function () {
        if (confirm('Ștergi etapa „' + it.desc + '”?')) { await MedicrossDB.removeTripItem(p.id, it.id); renderAll(); }
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
    document.getElementById('tiHospital').value = (it && it.hospital) || '';
    document.getElementById('tiSurgery').checked = !!(it && it.surgery);
    document.getElementById('tiDate').focus();
  }
  document.getElementById('tripAdd').addEventListener('click', function () { openTripForm(null); });
  document.getElementById('tripCancel').addEventListener('click', function () {
    document.getElementById('tripForm').hidden = true; editingTrip = null;
  });
  document.getElementById('tripForm').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var date = document.getElementById('tiDate').value.trim();
    var desc = document.getElementById('tiDesc').value.trim();
    if (!date || !desc) return;
    await MedicrossDB.saveTripItem(currentId, {
      id: editingTrip ? editingTrip.id : null,
      date: date, desc: desc,
      icon: document.getElementById('tiIcon').value,
      hospital: document.getElementById('tiHospital').value,
      surgery: document.getElementById('tiSurgery').checked
    });
    document.getElementById('tripForm').hidden = true;
    editingTrip = null;
    renderAll();
  });
  document.getElementById('tripMeta').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    await MedicrossDB.saveTripMeta(currentId,
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
      row.appendChild(el('span', 'doc-ph', '📄'));
      var g = el('div', 'grow');
      g.appendChild(el('div', 't', d.name));
      g.appendChild(el('div', 'm',
        fmtSize(d.size) + ' · ' + (d.by === 'staff' ? 'echipă' : 'pacient') + ' · ' + fmtTime(d.uploadedAt)));
      row.appendChild(g);
      var dl = document.createElement('a');
      dl.className = 'ibtn'; dl.textContent = 'Descarcă';
      dl.href = d.url; dl.download = d.name;
      row.appendChild(dl);
      var del = el('button', 'ibtn danger', 'Șterge'); del.type = 'button';
      del.addEventListener('click', async function () {
        if (confirm('Ștergi „' + d.name + '”?')) { await MedicrossDB.removeDocument(p.id, d.id); renderAll(); }
      });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  document.getElementById('adminUpload').addEventListener('change', async function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    for (var i = 0; i < files.length; i++) {
      try { await MedicrossDB.addDocument(currentId, files[i]); }
      catch (err) { window.alert(err.message); }
    }
    renderAll();
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
    renderDetails(p);
    renderDiscount(p);
    renderReferrals(p);
    renderOps(p);
    renderTrip(p);
    renderDocs(p);
    renderLog(p);
  }
  buildCatalogSelect();
  buildHospitalSelect();
  renderAll();
})();
