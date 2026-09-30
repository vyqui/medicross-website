/* Admin hub — just the three counts on the landing cards. Everything else on
 * this page is a plain link; the actual work happens on the pages it links
 * to (admin-users.html, admin-gdpr.html). */
(async function () {
  'use strict';

  var sess = await MedicrossDB.requireRole('admin');
  if (!sess) return;

  document.getElementById('logoutBtn').addEventListener('click', async function () {
    await MedicrossDB.logout();
    location.href = 'login.html';
  });

  var patients = MedicrossDB.patients();
  document.getElementById('countUsers').textContent =
    patients.length + (patients.length === 1 ? ' pacient' : ' pacienți');

  var gdprFromAccounts = patients.filter(function (p) { return p.gdprAccepted; }).length;
  var registrations = [];
  try {
    registrations = await MedicrossDB.listGdprRegistrations();
  } catch (e) { /* the count below just won't include the site-form submissions */ }

  var total = gdprFromAccounts + registrations.length;
  document.getElementById('countGdpr').textContent =
    total + (total === 1 ? ' acord' : ' acorduri');
})();
