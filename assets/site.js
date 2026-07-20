// Sticky header shadow
const header = document.getElementById('header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

// Mobile nav
const burger = document.getElementById('burger');
const mobileNav = document.getElementById('mobileNav');
burger.addEventListener('click', () => {
  const open = mobileNav.classList.toggle('open');
  burger.setAttribute('aria-expanded', open);
});
mobileNav.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => mobileNav.classList.remove('open'))
);

// Mobile nav groups (Chirurgie Estetică / Bariatrică)
document.querySelectorAll('.mobile-group-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.parentElement;
    const open = group.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });
});

// FAQ accordion
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.parentElement;
    const answer = item.querySelector('.faq-a');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(o => {
      o.classList.remove('open');
      o.querySelector('.faq-a').style.maxHeight = null;
      o.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      item.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});

// Scroll reveal
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Forms → WhatsApp handoff
function toWhatsApp(fields) {
  const lines = [
    'Bună ziua! Doresc o evaluare gratuită.',
    'Nume: ' + (fields.nume || '-'),
    'Telefon: ' + (fields.telefon || '-'),
    fields.email ? 'E-mail: ' + fields.email : null,
    'Specialitate: ' + (fields.specialitate || '-'),
    fields.mesaj ? 'Mesaj: ' + fields.mesaj : null
  ].filter(Boolean);
  window.open('https://wa.me/40746992222?text=' + encodeURIComponent(lines.join('\n')), '_blank');
}
['heroForm', 'contactForm'].forEach(id => {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    toWhatsApp(data);
  });
});
