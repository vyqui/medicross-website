// Medicross homepage interactions
document.documentElement.classList.add('js');

// ---- mobile nav ----
const burger = document.getElementById('burger');
const mnav = document.getElementById('mnav');
if (burger) {
  burger.addEventListener('click', () => {
    const open = mnav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  mnav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mnav.classList.remove('open')));
}

// ---- hero operation switcher ----
const OPS = [
  { title: 'Rinoplastie',    img: 'materials/images/rinoplastrie-tratamente-turcia.png' },
  { title: 'Gastric Sleeve', img: 'materials/images/gastric-sleeve-tratamente-turcia-3.png' },
  { title: 'BBL',            img: 'materials/images/lifting-mamar-tratamente-turcia.png' },
  { title: 'Mommy Makeover', img: 'materials/images/tot-ce-trebuie-sa-stii-despre-abdominoplastie.png' },
];
const lcImg = document.getElementById('lcImg');
const lcTitle = document.getElementById('lcTitle');
const chips = Array.from(document.querySelectorAll('.lc-chip'));
let currentOp = 0, autoPaused = false;

function setOp(i) {
  currentOp = i;
  const op = OPS[i];
  lcImg.style.opacity = '0';
  setTimeout(() => { lcImg.src = op.img; lcImg.alt = op.title; lcImg.style.opacity = '1'; }, 160);
  lcTitle.textContent = op.title;
  chips.forEach((c, idx) => c.classList.toggle('active', idx === i));
}
chips.forEach(c => c.addEventListener('click', () => { autoPaused = true; setOp(+c.dataset.op); }));
['input', 'focusin'].forEach(ev => {
  const card = document.getElementById('leadCard');
  if (card) card.addEventListener(ev, () => { autoPaused = true; }, { once: true });
});
setInterval(() => { if (!autoPaused) setOp((currentOp + 1) % OPS.length); }, 4000);

// ---- lead form -> WhatsApp ----
const leadCard = document.getElementById('leadCard');
if (leadCard) {
  leadCard.addEventListener('submit', e => {
    e.preventDefault();
    const name = (document.getElementById('lcName').value || '').trim();
    const phone = (document.getElementById('lcPhone').value || '').trim();
    const lines = [
      'Bună ziua! Doresc o opinie medicală gratuită.',
      'Nume: ' + (name || '-'),
      'Telefon: ' + (phone || '-'),
      'Intervenție: ' + OPS[currentOp].title,
    ];
    window.open('https://wa.me/40746992222?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  });
}

// ---- 3D tilt on the lead card (desktop pointer only) ----
if (leadCard && window.matchMedia('(pointer:fine)').matches) {
  const wrap = leadCard.parentElement; // .hero-right
  wrap.style.perspective = '1000px';
  leadCard.addEventListener('mousemove', e => {
    const r = leadCard.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    leadCard.style.transform = `rotateY(${px * 9}deg) rotateX(${-py * 9}deg) translateY(-4px)`;
  });
  leadCard.addEventListener('mouseleave', () => { leadCard.style.transform = ''; });
}

// ---- scroll reveals ----
const revEls = document.querySelectorAll('.reveal');
const revObs = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      const delay = Math.min(i * 60, 350);
      setTimeout(() => e.target.classList.add('in'), delay);
      revObs.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });
revEls.forEach(el => revObs.observe(el));

// ---- count-up stats ----
const statObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.querySelectorAll('[data-count]').forEach(el => {
      const target = +el.dataset.count, suffix = el.dataset.suffix || '';
      const dur = 1500, t0 = performance.now();
      function tick(now) {
        const p = Math.min((now - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    statObs.unobserve(e.target);
  });
}, { threshold: 0.3 });
const statsSec = document.getElementById('stats');
if (statsSec) statObs.observe(statsSec);

// ---- scroll parallax ----
const plx = Array.from(document.querySelectorAll('[data-parallax]'));
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    plx.forEach(el => {
      const f = parseFloat(el.dataset.parallax) || 0;
      el.style.transform = (el.classList.contains('hero-panel') ? 'rotate(4deg) ' : '') + `translateY(${y * f * -0.4}px)`;
    });
    ticking = false;
  });
}
window.addEventListener('scroll', onScroll, { passive: true });
