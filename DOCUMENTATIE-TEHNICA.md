# Tratamente Turcia by Medicross — documentație tehnică

Acest document explică tot proiectul, de la zero, din punct de vedere tehnic. Presupune că cititorul nu știe nimic despre cod, dar vrea să înțeleagă exact ce există, cum funcționează și de ce a fost construit așa.

---

## 1. Ce este acest proiect, pe scurt

Proiectul are **două jumătăți separate**, care vor rula pe două adrese diferite:

| Jumătate | Ce face | Unde va rula |
|---|---|---|
| **Site-ul de prezentare** | Paginile publice: specialități, prețuri, contact, blog | `tratamente-turcia.ro` |
| **Platforma client** | Contul de pacient + panoul de administrare | `cont.tratamente-turcia.ro` |

Astăzi, ambele bucăți există în același loc — depozitul de cod (repository) `vyqui/medicross-website` — dar sunt scrise ca **două aplicații independente**, cu tehnologii diferite, pentru că fac lucruri fundamental diferite:

- Site-ul de prezentare e **static**: sunt fișiere HTML gata scrise, care nu se schimbă în funcție de cine le vizitează. Nu are nevoie de o bază de date sau de un "server" în sensul clasic — orice calculator poate "servi" aceste fișiere.
- Platforma client e **dinamică**: fiecare pacient vede date diferite (operațiile lui, documentele lui, reducerea lui), iar acele date trebuie stocate undeva sigur, permanent, și accesibile din orice browser/telefon. Asta cere o bază de date reală și un program care rulează non-stop pe un server.

Site-ul de prezentare a înlocuit deja un site WordPress mai vechi (care rulează încă, live, pe domeniul curent) — cutover-ul spre domeniul propriu-zis e planul discutat separat.

---

## 2. Harta depozitului de cod

```
medicross-website/
├── index.html, contact.html, rinoplastie.html, ...   ← 69 pagini de conținut (site-ul public)
├── acord-gdpr.html, oferte.html, blog.html, ...
├── portal.html, admin.html, login.html, register.html ← cele 4 pagini ale platformei client
├── assets/                                             ← CSS și JavaScript, pe fișiere tematice
│   ├── styles.css, header.css, home.css, ...           (stilizare site public)
│   ├── portal.css, admin.css, auth.css                 (stilizare platformă)
│   └── portal-data.js                                  (creierul platformei — vezi secțiunea 5)
├── materials/                                           ← imagini, video-uri, documente
├── netlify.toml                                         ← configurația de hosting pentru site-ul public
├── robots.txt, sitemap.xml                              ← fișiere pentru motoarele de căutare
├── tools/                                               ← scriptul care generează maparea de redirect-uri
└── server/                                              ← platforma client (API + bază de date)
    ├── src/                                              (codul serverului, Node.js)
    ├── migrations/                                       (structura bazei de date)
    ├── test/smoke.js                                     (teste automate)
    └── README.md                                         (ghid de deployment pentru server)
```

Cele două jumătăți nu se amestecă: `server/` e complet auto-conținut și se instalează/rulează separat de restul site-ului.

---

## 3. Site-ul de prezentare (partea "statică")

### 3.1. Fără build, fără framework

Multe site-uri moderne se scriu în React/Vue/Next.js și trec printr-un "build step" — un program care transformă codul sursă în fișiere finale înainte de a le pune online. **Acest site nu face asta.** Fiecare pagină e un fișier `.html` scris de-a gata, cu CSS și JavaScript simplu ("vanilla"), care merge direct în browser fără nicio transformare.

**De ce e o alegere bună aici:** site-ul nu are nevoie de interactivitate complexă — e conținut editorial (text, imagini, formulare de contact). Un site static e mai rapid, mai ieftin de găzduit, mai simplu de întreținut și practic imposibil de "spart" din exterior, pentru că nu există cod care rulează pe server pentru vizitatorul public.

### 3.2. Structura unei pagini

Fiecare pagină de tip "specialitate" sau "serviciu" (ex. `rinoplastie.html`, `gastric-bypass.html`) urmează același tipar:

