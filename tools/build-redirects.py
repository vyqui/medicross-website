#!/usr/bin/env python3
"""Builds the WordPress -> static redirect map for the domain cutover."""
import glob, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORTAL = 'https://cont.tratamente-turcia.ro/login'
NEEDS_PAGE = '@@NEEDS_PAGE@@'

local = {os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ROOT, '*.html'))}

OVERRIDES = {
    '/home/': '/', '/404-2/': '/', '/misiunea-noastra/': '/despre',
    '/informatii/': '/specialitati', '/interventii/': '/specialitati',
    '/interventii-populare/': '/oferte', '/interventii-estetice/': '/chirurgie-estetica',
    '/chirurgie-plastica-estetica/': '/chirurgie-estetica',
    '/brazilian-butt-lift-bbl/': '/brazilian-butt-lift',
    '/tarife/': '/contact', '/poze-pacienti/': '/testimoniale',
    '/bht-tema/': '/parteneri', '/future-health-project/': '/despre',
    # WordPress "-2" duplicate slugs
    '/gastroenterologie-2/': '/gastroenterologie', '/neurologie-2/': '/neurologie',
    '/oftalmologie-2/': '/oftalmologie', '/oncologie-2/': '/oncologie',
    '/stomatologie-2/': '/stomatologie',
    # guides and one-off campaign pages
    '/ghidul-pacientului-de-gastric-sleeve/': '/gastric-sleeve',
    '/ghidul-pacientului-de-rinoplastie/': '/rinoplastie',
    '/rinoplastie-cu-dr-sahin-ulu/': '/rinoplastie',
    '/solutii-inovatoare-pentru-pierderea-in-greutate/': '/chirurgie-bariatrica',
    '/consult-gratuit-de-rinoplastie-in-romania-14-15-iunie/': '/rinoplastie',
    '/descopera-excelenta-in-rinoplastie-ploiesti-22-iunie/': '/rinoplastie',
    '/descopera-excelenta-in-rinoplastie-ploiesti-25-26-mai/': '/rinoplastie',
    '/2728-septembrie-dr-sahin-ulu-revine-in-romania-ploiesti/': '/rinoplastie',
    '/intalnire-cu-dr-prof-omer-avlanmis/': '/chirurgie-bariatrica',
    '/intalnire-cu-assoc-prof-dr-omer-avlanmis-29-iunie-ploiesti/': '/chirurgie-bariatrica',
    # existing client area -> the new platform subdomain
    '/client/': PORTAL, '/client/activare-card/': PORTAL,
    '/client/inregistrare/': PORTAL, '/devino-membru/': PORTAL,
    '/login/': PORTAL, '/my-account/': PORTAL, '/registration/': PORTAL,
    '/registrierung/': PORTAL,
    # /acord-gdpr/ now resolves by slug to the real page. The signed-copy URL
    # has no equivalent — online consent is a ticked box recorded with a
    # timestamp, not a stored per-person document — so it points at the
    # agreement itself.
    '/acord-gdpr-semnat/': '/acord-gdpr',
    # still only on WordPress
    '/politica-de-confidentialitate/': NEEDS_PAGE,
    # dormant WooCommerce install
    '/shop/': '/oferte', '/cart/': '/oferte', '/checkout/': '/contact',
    # other-language pages
    '/rhinoplasty/': '/rinoplastie', '/gastric-sleeve-surgery/': '/gastric-sleeve',
    '/thank-you/': '/', '/vielen-dank/': '/',
    # interventions custom post type
    '/interventii/implant-dentar/': '/stomatologie',
    '/interventii/stomatologie-hollywood-smile/': '/stomatologie',
    '/interventii/stomatologie-laminate-dentare/': '/stomatologie',
    '/interventii/implantul-de-o-zi/': '/stomatologie',
    '/interventii/implantul-all-on-4/': '/stomatologie',
    '/interventii/sistemul-port-acces/': '/chirurgie-vasculara',
    '/interventii/operatie-de-varice/': '/chirurgie-vasculara',
    '/interventii/transplant-de-rinichi/': '/transplant-de-organe-si-tesuturi',
    '/interventii/operatie-balon-gastric/': '/balon-gastric',
    '/interventii/operatie-de-micsorare-de-stomac-gastric-bypass/': '/gastric-bypass',
    '/interventii/operatie-de-micsorare-de-stomac-gastric-sleeve/': '/gastric-sleeve',
    '/interventii/implant-mamar/': '/interventii-mamare',
    # lead-generation posts with no topic page: the enquiry form is the point
    '/cum-sa-obtinem-concediu-medical-pentru-interventii-in-strainatate/': '/contact',
    '/ai-o-problema-medicala-vino-in-turcia-pentru-consult-gratuit/': '/contact',
    '/ai-asigurare-medicala-privata-beneficiaza-de-opinia-medicala-gratuita-oferita-de-tratamente-turcia/': '/contact',
}

