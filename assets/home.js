// Medicross homepage interactions
document.documentElement.classList.add('js');

// The header (mobile menu, dropdowns) is owned by assets/header.js — shared by every page.

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
      el.style.transform = `translateY(${y * f * -0.4}px)`;
    });
    ticking = false;
  });
}
window.addEventListener('scroll', onScroll, { passive: true });

// ---- hero aura: the fan of red shadows blooms on scroll and on hover ----
(() => {
  const zone = document.getElementById('heroRight');
  const aura = document.getElementById('heroAura');
  if (!zone || !aura) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The petals open as the hero scrolls past and again when the card is
     hovered; whichever is stronger wins, so the two never fight each other. */
  let scrollBloom = 0, hoverBloom = 0, bloomRaf = null;
  const applyBloom = () => {
    bloomRaf = null;
    aura.style.setProperty('--bloom', Math.max(scrollBloom, hoverBloom).toFixed(3));
  };
  const queueBloom = () => { if (!bloomRaf) bloomRaf = requestAnimationFrame(applyBloom); };

  if (!still) {
    const onBloomScroll = () => {
      const r = zone.getBoundingClientRect();
      // 0 while the hero sits at the top of the viewport, 1 once it has
      // travelled roughly its own height upward
      const travelled = Math.max(0, -r.top + window.innerHeight * 0.18);
      scrollBloom = Math.max(0, Math.min(1, travelled / (r.height * 0.85 || 1)));
      queueBloom();
    };
    window.addEventListener('scroll', onBloomScroll, { passive: true });
    window.addEventListener('resize', onBloomScroll);
    onBloomScroll();

    zone.addEventListener('pointerenter', () => { hoverBloom = 0.8; queueBloom(); });
    zone.addEventListener('pointerleave', () => { hoverBloom = 0; queueBloom(); });
    zone.addEventListener('focusin', () => { hoverBloom = 0.8; queueBloom(); });
    zone.addEventListener('focusout', () => { hoverBloom = 0; queueBloom(); });
  }

  // skip pointer tracking on touch: there is no hover, and it would only cost battery
  if (still || !window.matchMedia('(hover: hover)').matches) return;

  let raf = null;
  const idle = () => {
    aura.style.setProperty('--gx', '0px');
    aura.style.setProperty('--gy', '0px');
    aura.style.setProperty('--tilt', '0deg');
    aura.style.setProperty('--open', '1');
    aura.style.setProperty('--len', '1');
  };

  zone.addEventListener('pointermove', ev => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const r = zone.getBoundingClientRect();
      // -1 .. 1 from the centre of the card area
      const nx = Math.max(-1, Math.min(1, ((ev.clientX - r.left) / r.width - 0.5) * 2));
      const ny = Math.max(-1, Math.min(1, ((ev.clientY - r.top) / r.height - 0.5) * 2));
      aura.style.setProperty('--gx', (nx * 26).toFixed(1) + 'px');
      aura.style.setProperty('--gy', (ny * 16).toFixed(1) + 'px');
      aura.style.setProperty('--tilt', (nx * 7).toFixed(2) + 'deg');
      // the fan opens wider and the blades stretch as the pointer rises
      aura.style.setProperty('--open', (1.14 - ny * 0.12).toFixed(3));
      aura.style.setProperty('--len', (1.06 - ny * 0.08).toFixed(3));
    });
  }, { passive: true });

  zone.addEventListener('pointerleave', () => {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    idle();
  });
  idle();
})();
