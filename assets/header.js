/* Medicross — shared site header: mobile menu + accordion groups.
 * Progressive enhancement: without JS the desktop nav still works
 * (dropdowns are CSS hover/focus driven); only the mobile panel needs this.
 */
(function () {
  'use strict';

  var burger = document.getElementById('mhBurger');
  var panel = document.getElementById('mhMobile');

  if (burger && panel) {
    burger.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      burger.setAttribute('aria-expanded', String(open));
    });
  }

  // mobile accordion groups
  document.querySelectorAll('.mh-group > button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var items = btn.nextElementSibling;
      if (!items) return;
      var open = items.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  // close the mobile panel when navigating to an in-page anchor
  if (panel) {
    panel.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && a.getAttribute('href') && a.getAttribute('href').charAt(0) === '#') {
        panel.classList.remove('open');
        if (burger) burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // mark the current page in the nav
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.mh a[href]').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href === here) a.classList.add('current');
  });
})();