# WordPress custom post types and archives, collapsed wholesale. These carry
# little search traffic individually but must not 404.
WILDCARDS = [
    ('/testimonial/*', '/testimoniale'),
    ('/success/*', '/testimoniale'),
    ('/partener/*', '/parteneri'),
    ('/echipa/*', '/despre'),
    ('/interventii/*', '/specialitati'),
    ('/tara/*', '/specialitati'),
    ('/category/*', '/blog'),
    ('/tag/*', '/blog'),
    ('/author/*', '/blog'),
    ('/wp-content/*', '/'),
    ('/wp-admin/*', '/'),
]

# Blog posts have no counterpart in the new site. Keyword -> closest landing
# page, so a visitor still arrives somewhere relevant instead of a 404.
TOPICS = [
    # Specific treatments first: a general keyword must never outrank a
    # named procedure that appears in the same slug. "de-disc" beats
    # "hernie" (a herniated disc is spinal), and is written with its
    # prefix because the bare "disc" also matches "indiscutabil".
    ('de-disc', '/neurochirurgie'),
    ('cyber-knife', '/oncologia-radiologica'), ('radioterapie', '/oncologia-radiologica'),
    ('rinoplastie', '/rinoplastie'), ('nas', '/rinoplastie'),
    ('abdominoplastie', '/abdominoplastie'), ('liposuc', '/liposuctie'),
    ('coapse', '/liposuctie'),
    ('gastric', '/chirurgie-bariatrica'), ('stomac', '/chirurgie-bariatrica'),
    ('obezita', '/chirurgie-bariatrica'), ('bariatric', '/chirurgie-bariatrica'),
    ('greutate', '/chirurgie-bariatrica'),
    # "san" must be hyphen-delimited: a bare substring also matches
    # "sanatate", "sanatoase" and "sangerare", which are unrelated.
    ('mamar', '/interventii-mamare'), ('-san-', '/interventii-mamare'),
    ('-sanilor', '/interventii-mamare'), ('silicoane', '/interventii-mamare'),
    ('transplant-de-par', '/transplant-de-par'), ('par-prin', '/transplant-de-par'),
    ('varice', '/chirurgie-vasculara'),
    ('fertiliz', '/fertilizare-in-vitro'), ('fiv', '/fertilizare-in-vitro'),
    ('embrion', '/fertilizare-in-vitro'), ('insarcinat', '/fertilizare-in-vitro'),
    ('dentar', '/stomatologie'),
    ('cancer', '/oncologie'), ('tumor', '/oncologie'), ('oncolog', '/oncologie'),
    ('cyber-knife', '/oncologia-radiologica'), ('radioterapie', '/oncologia-radiologica'),
    ('rinichi', '/nefrologie'), ('renal', '/nefrologie'),
    ('prostat', '/urologie'),
    ('cardiac', '/cardiologie'), ('aorto', '/cardiologie'),
    ('angina', '/cardiologie'), ('hipertensiun', '/cardiologie'),
    ('pulmonar', '/pneumologie'), ('fibroza', '/pneumologie'),
    ('hemoroiz', '/chirurgie-generala'), ('fistul', '/chirurgie-generala'),
    ('colecist', '/chirurgie-generala'), ('biliar', '/chirurgie-generala'),
    ('hernie', '/chirurgie-generala'), ('colorectal', '/chirurgie-generala'),
    ('laparoscopic', '/chirurgie-generala'), ('esofag', '/gastroenterologie'),
    ('botox', '/chirurgie-estetica'), ('filler', '/chirurgie-estetica'),
    ('lifting', '/lifting-facial-si-gat'), ('otoplastia', '/chirurgie-estetica'),
    ('chirurgia-plastica', '/chirurgie-estetica'), ('chirurgie-plastica', '/chirurgie-estetica'),
    ('diabet', '/endocrinologie'),
    ('artrita', '/reumatologie'), ('reumato', '/reumatologie'),
    ('alergi', '/alergologie'),
    ('fibromul', '/obstetrica-ginecologie'), ('uterin', '/obstetrica-ginecologie'),
    ('cerebral', '/neurochirurgie'),
    ('hepatic', '/transplant-de-organe-si-tesuturi'),
]

