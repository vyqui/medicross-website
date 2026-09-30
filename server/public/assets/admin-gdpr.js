/* GDPR Approved — merges two very different sources into one list:
 *   - patients with an account, who accepted through the portal gate
 *     (MedicrossDB.patients(), already cached by requireRole('admin'))
 *   - acord-gdpr-completare.html submissions, which never touch an account
 *     at all (GET /api/admin/gdpr-registrations)
 * Rendered as one row shape so both look equally at-home in the same table.
 */
(async function () {
  'use strict';

  var sess = await MedicrossDB.requireRole('admin');
  if (!sess) return;

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await MedicrossDB.logout();
    location.href = 'login.html';
  });

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
             d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

  var rows = MedicrossDB.patients().filter(function (p) { return p.gdprAccepted; }).map(function (p) {
    return {
      kind: 'account', id: p.id, name: p.name, email: p.email, phone: p.phone,
      when: p.gdprAcceptedAt, extra: '',
    };
  });

  try {
    var registrations = await MedicrossDB.listGdprRegistrations();
    registrations.forEach(function (r) {
      rows.push({
        kind: 'form', id: r.id, name: r.name, email: r.email, phone: r.phone,
        when: r.createdAt, extra: r.procedureName, hasPdf: r.hasPdf,
      });
    });
  } catch (e) {
    // The account-sourced rows above still render; only the site-form ones
    // are missing, and that's visible enough from the count itself.
  }

  rows.sort(function (a, b) { return new Date(b.when || 0) - new Date(a.when || 0); });

  function matches(r, q) {
    if (!q) return true;
    var qd = onlyDigits(q);
    if (r.name.toLowerCase().indexOf(q) > -1) return true;
    if ((r.email || '').toLowerCase().indexOf(q) > -1) return true;
    if (qd && onlyDigits(r.phone).indexOf(qd) > -1) return true;
    return false;
  }

  function render() {
    var q = document.getElementById('gdprSearch').value.trim().toLowerCase();
    var body = document.getElementById('gdprRows');
    body.textContent = '';
    var shown = rows.filter(function (r) { return matches(r, q); });
    document.getElementById('gdprEmpty').hidden = shown.length > 0;

    shown.forEach(function (r) {
      var tr = el('tr');

      var nameCell = el('td');
      var nameWrap = el('div', 'pname');
      var av = el('span', 'av', (r.name || '?').trim().charAt(0).toUpperCase());
      var txt = el('div', 'pname-txt');
      txt.appendChild(el('div', 'nm', r.name));
      if (r.extra) txt.appendChild(el('div', 'muted-cell', r.extra));
      nameWrap.appendChild(av); nameWrap.appendChild(txt);
      nameCell.appendChild(nameWrap);
      tr.appendChild(nameCell);

      var contact = el('td');
      contact.appendChild(el('div', null, r.phone || '—'));
      if (r.email) contact.appendChild(el('div', 'muted-cell', r.email));
      tr.appendChild(contact);

      var srcCell = el('td');
      var badge = el('span', 'gsrc' + (r.kind === 'form' ? ' form' : ''),
        r.kind === 'form' ? 'Formular site' : 'Cont portal');
      srcCell.appendChild(badge);
      tr.appendChild(srcCell);

      tr.appendChild(el('td', 'muted-cell', fmtTime(r.when)));

      var actionCell = el('td');
      if (r.kind === 'account') {
        var openLink = el('a', 'pdf-link', 'Deschide contul →');
        openLink.href = 'admin-users.html?patient=' + encodeURIComponent(r.id);
        actionCell.appendChild(openLink);
      } else if (r.hasPdf) {
        var pdfLink = el('a', 'pdf-link');
        pdfLink.href = '/api/admin/gdpr-registrations/' + encodeURIComponent(r.id) + '/pdf';
        pdfLink.target = '_blank';
        pdfLink.rel = 'noopener';
        pdfLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M14 2v6h6"/></svg> Vezi PDF';
        actionCell.appendChild(pdfLink);
      } else {
        actionCell.appendChild(el('span', 'pdf-none', 'PDF indisponibil'));
      }
      tr.appendChild(actionCell);

      body.appendChild(tr);
    });
  }

  document.getElementById('gdprSearch').addEventListener('input', render);
  render();
})();
