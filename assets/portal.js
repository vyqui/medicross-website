/* Medicross client portal — dashboard interactions.
 *
 * Data comes from assets/portal-data.js (MedicrossDB), a localStorage-backed
 * demo store shared with the admin console (admin.html): what the admin edits
 * shows up here, what the patient uploads shows up there. There is still no
 * real backend — see README-PORTAL.md for the production architecture and
 * the GDPR requirements (server-side verification of every discount action,
 * auditable consent records).
 */
(function () {
  'use strict';

  var sess = MedicrossDB.requireRole('patient');
  if (!sess) return;
  var PID = sess.patientId || (MedicrossDB.patients()[0] && MedicrossDB.patients()[0].id);
  var CAP = 25;

  // An admin may open this page to see what the patient sees. Everything they do
  // is attributed to the staff, and consent stays the patient's own act — staff
  // must never be able to grant or revoke it on the patient's behalf.
  var AS_ADMIN = sess.role === 'admin';
  var WHO = AS_ADMIN ? 'staff' : 'pacient';

  function P() { return MedicrossDB.patient(PID); }

  /* ---------------- header: identity + logout ---------------- */
  (function () {
    var p = P();
    if (!p) return;
    var nameEl = document.querySelector('.ph-user-txt .name');
    if (nameEl) nameEl.textContent = p.name;
    var avEl = document.querySelector('.ph-avatar');
    if (avEl) avEl.textContent = p.initials;
    var h1 = document.querySelector('.welcome h1');
    if (h1) h1.textContent = 'Bună, ' + p.name.split(' ')[0] + '.';
    var out = document.getElementById('logoutBtn');
    if (out) out.addEventListener('click', function () {
      MedicrossDB.logout();
      location.href = 'login.html';
    });

    if (AS_ADMIN) {
      var role = document.querySelector('.ph-user-txt .role');
      if (role) role.textContent = 'Vizualizare admin';
      var main = document.querySelector('.pmain');
      if (main) {
        var bar = document.createElement('div');
        bar.className = 'admin-view-note';
        bar.innerHTML = 'Vizualizezi portalul pacientului ca <strong>administrator</strong>. ' +
          'Consimțămintele de marketing pot fi acordate sau retrase doar de pacient. ' +
          '<a href="admin.html">Înapoi în consolă</a>';
        main.insertBefore(bar, main.firstChild);
      }
    }
  })();

  /* ---------------- body map wiring ---------------- */
  var frames = Array.prototype.slice.call(document.querySelectorAll('[data-bodymap]'));

  function activeRegions() {
    var p = P();
    for (var i = 0; i < p.operations.length; i++) {
      var op = p.operations[i];
      if (opKey(op) === p.activeOp) return (op.regions || 'abdomen,breast').split(',');
    }
    return ['abdomen', 'breast'];
  }

  function pushBody() {
    var p = P();
    var msg = { type: 'bodymap', sex: p.sex || 'f', mode: p.mode, regions: activeRegions() };
    frames.forEach(function (f) {
      try { f.contentWindow.postMessage(msg, '*'); } catch (e) { /* local file:// preview */ }
    });
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'bodymap-ready') pushBody();
  });

  /* stable chip key per operation (op1 -> 'mommy' style keys kept for the seed) */
  function opKey(op) { return op.id; }

  function renderChips() {
    var box = document.getElementById('opChips');
    if (!box) return;
    var p = P();
    box.textContent = '';
    p.operations.forEach(function (op) {
      if (!op.regions) return;
      var b = document.createElement('button');
      b.className = 'opchip' + (p.activeOp === opKey(op) ? ' active' : '');
      b.textContent = op.name;
      b.setAttribute('aria-pressed', String(p.activeOp === opKey(op)));
      b.addEventListener('click', function () {
        MedicrossDB.setView(PID, opKey(op), op.viewMode || 'surface');
        renderChips(); syncModeSeg(); pushBody();
      });
      box.appendChild(b);
    });
  }

  function syncModeSeg() {
    var p = P();
    document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
      var on = btn.dataset.modeBtn === p.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      MedicrossDB.setView(PID, null, btn.dataset.modeBtn);
      syncModeSeg(); pushBody();
    });
  });

  /* ---------------- operations list ---------------- */
  var STATUS = {
    programata: { cls: 'programata', label: 'Programată' },
    evaluare: { cls: 'evaluare', label: 'În evaluare' },
    finalizata: { cls: 'finalizata', label: 'Finalizată' }
  };

  function renderOps() {
    var box = document.getElementById('opRows');
    if (!box) return;
    var p = P();
    box.textContent = '';
    if (!p.operations.length) {
      var none = document.createElement('div');
      none.className = 'empty-note';
      none.textContent = 'Nu ai încă intervenții înregistrate. Echipa Medicross le adaugă aici după evaluarea medicală.';
      box.appendChild(none);
      return;
    }
    var idx = 0;
    p.operations.forEach(function (op) {
      var st = STATUS[op.status] || STATUS.evaluare;
      var row = document.createElement('div');
      var done = op.status === 'finalizata';
      row.className = 'oprow' + (op.active ? ' active-row' : '') + (done ? ' done-row' : '');

      var tile = document.createElement('span');
      tile.className = 'op-idx' + (done ? ' done' : '');
      if (done) {
        tile.innerHTML = '<svg viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>';
      } else {
        idx += 1;
        tile.textContent = (idx < 10 ? '0' : '') + idx;
      }
      row.appendChild(tile);

      var body = document.createElement('div');
      body.className = 'op-body';
      var t = document.createElement('div'); t.className = 't'; t.textContent = op.name;
      var d = document.createElement('div'); d.className = 'd'; d.textContent = op.detail || '';
      body.appendChild(t); body.appendChild(d);
      row.appendChild(body);

      var meta = document.createElement('div');
      meta.className = 'op-meta';
      var pill = document.createElement('span');
      pill.className = 'op-pill ' + st.cls; pill.textContent = st.label;
      var date = document.createElement('div');
      date.className = 'op-date'; date.textContent = op.date || '—';
      meta.appendChild(pill); meta.appendChild(date);
      row.appendChild(meta);

      box.appendChild(row);
    });
  }

  /* ---------------- trip schedule ---------------- */
  var ICONS = {
    plane: '<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.3 6.6A.6.6 0 014 5.8l8 3.2 3.5-1.4a1.8 1.8 0 011.4 3.3L6 16.5"/>',
    building: '<path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/>',
    tag: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12.6l-7 7a2 2 0 01-2.8 0l-5.3-5.3a2 2 0 010-2.8l7-7A2 2 0 0110 4h4.5A2 2 0 0116 5.5V10a2 2 0 01-.6 1.4z"/>',
    plus: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v18M3 12h18"/>',
    star: '<path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.5a.6.6 0 011.04 0l2.6 5.27 5.8.84a.6.6 0 01.33 1l-4.2 4.1 1 5.78a.6.6 0 01-.87.63L12 18.5l-5.2 2.73a.6.6 0 01-.87-.63l1-5.78-4.2-4.1a.6.6 0 01.32-1l5.8-.84z"/>',
    home: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.95-8.95a1.13 1.13 0 011.6 0L21.75 12M4.5 9.75V21h5.25v-6h4.5v6h5.25V9.75"/>'
  };

  function renderTrip() {
    var p = P();
    var h2 = document.querySelector('.schedule-card h2');
    var sub = document.querySelector('.schedule-card .sub');
    if (h2) h2.textContent = p.trip.title;
    if (sub) sub.textContent = p.trip.subtitle;
    var line = document.querySelector('.timeline');
    if (!line) return;
    line.textContent = '';
    if (!p.trip.items.length) {
      var none = document.createElement('div');
      none.className = 'empty-note';
      none.textContent = 'Programul călătoriei apare aici imediat ce intervenția este confirmată.';
      line.appendChild(none);
      return;
    }
    p.trip.items.forEach(function (it) {
      var node = document.createElement('div');
      node.className = 'tnode' + (it.surgery ? ' surgery' : '');
      var dot = document.createElement('span');
      dot.className = 'dot';
      dot.innerHTML = '<svg viewBox="0 0 24 24" width="18" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">' +
        (ICONS[it.icon] || ICONS.tag) + '</svg>';
      node.appendChild(dot);
      var wrap = document.createElement('div');
      var date = document.createElement('div'); date.className = 'date'; date.textContent = it.date;
      var desc = document.createElement('div'); desc.className = 'desc'; desc.textContent = it.desc;
      wrap.appendChild(date); wrap.appendChild(desc);
      if (it.hospital) {
        var hosp = document.createElement('div');
        hosp.className = 'hosp';
        hosp.textContent = it.hospital;
        wrap.appendChild(hosp);
      }
      node.appendChild(wrap);
      line.appendChild(node);
    });
  }

  /* ---------------- general description from the team ---------------- */
  function renderDetails() {
    var card = document.getElementById('detailsCard');
    var body = document.getElementById('patientDetails');
    if (!card || !body) return;
    var txt = (P().details || '').trim();
    body.textContent = txt;
    card.hidden = !txt;      // no card at all when the team hasn't written anything
  }

  /* ---------------- next-intervention card ---------------- */
  function renderNext() {
    var p = P();
    var val = document.querySelector('.next-txt .val');
    if (!val) return;
    var next = null;
    p.operations.forEach(function (op) { if (!next && op.status === 'programata') next = op; });
    if (next) {
      val.textContent = '';
      val.appendChild(document.createTextNode(next.name + ' · '));
      var cnt = document.createElement('span');
      cnt.className = 'cnt';
      cnt.textContent = next.date ? next.date : 'programare în curs';
      val.appendChild(cnt);
    } else {
      val.textContent = 'Nicio intervenție programată';
    }
  }

  /* ---------------- discount ---------------- */
  function earned(a) { return a.done && (!a.needsConsent || a.consent); }

  function updateUI() {
    var p = P();
    var total = MedicrossDB.discount(PID);
    var deg = Math.round((total / CAP) * 360);
    var ring = document.getElementById('discRing');
    var num = document.getElementById('discNum');
    if (ring) ring.style.background = 'conic-gradient(var(--brand) ' + deg + 'deg, var(--ring-track) ' + deg + 'deg)';
    if (num) num.textContent = total + '%';

    document.querySelectorAll('.arow').forEach(function (row) {
      var key = row.dataset.action;
      var a = p.actions[key];
      if (!a) return;
      var active = earned(a);
      row.classList.toggle('earned', active);

      var status = row.querySelector('[data-status]');
      if (status) {
        if (key === 'referral') status.textContent = p.referralCount + (p.referralCount === 1 ? ' prieten înscris' : ' prieteni înscriși') + ' · +' + (a.pct * p.referralCount) + '%';
        else if (active) status.textContent = 'Activă · +' + a.pct + '% aplicat';
        else if (a.done && a.needsConsent && !a.consent) status.textContent = 'Bifează consimțământul pentru a activa';
        else status.textContent = 'Neînceput';
      }

      var btn = row.querySelector('[data-toggle]');
      if (btn) {
        if (key === 'google') {
          btn.textContent = 'Adăugată ✓';
          btn.className = 'a-btn earned-btn';
          btn.disabled = true; // server-verified — not user-revocable from the UI
        } else if (key === 'referral') {
          btn.textContent = 'Invită';
          btn.className = 'a-btn outline-btn';
        } else {
          btn.textContent = a.done ? 'Trimis ✓' : 'Încarcă';
          btn.className = a.done ? 'a-btn earned-btn' : 'a-btn';
        }
      }
    });
  }

  document.querySelectorAll('.arow').forEach(function (row) {
    var key = row.dataset.action;
    var toggle = row.querySelector('[data-toggle]');
    var consent = row.querySelector('[data-consent]');
    var fileInput = null;

    if (toggle && key !== 'google' && key !== 'referral') {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = key === 'video' ? 'video/*' : 'image/*';
      fileInput.multiple = key === 'photos';
      fileInput.style.display = 'none';
      row.appendChild(fileInput);
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) {
          // register the upload in the shared store so the admin sees the files
          Array.prototype.slice.call(fileInput.files).forEach(function (f) {
            var reader = new FileReader();
            reader.onload = function () { MedicrossDB.addDocument(PID, f, reader.result, WHO); renderDocs(); };
            reader.onerror = function () { MedicrossDB.addDocument(PID, f, null, WHO); renderDocs(); };
            reader.readAsDataURL(f);
          });
          MedicrossDB.setAction(PID, key, { done: true }, WHO);
          updateUI();
        }
      });
      toggle.addEventListener('click', function () {
        var a = P().actions[key];
        if (a.done) { MedicrossDB.setAction(PID, key, { done: false }, WHO); updateUI(); }
        else fileInput.click();
      });
    } else if (toggle && key === 'referral') {
      toggle.addEventListener('click', function () {
        window.alert('Trimite acest cod prietenilor tăi: ' + P().referralCode + '\n(Ecran de invitație complet — în lucru.)');
      });
    }

    if (consent) {
      consent.checked = P().actions[key].consent;
      if (AS_ADMIN) {
        // consent is the patient's own act — staff can see it, never change it
        consent.disabled = true;
        var lbl = consent.closest('.a-consent');
        if (lbl) lbl.title = 'Doar pacientul poate acorda sau retrage consimțământul.';
      } else {
        consent.addEventListener('change', function () {
          MedicrossDB.setAction(PID, key, { consent: consent.checked }, WHO);
          updateUI();
        });
      }
    }
  });

  /* ---------------- referral code ---------------- */
  (function () {
    var codeEl = document.querySelector('.ref-code');
    if (codeEl) codeEl.textContent = P().referralCode;
    var copyBtn = document.getElementById('copyBtn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', function () {
      var code = P().referralCode;
      var done = function () {
        var original = copyBtn.textContent;
        copyBtn.textContent = 'Copiat ✓';
        copyBtn.classList.add('copied');
        setTimeout(function () { copyBtn.textContent = original; copyBtn.classList.remove('copied'); }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(ta);
        done();
      }
    });
  })();

  /* ---------------- documents ---------------- */
  function fmtSize(b) {
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  }

  function renderDocs() {
    var list = document.querySelector('.doclist');
    var drop = document.getElementById('dropZone');
    if (!list || !drop) return;
    list.querySelectorAll('.doc-row').forEach(function (r) { r.remove(); });
    P().documents.forEach(function (d) {
      var row;
      if (d.dataUrl) {
        row = document.createElement('a');
        row.href = d.dataUrl;
        row.setAttribute('download', d.name);
      } else {
        row = document.createElement('div');
      }
      row.className = 'doc-row';
      var ic = document.createElement('span');
      ic.className = 'ic';
      ic.innerHTML = '<svg viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.6c0-1.1-.9-2-2-2h-11c-1.1 0-2 .9-2 2v2.6M12 3v10.5m0 0l3.75-3.75M12 13.5L8.25 9.75"/></svg>';
      row.appendChild(ic);
      var body = document.createElement('div');
      var t = document.createElement('div'); t.className = 't'; t.textContent = d.name;
      var m = document.createElement('div'); m.className = 'm';
      m.textContent = (d.type === 'application/pdf' ? 'PDF · ' : '') + fmtSize(d.size) +
        (d.by === 'staff' ? ' · de la echipă' : '');
      body.appendChild(t); body.appendChild(m);
      row.appendChild(body);
      list.insertBefore(row, drop);
    });
  }

  var dropZone = document.getElementById('dropZone');
  var fileInputMain = document.getElementById('fileInput');
  function handleFiles(files) {
    Array.prototype.slice.call(files).forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () { MedicrossDB.addDocument(PID, f, reader.result, 'pacient'); renderDocs(); };
      reader.onerror = function () { MedicrossDB.addDocument(PID, f, null, 'pacient'); renderDocs(); };
      reader.readAsDataURL(f);
    });
  }
  if (dropZone && fileInputMain) {
    fileInputMain.addEventListener('change', function () { handleFiles(fileInputMain.files); fileInputMain.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropZone.addEventListener(ev, function (e) { e.preventDefault(); dropZone.classList.remove('dragover'); });
    });
    dropZone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    });
  }

  /* ---------------- mobile bottom tabs ---------------- */
  document.querySelectorAll('.ptabs a').forEach(function (a) {
    a.addEventListener('click', function () {
      document.querySelectorAll('.ptabs a').forEach(function (x) { x.classList.remove('active'); });
      a.classList.add('active');
    });
  });

  /* ---------------- init ---------------- */
  // migrate the seed's activeOp key ('mommy') to the operation id it refers to
  (function () {
    var p = P();
    var keys = p.operations.map(opKey);
    if (keys.indexOf(p.activeOp) === -1) {
      var active = null;
      p.operations.forEach(function (op) { if (!active && op.active) active = op; });
      p.activeOp = active ? opKey(active) : (keys[0] || null);
      MedicrossDB._save();
    }
  })();

  renderChips();
  syncModeSeg();
  renderOps();
  renderDetails();
  renderTrip();
  renderNext();
  renderDocs();
  updateUI();
  setTimeout(pushBody, 500); // also re-pushed on the bodymap-ready message
})();
