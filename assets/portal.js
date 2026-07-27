/* Medicross client portal — dashboard interactions.
 *
 * There is no backend behind this static site. Patient/operation data below
 * is a fixture standing in for what a real API would return; the discount
 * "actions" state is persisted to localStorage only so a reload doesn't
 * reset the demo — it is NOT a substitute for server-side verification.
 * A production build must re-validate every earned action (review actually
 * posted, media actually received) before honoring a discount, and must
 * keep an auditable consent record (who/what/when/revocations) since this
 * is personal, GDPR-sensitive data. See README-PORTAL.md.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'medicross_portal_state_v1';
  var CAP = 25;

  var defaultState = {
    activeOp: 'mommy',
    mode: 'surface',
    actions: {
      google:   { done: true,  needsConsent: false, consent: false, pct: 4 },
      video:    { done: false, needsConsent: true,  consent: false, pct: 10 },
      photos:   { done: false, needsConsent: true,  consent: false, pct: 5 },
      referral: { done: true,  needsConsent: false, consent: false, pct: 3 }
    }
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      var parsed = JSON.parse(raw);
      // shallow-merge so a future extra action key doesn't crash an older saved blob
      var merged = JSON.parse(JSON.stringify(defaultState));
      merged.activeOp = parsed.activeOp || merged.activeOp;
      merged.mode = parsed.mode || merged.mode;
      for (var k in merged.actions) {
        if (parsed.actions && parsed.actions[k]) {
          merged.actions[k].done = !!parsed.actions[k].done;
          merged.actions[k].consent = !!parsed.actions[k].consent;
        }
      }
      return merged;
    } catch (e) {
      return JSON.parse(JSON.stringify(defaultState));
    }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode / quota — non-fatal */ }
  }

  var state = loadState();

  var REGION_MAP = {
    mommy: ['abdomen', 'breast'],
    bbl: ['buttocks'],
    rino: ['nose'],
    sleeve: ['stomach']
  };

  // ---------------- body map wiring ----------------
  var frames = Array.prototype.slice.call(document.querySelectorAll('[data-bodymap]'));

  function pushBody() {
    var regions = REGION_MAP[state.activeOp] || REGION_MAP.mommy;
    var msg = { type: 'bodymap', sex: 'f', mode: state.mode, regions: regions };
    frames.forEach(function (f) {
      try { f.contentWindow.postMessage(msg, '*'); } catch (e) { /* cross-origin during local file:// preview */ }
    });
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'bodymap-ready') pushBody();
  });

  function syncOpChips() {
    document.querySelectorAll('.opchip').forEach(function (btn) {
      var on = btn.dataset.opKey === state.activeOp;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }
  function syncModeSeg() {
    document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
      var on = btn.dataset.modeBtn === state.mode;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  document.querySelectorAll('.opchip').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.activeOp = btn.dataset.opKey;
      state.mode = btn.dataset.mode;
      syncOpChips();
      syncModeSeg();
      pushBody();
      saveState();
    });
  });
  document.querySelectorAll('[data-mode-btn]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.mode = btn.dataset.modeBtn;
      syncModeSeg();
      pushBody();
      saveState();
    });
  });

  // ---------------- discount logic (spec: stack, 25% cap, consent-gated, revocable) ----------------
  function earned(a) { return a.done && (!a.needsConsent || a.consent); }

  function computeDiscount() {
    var sum = 0;
    for (var k in state.actions) { if (earned(state.actions[k])) sum += state.actions[k].pct; }
    return Math.min(sum, CAP);
  }

  function updateUI() {
    var total = computeDiscount();
    var deg = Math.round((total / CAP) * 360);
    var ring = document.getElementById('discRing');
    var num = document.getElementById('discNum');
    if (ring) ring.style.background = 'conic-gradient(var(--brand) ' + deg + 'deg, var(--ring-track) ' + deg + 'deg)';
    if (num) num.textContent = total + '%';

    document.querySelectorAll('.arow').forEach(function (row) {
      var key = row.dataset.action;
      var a = state.actions[key];
      var active = earned(a);
      row.classList.toggle('earned', active);

      var status = row.querySelector('[data-status]');
      if (status) {
        if (key === 'referral') status.textContent = '1 prieten înscris · +3%';
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
      // simulate an upload: clicking "Încarcă" opens a file picker; selecting a file marks it submitted.
      // "Trimis ✓" reverts the row back to "Încarcă" (revocable), matching the toggle semantics in the spec.
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = key === 'video' ? 'video/*' : 'image/*';
      fileInput.multiple = key === 'photos';
      fileInput.style.display = 'none';
      row.appendChild(fileInput);
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files.length) {
          state.actions[key].done = true;
          updateUI();
          saveState();
        }
      });
      toggle.addEventListener('click', function () {
        if (state.actions[key].done) { state.actions[key].done = false; updateUI(); saveState(); }
        else fileInput.click();
      });
    } else if (toggle && key === 'referral') {
      toggle.addEventListener('click', function () {
        var msg = 'Trimite acest cod prietenilor tăi: MEDI-ANDREEA-2K6\n(Ecran de invitație complet — în lucru.)';
        window.alert(msg);
      });
    }
    // google toggle is intentionally inert (disabled) — see updateUI()

    if (consent) {
      consent.checked = state.actions[key].consent;
      consent.addEventListener('change', function () {
        state.actions[key].consent = consent.checked;
        updateUI();
        saveState();
      });
    }
  });

  // ---------------- referral code copy ----------------
  var copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    var codeEl = document.querySelector('.ref-code');
    copyBtn.addEventListener('click', function () {
      var code = codeEl ? codeEl.textContent.trim() : 'MEDI-ANDREEA-2K6';
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
  }

  // ---------------- document upload dropzone (client-side demo only — no storage backend) ----------------
  var dropZone = document.getElementById('dropZone');
  var fileInputMain = document.getElementById('fileInput');
  var docList = document.querySelector('.doclist');
  function humanSize(bytes) {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function addUploadedRow(file) {
    var row = document.createElement('div');
    row.className = 'doc-row';
    row.innerHTML = '<span class="ic"><svg viewBox="0 0 24 24" width="20" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg></span>' +
      '<div><div class="t"></div><div class="m">Încărcat acum · ' + humanSize(file.size) + '</div></div>';
    row.querySelector('.t').textContent = file.name;
    dropZone.parentElement.insertBefore(row, dropZone);
  }
  function handleFiles(files) {
    Array.prototype.slice.call(files).forEach(addUploadedRow);
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

  // ---------------- mobile bottom tabs: highlight on tap ----------------
  document.querySelectorAll('.ptabs a').forEach(function (a) {
    a.addEventListener('click', function () {
      document.querySelectorAll('.ptabs a').forEach(function (x) { x.classList.remove('active'); });
      a.classList.add('active');
    });
  });

  // ---------------- init ----------------
  syncOpChips();
  syncModeSeg();
  updateUI();
  setTimeout(pushBody, 500); // give the iframe a moment to announce bodymap-ready; also re-pushed on the ready message
})();
