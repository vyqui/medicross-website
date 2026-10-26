// oferta-rinoplastie-311226.html — offer config, countdown, before/after sliders, lead form.
// No framework, no build step — same approach as assets/landing.js.
(function () {
  window.dataLayer = window.dataLayer || [];
  var body = document.body;

  // ---------- offer config (price + end date live as attributes on <body>) ----------
  var PRICE = (body.getAttribute('data-offer-price') || '2.600') + ' €';
  var END = new Date(body.getAttribute('data-offer-end') || '').getTime();
  var END_LABEL = body.getAttribute('data-offer-end-label') || '';
  var END_SHORT = body.getAttribute('data-offer-end-short') || '';
  var BASE_WA = 'https://wa.me/40746992222?text=';

  function setAll(sel, text) {
    document.querySelectorAll(sel).forEach(function (el) { el.textContent = text; });
  }
  setAll('[data-o-price]', PRICE);
  if (END_LABEL) setAll('[data-o-end]', END_LABEL);
  if (END_SHORT) setAll('[data-o-end-short]', END_SHORT);

  var expired = false;
  function applyOfferState() {
    expired = !isNaN(END) && Date.now() > END;
    document.querySelectorAll('[data-o-live]').forEach(function (el) { el.hidden = expired; });
    document.querySelectorAll('[data-o-expired]').forEach(function (el) { el.hidden = !expired; });
  }

  // ---------- countdown ----------
  var cd = document.querySelector('[data-countdown]');
  function tick() {
    applyOfferState();
    if (!cd || expired) return;
    var diff = Math.max(0, END - Date.now());
    cd.querySelector('[data-cd-d]').textContent = Math.floor(diff / 864e5);
    cd.querySelector('[data-cd-h]').textContent = Math.floor(diff / 36e5) % 24;
    cd.querySelector('[data-cd-m]').textContent = Math.floor(diff / 6e4) % 60;
  }
  tick();
  setInterval(tick, 30000);

  // ---------- ad click-ids travel with the lead ----------
  var TRACKED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  var params = new URLSearchParams(location.search), stored = {};
  try { stored = JSON.parse(sessionStorage.getItem('lp_tracking') || '{}'); } catch (e) {}
  TRACKED.forEach(function (k) { var v = params.get(k); if (v) stored[k] = v; });
  try { sessionStorage.setItem('lp_tracking', JSON.stringify(stored)); } catch (e) {}
  function trackingSummary() {
    return TRACKED.filter(function (k) { return stored[k]; }).map(function (k) { return k + '=' + stored[k]; }).join('&');
  }

  function track(event, method) {
    var payload = { event: event, lead_method: method };
    TRACKED.forEach(function (k) { if (stored[k]) payload[k] = stored[k]; });
    window.dataLayer.push(payload);
    if (typeof window.gtag === 'function') {
      window.gtag('event', event === 'generate_lead' ? 'generate_lead' : 'contact', { method: method });
    }
    if (typeof window.fbq === 'function') window.fbq('track', event === 'generate_lead' ? 'Lead' : 'Contact');
  }
  window.dataLayer.push({ event: 'view_content', content_name: 'oferta-rinoplastie-311226' });
  if (typeof window.fbq === 'function') window.fbq('track', 'ViewContent');

  // ---------- WhatsApp links ----------
  function waMessage(extra) {
    var lines = [expired
      ? 'Bună ziua! Sunt interesat(ă) de rinoplastie all-inclusive și aș dori prețul și datele disponibile.'
      : 'Bună ziua! Sunt interesat(ă) de oferta de rinoplastie all-inclusive la ' + PRICE + '.'];
    if (extra && extra.name) lines.push('Nume: ' + extra.name);
    if (extra && extra.when) lines.push('Perioada dorită: ' + extra.when);
    var t = trackingSummary();
    if (t) lines.push('(' + t + ')');
    return lines.join('\n');
  }
  function refreshWa(extra) {
    var href = BASE_WA + encodeURIComponent(waMessage(extra));
    document.querySelectorAll('[data-wa]').forEach(function (a) {
      if (extra && !a.hasAttribute('data-wa-sent')) return;
      a.setAttribute('href', href);
    });
  }
  refreshWa();
  document.querySelectorAll('[data-wa-track]').forEach(function (a) {
    a.addEventListener('click', function () { track('contact', 'whatsapp'); });
  });

  // ---------- before / after sliders (pointer + keyboard) ----------
  document.querySelectorAll('[data-ba]').forEach(function (box) {
    var before = box.querySelector('[data-ba-before]'), line = box.querySelector('[data-ba-line]');
    var dragging = false;
    function setPct(p) {
      p = Math.max(4, Math.min(96, p));
      before.style.clipPath = 'inset(0 ' + (100 - p) + '% 0 0)';
      line.style.left = p + '%';
      box.setAttribute('aria-valuenow', Math.round(p));
    }
    function setX(x) {
      var r = box.getBoundingClientRect();
      setPct(((x - r.left) / r.width) * 100);
    }
    box.addEventListener('pointerdown', function (e) { dragging = true; setX(e.clientX); });
    window.addEventListener('pointermove', function (e) { if (dragging) setX(e.clientX); });
    window.addEventListener('pointerup', function () { dragging = false; });
    window.addEventListener('pointercancel', function () { dragging = false; });
    box.addEventListener('keydown', function (e) {
      var cur = parseFloat(box.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setPct(cur - 5); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setPct(cur + 5); e.preventDefault(); }
      else if (e.key === 'Home') { setPct(4); e.preventDefault(); }
      else if (e.key === 'End') { setPct(96); e.preventDefault(); }
    });
  });

  // ---------- lead form ----------
  var form = document.querySelector('[data-rn-form]');
  if (form) {
    var errEl = form.querySelector('[data-rn-error]');
    var consentLabel = form.querySelector('[data-rn-consent-label]');
    var fieldsBox = form.querySelector('[data-rn-fields]');
    var sentBox = document.querySelector('[data-rn-sent]');
    var btn = form.querySelector('button[type=submit]');

    function mark(el, bad) { if (el) el.classList.toggle('err', !!bad); }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = form.elements;
      if (f.website.value) return; // honeypot: bots fill it, people never see it

      var name = f.nume.value.trim(), phone = f.telefon.value.trim(), email = f.email.value.trim();
      var nameOk = name.length > 1;
      var phoneOk = phone.replace(/\D/g, '').length >= 9;
      var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
      var consentOk = f.consent.checked;
      mark(f.nume, !nameOk); mark(f.telefon, !phoneOk); mark(f.email, !emailOk);
      consentLabel.classList.toggle('err', !consentOk);

      var msg = '';
      if (!nameOk) msg = 'Completează numele.';
      else if (!phoneOk) msg = 'Completează un număr de telefon valid.';
      else if (!emailOk) msg = 'Completează o adresă de email validă.';
      else if (!consentOk) msg = 'Bifează acordul pentru a trimite cererea.';
      errEl.hidden = !msg;
      errEl.textContent = msg;
      if (msg) return;

      var when = f.perioada.value;
      btn.disabled = true;
      track('generate_lead', 'form');
      if (window.MedicrossLead) {
        window.MedicrossLead.send({
          name: name, phone: phone, email: email,
          procedure: 'Rinoplastie ' + PRICE + ' all-inclusive',
          message: [when ? 'Perioada dorită: ' + when : '', 'Acord prelucrare date: ' + new Date().toISOString(), 'Pagina: ' + location.href].filter(Boolean).join(' | '),
          marketingConsent: false,
          formType: 'oferta:oferta-rinoplastie-311226'
        });
      }
      sentBox.querySelector('[data-rn-first]').textContent = name.split(/\s+/)[0];
      refreshWa({ name: name, when: when });
      fieldsBox.hidden = true;
      sentBox.hidden = false;
      form.reset();
    });
  }
})();
