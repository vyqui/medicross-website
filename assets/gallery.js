/* Medicross — partner gallery carousel + fullscreen lightbox.
 * Progressive enhancement: without JS the carousel is still a scrollable
 * strip of images and each item links to the full-size photo. */
(function () {
  'use strict';

  var carousels = Array.prototype.slice.call(document.querySelectorAll('.gallery-carousel'));
  if (!carousels.length) return;

  /* ---------------- one shared lightbox ---------------- */
  var lb = document.createElement('div');
  lb.className = 'glb';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Galerie foto');
  lb.innerHTML =
    '<button class="glb-btn glb-close" type="button" aria-label="Închide galeria">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
    '<button class="glb-btn glb-prev" type="button" aria-label="Fotografia anterioară">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
    '<button class="glb-btn glb-next" type="button" aria-label="Fotografia următoare">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg></button>' +
    '<figure class="glb-figure"><img alt="" /><figcaption class="glb-cap"></figcaption></figure>';
  document.body.appendChild(lb);

  var lbImg = lb.querySelector('img');
  var lbCap = lb.querySelector('.glb-cap');
  var group = [];      // [{src, alt}]
  var index = 0;
  var opener = null;   // element to restore focus to

  function show(i) {
    if (!group.length) return;
    index = (i + group.length) % group.length;
    var item = group[index];
    lbImg.src = item.src;
    lbImg.alt = item.alt || '';
    lbCap.textContent = (item.alt ? item.alt + ' · ' : '') + (index + 1) + ' / ' + group.length;
    var single = group.length < 2;
    lb.querySelector('.glb-prev').hidden = single;
    lb.querySelector('.glb-next').hidden = single;
  }

  function open(items, i, from) {
    group = items;
    opener = from || null;
    show(i);
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    lb.querySelector('.glb-close').focus();
  }

  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    lbImg.src = '';
    if (opener) { opener.focus(); opener = null; }
  }

  lb.querySelector('.glb-close').addEventListener('click', close);
  lb.querySelector('.glb-prev').addEventListener('click', function () { show(index - 1); });
  lb.querySelector('.glb-next').addEventListener('click', function () { show(index + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) close(); });

  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowLeft') { show(index - 1); }
    else if (e.key === 'ArrowRight') { show(index + 1); }
    else if (e.key === 'Tab') {
      // keep focus inside the dialog
      var f = Array.prototype.filter.call(
        lb.querySelectorAll('button'), function (b) { return !b.hidden; });
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // swipe on touch
  var tx = 0;
  lb.addEventListener('touchstart', function (e) { tx = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 45) show(index + (dx < 0 ? 1 : -1));
  }, { passive: true });

  /* ---------------- each carousel ---------------- */
  carousels.forEach(function (car) {
    var track = car.querySelector('.gc-track');
    var items = Array.prototype.slice.call(track.querySelectorAll('.gc-item'));
    if (!items.length) return;

    var data = items.map(function (el) {
      return { src: el.dataset.full || el.querySelector('img').src, alt: el.querySelector('img').alt };
    });

    items.forEach(function (el, i) {
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        open(data, i, el);
      });
    });

    var prev = car.querySelector('.gc-nav.prev');
    var next = car.querySelector('.gc-nav.next');
    function step() { return Math.max(track.clientWidth * 0.8, 260); }
    if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });

    function sync() {
      if (!prev || !next) return;
      var max = track.scrollWidth - track.clientWidth - 2;
      prev.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= max;
    }
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });
})();