# Matched on prefix, before the keyword pass.
PREFIXES = [
    ('/interventii/pachet-', '/oferte'),
]


def target_for(path):
    if path in OVERRIDES:
        return OVERRIDES[path], 'mapped by hand'
    slug = path.strip('/').split('/')[-1]
    if slug in local:
        return '/' + slug, 'slug matches a page'
    for prefix, dest in PREFIXES:
        if path.startswith(prefix):
            return dest, 'mapped by hand'
    for needle, dest in TOPICS:
        if needle in path:
            return dest, 'nearest topic'
    return None, 'NO TARGET'


def main(urls):
    rows, unresolved, needs_page = [], [], []
    seen = set()
    for url in urls:
        path = re.sub(r'^https?://[^/]+', '', url.strip())
        if not path or path == '/' or path in seen:
            continue
        seen.add(path)
        dest, why = target_for(path)
        if dest == NEEDS_PAGE:
            needs_page.append(path)
            continue
        if dest is None:
            unresolved.append(path)
            continue
        rows.append((path, dest, why))

    rows.sort(key=lambda r: (r[0].count('/'), r[0]))

    with open(sys.argv[2], 'w', encoding='utf-8') as fh:
        fh.write('## Generated by scratchpad/buildredirects.py — WordPress cutover.\n')
        fh.write('## Every URL indexed on the old site resolves to its closest\n')
        fh.write('## equivalent here, so no ranking page returns 404 at cutover.\n\n')
        for path, dest, why in rows:
            fh.write(f'[[redirects]]\n  from = "{path}"\n  to = "{dest}"\n')
            fh.write(f'  status = 301\n  force = true\n\n')

        fh.write('## Custom post types and archives, collapsed wholesale.\n')
        fh.write('## These are listed last: Netlify applies the first match, so the\n')
        fh.write('## exact rules above always win over these catch-alls.\n\n')
        for path, dest in WILDCARDS:
            fh.write(f'[[redirects]]\n  from = "{path}"\n  to = "{dest}"\n')
            fh.write(f'  status = 301\n  force = true\n\n')

    # A redirect pointing at a page that does not exist is just a slower 404.
    broken = []
    for _, dest, _ in rows:
        if dest.startswith('http') or dest == '/':
            continue
        if dest.lstrip('/') not in local:
            broken.append(dest)
    for _, dest in WILDCARDS:
        if dest != '/' and dest.lstrip('/') not in local:
            broken.append(dest)

    print(f'{len(rows)} exact + {len(WILDCARDS)} wildcard redirects -> {sys.argv[2]}')
    if broken:
        print(f'\nBROKEN TARGETS ({len(set(broken))}) — these pages do not exist:')
        for d in sorted(set(broken)):
            print(f'  {d}')
    else:
        print('every destination resolves to a real page')
    by_reason = {}
    for _, _, why in rows:
        by_reason[why] = by_reason.get(why, 0) + 1
    for why, n in sorted(by_reason.items(), key=lambda kv: -kv[1]):
        print(f'  {n:>3}  {why}')

    if needs_page:
        print(f'\nNEEDS A REAL PAGE ON THE NEW SITE ({len(needs_page)}):')
        for p in needs_page:
            print(f'  {p}')
    if unresolved:
        print(f'\nNO TARGET — decide manually ({len(unresolved)}):')
        for p in unresolved:
            print(f'  {p}')


if __name__ == '__main__':
    with open(sys.argv[1], encoding='utf-8') as fh:
        main([l for l in fh if l.strip().startswith('http')])
