// Shared behaviour for standalone ad landing pages (oferta-*.html).
// No framework, no build step — same approach as assets/site.js.

(function () {
  window.dataLayer = window.dataLayer || [];

  // ---- capture ad click-ids so they travel with the lead ----
  var params = new URLSearchParams(location.search);
  var TRACKED = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  var stored = {};
  try { stored = JSON.parse(sessionStorage.getItem('lp_tracking') || '{}'); } catch (e) {}
  var changed = false;
  TRACKED.forEach(function (key) {
    var val = params.get(key);
    if (val) { stored[key] = val; changed = true; }
  });
  if (changed) {
    try { sessionStorage.setItem('lp_tracking', JSON.stringify(stored)); } catch (e) {}
  }

  function trackingSummary() {
    var parts = TRACKED.filter(function (k) { return stored[k]; })
      .map(function (k) { return k + '=' + stored[k]; });
    return parts.join('&');
  }

  function fireLead(method) {
    window.dataLayer.push({ event: 'generate_lead', lead_method: method, ...stored });
    if (typeof window.gtag === 'function') {
      window.gtag('event', method === 'whatsapp' ? 'contact' : 'generate_lead', { method: method });
    }
  }

  // ---- build WhatsApp links from a plain-text message (hero CTA, bottom band, sticky bar) ----
  document.querySelectorAll('[data-wa-msg]').forEach(function (a) {
    var number = a.getAttribute('data-wa-number') || '40746992222';
    var msg = a.getAttribute('data-wa-msg');
    var tracking = trackingSummary();
    if (tracking) msg += ' (' + tracking + ')';
    a.setAttribute('href', 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg));
  });
  document.querySelectorAll('[data-wa-track]').forEach(function (a) {
    a.addEventListener('click', function () { fireLead('whatsapp'); });
  });

  // ---- lead form → WhatsApp handoff (same pattern as the main site) ----
  var form = document.querySelector('[data-lp-form]');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var status = form.querySelector('[data-lp-status]');
      var setStatus = function (cls, text) {
        if (!status) return;
        status.className = 'lp-form-status ' + cls;
        status.textContent = text;
      };

      var data = Object.fromEntries(new FormData(form).entries());

      // honeypot: a hidden field a bot fills in, a human never sees
      if (data.website) return;

      if (!data.nume || !data.telefon) {
        setStatus('err', 'Te rugăm completează numele și telefonul.');
        return;
      }
      var consent = form.querySelector('[data-lp-consent]');
      if (consent && !consent.checked) {
        setStatus('err', 'Te rugăm bifează acordul pentru a fi contactat(ă).');
        return;
      }

      var waNumber = form.getAttribute('data-wa-number') || '40746992222';
      var service = form.getAttribute('data-service') || '';
      var lines = [
        'Bună ziua! Vreau detalii despre oferta ' + service + '.',
        'Nume: ' + data.nume,
        'Telefon: ' + data.telefon,
        ...(data.email ? ['Email: ' + data.email] : []),
      ];
      if (data.f1label && data.f1) lines.push(data.f1label + ': ' + data.f1);
      if (data.f2label && data.f2) lines.push(data.f2label + ': ' + data.f2);
      if (data.mesaj) lines.push('Mesaj: ' + data.mesaj);
      var tracking = trackingSummary();
      if (tracking) lines.push('(' + tracking + ')');

      fireLead('form');
      setStatus('ok', 'Mulțumim! Se deschide WhatsApp — trimite mesajul pre-completat ca să ajungă direct la echipa noastră.');
      window.open('https://wa.me/' + waNumber + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
      form.reset();
    });
  }
})();