1. **Header comun** — logo, meniu de navigare, telefon, butoane. Identic, literă cu literă, pe toate cele ~68 de pagini publice.
2. **Conținutul propriu al paginii** — text, prețuri, imagini specifice.
3. **Footer comun** — coloane de linkuri, date de contact, și acum **disclaimer-ul medical** (adăugat recent — vezi secțiunea 3.4).

Faptul că header-ul și footer-ul sunt identice pe toate paginile e important de știut: orice modificare la ele (ex. schimbarea unui număr de telefon) trebuie aplicată pe toate fișierele deodată, cu un script, nu manual pagină cu pagină.

### 3.3. Platforma de hosting: Cloudflare Pages

Site-ul se deployează pe [Cloudflare Pages](https://pages.cloudflare.com), un serviciu gratuit care ia fișierele direct din depozitul GitHub și le publică pe internet, automat, la fiecare modificare (`git push`). A fost ales în locul unei alternative precum Netlify din două motive: e complet gratuit la acest volum de trafic, și — mai important — rulează pe o infrastructură total separată de Railway (unde stă platforma de client), deci o problemă la Railway nu poate pica și site-ul public.

Regulile de redirecționare și headerele de securitate se scriu o singură dată, în `netlify.toml` (păstrat ca sursă de adevăr ușor de citit/editat), iar scriptul `tools/build-cf-redirects.py` generează din el fișierele native pe care Cloudflare Pages știe să le citească:

- **`_redirects`** — conține și regulile de "URL curat" (`rinoplastie` funcționează fără `.html`, exact cum apare în adresele "canonice" din cod și din harta site-ului `sitemap.xml`), și cele 200 de reguli de redirecționare de mai jos.
- **`_headers`** — headerele de securitate (reguli standard care împiedică anumite tipuri de atacuri, ex. afișarea site-ului într-un `<iframe>` de pe alt domeniu) și cache-ul pentru `materials/` (o săptămână, ca paginile să se încarce mai repede la vizite repetate).

Orice modificare viitoare la reguli se face în `netlify.toml`, apoi se rulează scriptul din nou — altfel cele două fișiere generate rămân în urmă.

### 3.4. Maparea de redirect-uri de la WordPress

Domeniul `tratamente-turcia.ro` rulează **încă** un site WordPress vechi, cu aproximativ 217 adrese indexate de Google (pagini, articole de blog, etc.). Noul site are doar 69 de pagini. Dacă am muta pur și simplu domeniul pe noul site fără nimic altceva, toate acele 217 adrese ar începe brusc să dea eroare "pagina nu există" (404) — inclusiv articole de blog care aduc trafic real din căutări Google.

Soluția: `netlify.toml` conține **200 de reguli de redirecționare** (redirect 301 — înseamnă "această adresă s-a mutat definitiv aici"), generate automat de scriptul `tools/build-redirects.py`. Fiecare adresă veche e mapată la cea mai apropiată pagină echivalentă de pe noul site. De exemplu:

- `/chirurgie-plastica-estetica/rinoplastie/` (vechea structură, cu foldere) → `/rinoplastie` (noua structură, plată)
- Un articol de blog despre varice, care nu are echivalent exact pe noul site → pagina despre chirurgie vasculară (cel mai apropiat subiect)

Acest lucru e esențial pentru SEO: fără el, mutarea domeniului ar însemna pierderea poziției în Google construite în ani de zile.

---

## 4. De ce a fost nevoie de o platformă nouă pentru clienți

### 4.1. Cum arăta înainte

Exista deja un "portal de client" funcțional — `portal.html` (ce vede pacientul) și `admin.html` (ce vede echipa Medicross) — dar construit ca un **prototip**: tot ce introducea cineva (cont nou, document încărcat, reducere acordată) se salva în memoria browserului (`localStorage`), nu pe un server real.

Asta însemna trei probleme grave:

1. **Datele nu treceau de la un dispozitiv la altul.** Un pacient care își făcea cont de pe telefon nu-l regăsea pe laptop — pentru browser, erau două locuri complet separate.
2. **Parolele erau stocate necriptat**, direct ca text simplu — acceptabil doar pentru un prototip de test, niciodată pentru date reale.
3. **Sumele de reducere (bani reali) erau calculate în codul care rulează în browserul utilizatorului** — deci oricine cu cunoștințe tehnice de bază putea deschide unealta de "inspectare" a browserului și să-și acorde singur reduceri de sute de euro, fără ca nimeni din echipă să confirme nimic.

### 4.2. Ce înlocuiește prototipul

Am construit un **server real** (folderul `server/`), cu o **bază de date reală**, care rezolvă exact aceste trei probleme. Cel mai important: interfața (paginile `portal.html` și `admin.html`, cu tot cu `portal.js`/`admin.js`) **rămâne aceeași** — nu s-a schimbat nimic vizual sau funcțional pentru utilizator. S-a schimbat doar ce se întâmplă "în spate", la fiecare click.

Asta a fost posibil pentru că întregul prototip vorbea printr-un singur "obiect" în cod, numit `MedicrossDB` (definit în `assets/portal-data.js`). Fiecare acțiune din interfață (`MedicrossDB.login(...)`, `MedicrossDB.addDocument(...)`, etc.) era, de fapt, deja izolată de restul codului — practic o listă gata făcută de "ce trebuie să facă un server real". Am transformat fiecare astfel de acțiune într-un punct de contact (endpoint) pe server.

---

## 5. Cum funcționează platforma nouă, tehnic

### 5.1. Piesele tehnologice

| Componentă | Ce este | Rol |
|---|---|---|
| **Node.js** | mediul de rulare pentru JavaScript în afara browserului | rulează codul serverului |
| **Fastify** | o "bibliotecă" (framework) pentru a construi un server web în Node.js | primește cererile HTTP și trimite răspunsuri |
| **PostgreSQL** | un sistem de bază de date | stochează pacienți, conturi, documente, reduceri, etc. |
| **scrypt** | un algoritm de criptare a parolelor, inclus direct în Node.js | transformă parola într-un șir criptat, imposibil de "descriptat" înapoi |

Nu s-a folosit niciun "framework mare" (React, Next.js etc.) pentru server — Fastify e minimal și rapid, potrivit pentru un API care doar primește/trimite date, fără nicio interfață grafică proprie.

### 5.2. Ce e o "bază de date" și cum arată aici

O bază de date e, simplificat, un set de tabele (ca niște foi de Excel foarte stricte), unde fiecare rând e o înregistrare și fiecare coloană are un tip fix de date. Structura completă e definită în `server/migrations/001_init.sql` și include:

- **`patients`** — un rând per pacient: nume, telefon, cod de recomandare, dacă a semnat GDPR, etc.
- **`accounts`** — datele de login (email + parolă criptată + rol: `pacient` sau `admin`)
- **`sessions`** — cine e "logat" acum și până când (vezi 5.3)
- **`operations`** — intervențiile fiecărui pacient (nume, status, dată)
- **`trip_items`** — etapele călătoriei în Istanbul (zbor, hotel, intervenție, recuperare)
- **`documents`** — fișierele încărcate (analize, planuri de tratament) — *doar informația despre fișier*; fișierul propriu-zis se ține separat, pe disc (vezi 5.5)
- **`discount_actions`** — ce acțiuni sociale (Instagram, Facebook, recenzie) a bifat fiecare pacient, și dacă au fost *confirmate* de echipă
- **`referrals`** — recomandările făcute de un pacient către prieteni
- **`activity_log`** — jurnal de audit: cine a făcut ce și când, pe fiecare pacient
- **`leads`** — mesajele primite prin formularele de contact de pe site-ul public (nou — vezi 5.6)

### 5.3. Autentificare și sesiuni — cum știe serverul cine ești

Când cineva se loghează:

1. Serverul verifică parola introdusă contra celei criptate din baza de date (fără să "descripteze" nimic — se criptează din nou parola introdusă și se compară cele două șiruri criptate).
2. Dacă se potrivesc, se creează o **sesiune** — un rând nou în tabelul `sessions`, cu un identificator unic și o dată de expirare (14 zile).
3. Acel identificator e trimis browserului ca un **cookie** — un fișier mic pe care browserul îl trimite înapoi automat la fiecare cerere către server, ca o "insignă" de identificare.
4. La fiecare cerere ulterioară, serverul verifică acel cookie contra tabelului `sessions`, ca să știe cine face cererea.

Parola nu circulă niciodată în clar după login, iar cookie-ul e marcat `httpOnly` (nu poate fi citit de JavaScript, deci un atac tipic de tip XSS nu poate fura sesiunea) și semnat criptografic (nu poate fi falsificat).

### 5.4. Reducerile — de ce sunt calculate exclusiv pe server

Regulile de business (definite în `server/src/discounts.js`):

| Acțiune | Sumă | Cum se acordă |
|---|---|---|
| Follow Instagram / Facebook / recenzie / distribuire | 7,50 € fiecare | pacientul bifează, **un angajat confirmă manual** |
| Recomandare care ajunge la operație | 70 € per persoană | doar echipa marchează "operat" |
| Cod de reducere de la alt pacient | 20 € | o singură dată, la înregistrare |

Diferența esențială față de prototip: când pacientul bifează "am dat follow", **nu câștigă nimic încă** — se salvează doar că a *cerut* verificarea. Suma se adaugă la reducerea lui doar când un membru al echipei confirmă manual, din panoul de admin, că acțiunea chiar există. Server-ul recalculează mereu totalul din tabelele reale — niciodată nu acceptă o sumă trimisă direct din browser.

### 5.5. Documentele pacienților

Fișierele încărcate (PDF-uri cu analize, planuri de tratament) sunt date medicale sensibile. De aceea:

- Fișierele efective se salvează pe disc, **în afara** zonei accesibile public de pe internet.
- Pentru a descărca un document, cineva trebuie să fie logat, iar serverul verifică de fiecare dată dacă persoana are voie să vadă exact acel document (fie e chiar pacientul, fie e un membru al echipei).
- Fiecare cerere greșită (cineva încearcă să vadă documentul altcuiva) primește "nu există", nu "nu ai voie" — ca să nu confirme nici măcar că fișierul e acolo.
- Sunt acceptate doar tipuri de fișiere așteptate (PDF, imagini, Word) — orice altceva e respins automat.

### 5.6. O piesă nouă, în afara portalului: capturarea de lead-uri

Formularele de contact de pe site-ul public (ex. "Solicită o opinie medicală gratuită") funcționau doar deschizând WhatsApp cu un mesaj pre-completat. Dacă persoana nu apăsa efectiv "trimite" în WhatsApp, acea cerere **nu era înregistrată nicăieri** — nu exista nicio evidență.

Am adăugat un punct de contact separat pe server (`POST /api/leads`), care salvează mesajul direct în baza de date, indiferent dacă persoana ajunge sau nu să trimită pe WhatsApp. Are și o protecție simplă anti-spam ("honeypot" — un câmp ascuns pe care doar un robot automat l-ar completa).

---

## 6. Cum "vorbesc" între ele front-end-ul și serverul

Comunicarea se face prin **HTTP** — același protocol prin care browserul cere orice pagină web — dar în loc să ceară o pagină HTML, codul din `portal.js`/`admin.js` cere/trimite **date structurate** (format JSON), la adrese care încep cu `/api/...`. De exemplu:

```
GET  /api/me                        → "dă-mi datele contului meu"
POST /api/me/actions/instagram      → "am bifat acțiunea Instagram"
POST /api/admin/patients            → "creează un pacient nou" (doar admin)
GET  /api/documents/<id>            → "dă-mi acest fișier" (doar dacă am voie)
```

Fiecare astfel de adresă e verificată pe server: cine face cererea (din cookie-ul de sesiune), ce rol are (pacient/admin), și dacă are voie la exact acea informație. Regula generală: un pacient nu poate niciodată specifica "al cui" cont vrea să vadă — serverul ia mereu acea informație din sesiunea lui, nu din ce trimite browserul, ca să nu existe nicio portiță de a cere datele altcuiva.

---

## 7. Deployment — unde va rula totul, în producție

| Serviciu | Ce găzduiește | De ce acesta |
|---|---|---|
| **Cloudflare Pages** | site-ul de prezentare (fișierele statice) | gratuit fără limită reală la acest volum, publică automat la fiecare `git push`, infrastructură total separată de Railway |
| **Railway** (regiune **EU West**) | serverul (`server/`) + baza de date PostgreSQL + documentele pacienților | găzduire simplă pentru Node.js + Postgres administrat, cost mic (~10-20€/lună); regiunea UE e obligatorie pentru date medicale (GDPR) |
| **DNS-ul domeniului** | leagă `tratamente-turcia.ro` de Cloudflare Pages și `cont.tratamente-turcia.ro` de Railway | rămâne la registrator-ul (ROTLD) unde a fost cumpărat domeniul |

Cele două servicii rulează pe infrastructuri complet separate, de la companii diferite — dacă platforma client are o problemă (sau chiar dacă Railway ca întreg ar avea o pană), site-ul public nu e afectat, și invers. Aceasta e o izolare mai puternică decât dacă am fi pus ambele servicii doar pe conturi separate în cadrul aceluiași furnizor.

**Important, juridic:** Railway este un "procesator de date" în sensul GDPR, pentru că stochează efectiv datele pacienților (nume, telefon, documente medicale). Înainte de a pune date reale de pacienți acolo, trebuie semnat un **DPA** (Data Processing Agreement / Acord de prelucrare a datelor) cu Railway — disponibil ca proces self-service la `railway.com/legal/dpa`. Acest document trebuie semnat în numele societății Medicross (operatorul de date, conform propriei pagini de Acord GDPR: Medicross Medical Soulutions SRL, CUI RO 43759021), nu în numele persoanei care administrează tehnic contul, iar semnătura trebuie să aparțină cuiva cu autoritate legală în firmă. Cloudflare Pages, în schimb, **nu** are nevoie de un asemenea acord: servește doar fișiere statice publice (HTML/CSS/imagini), fără să atingă vreodată datele unui pacient — formularele de contact trimit datele direct către Railway, din browser, nu prin Cloudflare.

---

## 8. Stadiul actual (rezumat)

**Gata și testat:**
- Site-ul de prezentare — 75 de pagini, funcțional
- Configurația de hosting (`netlify.toml` ca sursă de adevăr → `_redirects`/`_headers` pentru Cloudflare Pages) + harta de 200 redirect-uri de pe WordPress
- Serverul platformei — testat cu 46+ verificări automate, care confirmă că: un pacient nou nu are nicio reducere, reducerea apare doar după confirmarea echipei, un pacient nu poate vedea datele altui pacient, documentele se descarcă corect și doar de cine are voie
- Pagina de Acord GDPR (text complet, conform documentului furnizat) și disclaimer-ul medical, afișate pe toate paginile relevante

**Rămas de făcut:**
- Deployment efectiv pe Cloudflare Pages și Railway (în curs)
- Semnarea DPA-ului cu Railway, în numele societății Medicross, de către cineva cu autoritate legală acolo
- Mutarea DNS-ului domeniului de pe WordPress-ul actual către noile servicii
- O pagină lipsă: politica de confidențialitate (există doar pe WordPress-ul vechi)
- Depozitarea video-urilor (214 MB) într-un serviciu dedicat (Cloudflare R2), în loc să stea direct în codul sursă
- Trimiterea de e-mailuri (resetare parolă, notificări) — nu e încă implementată; Resend (gratuit până la 3000/lună) e opțiunea propusă

---

## 9. Glosar minim

| Termen | Explicație simplă |
|---|---|
| **Repository (repo)** | folderul cu tot codul, urmărit de Git, găzduit pe GitHub |
| **Deployment** | procesul de a pune codul "live", accesibil pe internet |
| **API** | un set de adrese prin care două programe schimbă date (aici: front-end-ul și serverul) |
| **Backend / server** | codul care rulează pe un calculator la distanță, nu în browserul utilizatorului |
| **Frontend** | ce vede și cu ce interacționează utilizatorul, în browser |
| **Bază de date** | un sistem organizat de stocare permanentă a datelor |
| **DNS** | "agenda telefonică" a internetului — leagă un nume de domeniu de adresa reală a unui server |
| **Cookie** | un fișier mic salvat de browser, folosit aici pentru a ține minte cine e logat |
| **Redirect 301** | un răspuns care spune browserului "adresa asta s-a mutat definitiv aici" |
| **Hash / criptare de parolă** | transformarea unei parole într-un șir imposibil de "descriptat" înapoi, dar verificabil |
