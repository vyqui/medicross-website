// opd-consultatii.html — doctor-card carousel + native booking widget.
// Vanilla JS port of the design handoff's component logic (no framework on this site).

(function () {
  const DOCS = [
    { id: 'ulu', name: 'Prof. Dr. Şahin Ulu', spec: 'ORL', dayName: 'Sâmbătă', dow: 6, start: '17:00', end: '19:00', max: 8,
      bio: 'Membru al echipei de medici ORL din programul OPD Medicross. Detaliile complete despre pregătirea sa se adaugă în curând.' },
    { id: 'esen', name: 'Op. Dr. İkram Esen', spec: 'Chirurgie plastică', dayName: 'Joi', dow: 4, start: '20:00', end: '21:00', max: 4,
      bio: 'Chirurg specializat în chirurgie estetică mamară, cu experiență în sute de proceduri. La OPD îți oferă o evaluare personalizată, gratuită.' },
    { id: 'tanriverdi', name: 'Op. Dr. Hasan Tanrıverdi', spec: 'ORL', dayName: 'Miercuri', dow: 3, start: '19:00', end: '20:00', max: 4,
      bio: 'Pregătire la Universitatea Ege și Universitatea Ankara, specializat în otologie și chirurgia urechii medii (timpanoplastie, stapedotomie), cu lucrări științifice publicate internațional.' },
    { id: 'demirbaglar', name: 'Op. Dr. Çağrı Demirbağlar', spec: 'ORL', dayName: 'Marți', dow: 2, start: '20:00', end: '21:00', max: 4,
      bio: 'Expert în rinoplastie estetică și funcțională prin tehnica ultrasonică Piezo — minim invazivă, cu recuperare rapidă și rezultate naturale.' }
  ];
  const START = new Date(2026, 9, 20);
  const DOW = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
  const MON = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WA_NUMBER = '40746992222';

  const state = { doc: null, dateIdx: 0, slot: null, name: '', phone: '', email: '', note: '', tried: false, active: 0, railPaused: false };

  function initials(n) { return n.replace(/^(Prof\.|Op\.)\s*Dr\.\s*/, '').split(' ').map(w => w[0]).slice(0, 2).join(''); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Keep three future consultation dates, rolling over at midnight in Romania.
  function bucharestDateKey() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }
  function datesFor(d) {
    const [year, month, day] = bucharestDateKey().split('-').map(Number);
    // Dates shown are strictly after today: on 22 Oct, 22 Oct leaves the list.
    const tomorrow = new Date(year, month - 1, day + 1);
    let x = new Date(Math.max(START.getTime(), tomorrow.getTime()));
    while (x.getDay() !== d.dow) x.setDate(x.getDate() + 1);
    const out = [];
    for (let i = 0; i < 3; i++) { out.push(new Date(x)); x.setDate(x.getDate() + 7); }
    return out;
  }
  function slotsFor(d) {
    const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const out = [];
    for (let t = toMin(d.start); t < toMin(d.end); t += 15) out.push(String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'));
    return out;
  }

  function track(event, extra) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event }, extra || {}));
    if (typeof window.gtag === 'function') {
      if (event === 'generate_lead') window.gtag('event', 'generate_lead');
      if (event === 'contact') window.gtag('event', 'contact');
    }
  }

  // ---- carousel ----
  const rail = document.querySelector('[data-opd-rail]');
  const cardWraps = rail ? Array.from(rail.querySelectorAll('[data-opd-card]')) : [];
  const dotsWrap = document.querySelector('[data-opd-dots]');
  let autoTimer = null;

  function railStep() {
    const card = rail.firstElementChild;
    if (!card) return 314;
    return card.getBoundingClientRect().width + 14;
  }
  function railGo(i) {
    if (!rail) return;
    rail.scrollTo({ left: i * railStep(), behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }
  function syncActive() {
    cardWraps.forEach((el, i) => el.classList.toggle('active', i === state.active));
    if (dotsWrap) Array.from(dotsWrap.children).forEach((el, i) => el.classList.toggle('active', i === state.active));
  }
  function onRailScroll() {
    if (!rail) return;
    const i = Math.max(0, Math.min(DOCS.length - 1, Math.round(rail.scrollLeft / railStep())));
    if (i !== state.active) { state.active = i; syncActive(); }
  }
  function syncCards() {
    cardWraps.forEach(el => {
      const id = el.getAttribute('data-opd-card');
      const sel = state.doc === id;
      el.classList.toggle('selected', sel);
      const cta = el.querySelector('[data-opd-card-cta]');
      if (cta) cta.textContent = sel ? 'Selectat · completează mai jos' : 'Programează-te gratuit';
    });
  }

  if (rail) {
    rail.addEventListener('scroll', onRailScroll, { passive: true });
    rail.addEventListener('pointerdown', () => { state.railPaused = true; });
    rail.addEventListener('touchstart', () => { state.railPaused = true; }, { passive: true });
    cardWraps.forEach(el => {
      const id = el.getAttribute('data-opd-card');
      const btn = el.querySelector('[data-opd-card-btn]');
      if (btn) btn.addEventListener('click', () => {
        state.railPaused = true;
        const i = cardWraps.indexOf(el);
        state.active = i; syncActive(); railGo(i);
        pickDoc(id);
        scrollToBooking();
      });
    });
    if (dotsWrap) Array.from(dotsWrap.children).forEach((dot, i) => {
      dot.addEventListener('click', () => { state.railPaused = true; state.active = i; syncActive(); railGo(i); });
    });
    if (!REDUCED_MOTION) {
      autoTimer = setInterval(() => {
        if (state.railPaused || state.doc) return;
        state.active = (state.active + 1) % DOCS.length;
        syncActive(); railGo(state.active);
      }, 3600);
    }
  }

  function scrollToBooking() {
    const el = document.getElementById('rezervare');
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: REDUCED_MOTION ? 'auto' : 'smooth' });
  }

  // ---- countdown ----
  const cdWrap = document.querySelector('[data-opd-countdown]');
  function renderCountdown() {
    if (!cdWrap) return;
    const diff = Math.max(0, START.getTime() - Date.now());
    const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24, m = Math.floor(diff / 6e4) % 60;
    cdWrap.querySelector('[data-cd-d]').textContent = d;
    cdWrap.querySelector('[data-cd-h]').textContent = h;
    cdWrap.querySelector('[data-cd-m]').textContent = m;
    cdWrap.querySelector('[data-cd-label]').textContent = diff > 0
      ? 'Primele consultații încep pe 20 octombrie. Locurile se ocupă în ordinea înscrierii.'
      : 'Consultațiile au început — rezervă următorul interval liber.';
  }
  renderCountdown();
  setInterval(renderCountdown, 30000);

  // ---- sticky bar ----
  function syncSticky() {
    const note = document.querySelector('[data-opd-sticky-note]');
    if (!note) return;
    const doc = DOCS.find(d => d.id === state.doc);
    note.textContent = doc ? doc.name : '15 min · 1 la 1 · 0 lei';
  }

  // ---- booking card ----
  const docRowsEl = document.querySelector('[data-opd-doc-rows]');
  const scheduleEl = document.querySelector('[data-opd-schedule]');
  const helpEl = document.querySelector('[data-opd-help]');
  const summaryEl = document.querySelector('[data-opd-summary]');
  const barsEl = document.querySelector('[data-opd-bars]');
  const progressChip = document.querySelector('[data-opd-progress-chip]');
  const nameInput = document.querySelector('[data-opd-name]');
  const phoneInput = document.querySelector('[data-opd-phone]');
  const emailInput = document.querySelector('[data-opd-email]');
  const noteInput = document.querySelector('[data-opd-note]');
  const submitLink = document.querySelector('[data-opd-submit]');
  const emailSubmit = document.querySelector('[data-opd-email-submit]');
  const sendStatus = document.querySelector('[data-opd-send-status]');
  let sendingEmail = false;
  const errorEl = document.querySelector('[data-opd-error]');

  function pickDoc(id) { state.doc = id; state.dateIdx = 0; state.slot = null; state.tried = false; renderBooking(); syncCards(); syncSticky(); }
  function bookFromCard(id) { pickDoc(id); scrollToBooking(); track('select_doctor', { doctor_id: id }); }

  if (docRowsEl) {
    const doctorPhotos = {
      ulu: 'materials/images/dr-sahin-ulu.webp',
      esen: 'materials/images/dr-ikram-esen.webp',
      tanriverdi: 'materials/images/dr-hasan-tanriverdi.webp',
      demirbaglar: 'materials/images/dr-cagri-demirbaglar.webp',
    };
    const rows = DOCS.map(d => ({ id: d.id, name: d.name, sub: d.spec + ' · ' + d.dayName + ' ' + d.start + '–' + d.end, photo: doctorPhotos[d.id] }));
    rows.push({ id: 'help', name: 'Ajutați-mă să aleg medicul', sub: 'Nu sunt sigur(ă) — am nevoie de recomandare' });
    docRowsEl.innerHTML = rows.map(r => `
      <button type="button" class="opd-doc-row" data-opd-row="${r.id}">
        <span class="opd-doc-av">${r.photo ? `<img src="${r.photo}" alt="" loading="lazy" decoding="async" />` : '?'}</span>
        <span class="opd-doc-text"><span class="nm">${esc(r.name)}</span><span class="sb">${esc(r.sub)}</span></span>
        <span class="opd-doc-radio"><span></span></span>
      </button>`).join('');
    docRowsEl.querySelectorAll('[data-opd-row]').forEach(btn => {
      btn.addEventListener('click', () => { pickDoc(btn.getAttribute('data-opd-row')); });
    });
  }

  let currentCalendarDay = bucharestDateKey();
  function refreshDatesOnDayChange() {
    const nextDay = bucharestDateKey();
    if (nextDay === currentCalendarDay) return;
    const doc = DOCS.find(d => d.id === state.doc);
    const oldDates = doc ? datesForPreviousDay(doc, currentCalendarDay) : [];
    const selectedDate = oldDates[state.dateIdx];
    currentCalendarDay = nextDay;
    if (doc) {
      const upcoming = datesFor(doc);
      const retained = selectedDate && upcoming.findIndex(date => date.getTime() === selectedDate.getTime());
      state.dateIdx = retained >= 0 ? retained : 0;
      state.slot = retained >= 0 ? state.slot : null;
    }
    renderBooking();
  }
  function datesForPreviousDay(doc, dayKey) {
    const [year, month, day] = dayKey.split('-').map(Number);
    let x = new Date(Math.max(START.getTime(), new Date(year, month - 1, day + 1).getTime()));
    while (x.getDay() !== doc.dow) x.setDate(x.getDate() + 1);
    return [new Date(x), new Date(x.setDate(x.getDate() + 7)), new Date(x.setDate(x.getDate() + 7))];
  }
  window.setInterval(refreshDatesOnDayChange, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDatesOnDayChange(); });

  function renderBooking() {
    const doc = DOCS.find(d => d.id === state.doc) || null;
    const help = state.doc === 'help';

    if (docRowsEl) docRowsEl.querySelectorAll('[data-opd-row]').forEach(btn => {
      btn.classList.toggle('selected', btn.getAttribute('data-opd-row') === state.doc);
    });

    let dList = [];
    if (scheduleEl) {
      if (doc) {
        scheduleEl.style.display = '';
        dList = datesFor(doc);
        const datesWrap = scheduleEl.querySelector('[data-opd-dates]');
        datesWrap.innerHTML = dList.map((dt, i) => `
          <button type="button" class="opd-date-btn${i === state.dateIdx ? ' selected' : ''}" data-opd-date="${i}">
            <span class="dow">${DOW[dt.getDay()]}</span><span class="day">${dt.getDate()} ${MON[dt.getMonth()]}</span>
          </button>`).join('');
        datesWrap.querySelectorAll('[data-opd-date]').forEach(btn => {
          btn.addEventListener('click', () => { state.dateIdx = Number(btn.getAttribute('data-opd-date')); state.slot = null; renderBooking(); });
        });
        const slotsWrap = scheduleEl.querySelector('[data-opd-slots]');
        const slotList = slotsFor(doc);
        slotsWrap.innerHTML = slotList.map(t => `
          <button type="button" class="opd-slot-btn${state.slot === t ? ' selected' : ''}" data-opd-slot="${t}">${t}</button>`).join('');
        slotsWrap.querySelectorAll('[data-opd-slot]').forEach(btn => {
          btn.addEventListener('click', () => { state.slot = btn.getAttribute('data-opd-slot'); renderBooking(); });
        });
        scheduleEl.querySelector('[data-opd-cap-note]').textContent = 'Maximum ' + doc.max + ' pacienți / sesiune · disponibilitatea se confirmă cu echipa Medicross';
      } else {
        scheduleEl.style.display = 'none';
      }
    }
    if (helpEl) helpEl.style.display = help ? '' : 'none';

    const chosenDate = doc && dList[state.dateIdx];
    const dateStr = chosenDate ? DOW[chosenDate.getDay()] + ', ' + chosenDate.getDate() + ' ' + MON[chosenDate.getMonth()] + ' ' + chosenDate.getFullYear() : '';
    let summary = '';
    if (doc) summary = doc.name + ' · ' + dateStr + (state.slot ? ' · ora ' + state.slot : '');
    else if (help) summary = 'Un consultant îți recomandă medicul potrivit și îți propune o oră.';
    if (summaryEl) {
      summaryEl.classList.toggle('show', !!summary);
      const span = summaryEl.querySelector('span:last-child');
      if (span) span.textContent = summary;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(state.email.trim());
    const progress = [!!state.doc, !!(help || (doc && chosenDate)), !!(help || state.slot), !!(state.name.trim() && state.phone.trim() && emailOk)].filter(Boolean).length;
    if (barsEl) Array.from(barsEl.children).forEach((b, i) => b.classList.toggle('done', i < progress));
    if (progressChip) progressChip.textContent = progress + '/4';

    const ok = !!state.doc && state.name.trim().length > 1 && state.phone.replace(/\D/g, '').length >= 9 && emailOk;
    const lines = ['Bună ziua! Doresc o consultație GRATUITĂ OPD Medicross.'];
    if (doc) { lines.push('Medic: ' + doc.name + ' (' + doc.spec + ')'); lines.push('Data: ' + dateStr); if (state.slot) lines.push('Ora preferată: ' + state.slot); }
    if (help) lines.push('Medic: am nevoie de recomandare');
    if (state.name) lines.push('Nume: ' + state.name);
    if (state.phone) lines.push('Telefon: ' + state.phone);
    if (state.email) lines.push('Email: ' + state.email);
    if (state.note) lines.push('Aș dori să discut: ' + state.note);
    const waHref = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(lines.join('\n'));

    let errorText = '';
    if (!state.doc) errorText = 'Alege mai întâi un medic (sau „Ajutați-mă să aleg").';
    else if (state.name.trim().length < 2) errorText = 'Completează numele.';
    else if (state.phone.replace(/\D/g, '').length < 9) errorText = 'Completează un număr de telefon valid.';
    else if (!emailOk) errorText = 'Completează o adresă de email validă.';

    if (submitLink) {
      submitLink.setAttribute('href', waHref);
      submitLink.classList.toggle('ready', ok);
    }
    if (errorEl) {
      errorEl.classList.toggle('show', state.tried && !ok);
      errorEl.textContent = errorText;
    }
    if (nameInput) nameInput.classList.toggle('err', state.tried && state.name.trim().length < 2);
    if (phoneInput) phoneInput.classList.toggle('err', state.tried && state.phone.replace(/\D/g, '').length < 9);
    if (emailInput) emailInput.classList.toggle('err', state.tried && !emailOk);

    return { ok };
  }

  if (nameInput) nameInput.addEventListener('input', e => { state.name = e.target.value; renderBooking(); });
  if (phoneInput) phoneInput.addEventListener('input', e => { state.phone = e.target.value; renderBooking(); });
  if (emailInput) emailInput.addEventListener('input', e => { state.email = e.target.value; renderBooking(); });
  if (noteInput) noteInput.addEventListener('input', e => { state.note = e.target.value; });

  if (submitLink) {
    submitLink.addEventListener('click', e => {
      const { ok } = renderBooking();
      if (!ok) { e.preventDefault(); state.tried = true; renderBooking(); return; }
      track('generate_lead', { doctor_id: state.doc });
    });
  }


  if (emailSubmit) emailSubmit.addEventListener('click', async () => {
    if (sendingEmail) return;
    state.tried = true;
    const { ok } = renderBooking();
    const doc = DOCS.find(d => d.id === state.doc);
    if (!ok || (doc && !state.slot)) {
      if (sendStatus) sendStatus.textContent = doc && !state.slot ? 'Selectează mai întâi ora preferată.' : 'Completează câmpurile obligatorii.';
      return;
    }
    const dates = doc ? datesFor(doc) : [];
    const picked = doc ? dates[state.dateIdx] : null;
    const date = picked ? [picked.getFullYear(), String(picked.getMonth() + 1).padStart(2, '0'), String(picked.getDate()).padStart(2, '0')].join('-') : '';
    sendingEmail = true;
    emailSubmit.disabled = true;
    emailSubmit.textContent = 'Se trimite solicitarea...';
    if (sendStatus) sendStatus.textContent = '';
    try {
      const response = await fetch('https://platforma.tratamente-turcia.ro/api/opd-consultatii', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorId: state.doc, date, time: state.slot || '',
          name: state.name.trim(), phone: state.phone.trim(),
          email: state.email.trim(), note: state.note.trim(), website: '',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Eroare de trimitere.');
      if (sendStatus) sendStatus.textContent = 'Solicitarea a fost transmisă. Echipa Medicross te va contacta pentru confirmare.';
      emailSubmit.textContent = 'Solicitare transmisă';
      track('generate_lead', { doctor_id: state.doc });
    } catch (err) {
      if (sendStatus) sendStatus.textContent = err.message || 'Trimiterea a eșuat. Încearcă din nou sau folosește WhatsApp.';
      emailSubmit.disabled = false;
      emailSubmit.textContent = 'Trimite solicitarea';
    } finally {
      sendingEmail = false;
    }
  });

  // ---- doctors grid "book" buttons ----
  document.querySelectorAll('[data-opd-book]').forEach(btn => {
    btn.addEventListener('click', () => bookFromCard(btn.getAttribute('data-opd-book')));
  });

  // ---- contact-click tracking (phone / sticky WhatsApp) ----
  document.querySelectorAll('[data-opd-contact-track]').forEach(a => {
    a.addEventListener('click', () => track('contact'));
  });

  renderBooking();
  syncActive();
  syncSticky();
})();
