// Records a form submission on the Medicross platform (database + Google Sheet)
// right before the visitor is handed over to WhatsApp, so the enquiry exists even
// if the WhatsApp message is never sent. Fire-and-forget: it can never block or
// delay the WhatsApp handoff, and a failure is silent.
(function () {
  if (window.MedicrossLead) return;
  var ENDPOINT = 'https://platforma.tratamente-turcia.ro/api/leads';
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'];
  var STORE = 'lp_tracking'; // same key the offer pages already use

  var stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(STORE) || '{}'); } catch (e) {}
  var params = new URLSearchParams(location.search), changed = false;
  KEYS.forEach(function (k) { var v = params.get(k); if (v) { stored[k] = v; changed = true; } });
  if (changed) { try { sessionStorage.setItem(STORE, JSON.stringify(stored)); } catch (e) {} }

  function campaign() {
    return KEYS.filter(function (k) { return stored[k]; })
      .map(function (k) { return k + '=' + stored[k]; }).join('&');
  }

  window.MedicrossLead = {
    send: function (lead) {
      try {
        lead = lead || {};
        var phone = String(lead.phone || '').trim(), email = String(lead.email || '').trim();
        if (!phone && !email) return;
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          keepalive: true,
          body: JSON.stringify({
            name: lead.name || '', phone: phone, email: email,
            procedure: lead.procedure || '', message: lead.message || '',
            sourcePage: location.origin + location.pathname,
            formType: lead.formType || '', campaign: campaign(),
            marketingConsent: lead.marketingConsent === true, website: ''
          })
        }).catch(function () {});
      } catch (e) {}
    }
  };
})();
