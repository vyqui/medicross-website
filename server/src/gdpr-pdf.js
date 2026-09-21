import path from 'node:path';
import PDFDocument from 'pdfkit';

/* ---------------------------------------------------------------------------
   Renders a completed GDPR travel-registration as a PDF, matching the old
   WordPress form-plugin's export as closely as pdfkit allows: full legal
   text on every submission (not just a summary), a repeating letterhead and
   footer, then a bordered field-by-field table at the end. Field labels that
   were never translated in the original ("Email", "Date of Birth",
   "Signature", "GDPR Agreement" / "Accepted") are kept exactly as-is on
   purpose, since this is meant to look like the same document.

   This is the only place that ever touches the CNP or the signature image —
   neither is written to the database, so this PDF (mailed out immediately)
   is the sole record of them, alongside the Google Sheet when configured.

   PDFKit's built-in Helvetica is a WinAnsi/Latin-1 font: it silently drops
   ă/â/î and mangles ș/ț (Romanian's comma-below letters aren't in Latin-1 at
   all). DejaVu Sans has full Romanian coverage, so it's bundled here and
   embedded instead — bitstream-vera licensed, free to redistribute.
   --------------------------------------------------------------------------- */

const FONT_DIR = path.join(import.meta.dirname, '..', 'assets', 'fonts');
const REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');
const LOGO_ICON = path.join(import.meta.dirname, '..', 'assets', 'images', 'logo-icon.png');

const INK = '#211E1A';
const MUTED = '#6B655C';
const BRAND = '#D42B2B';
const LINE = '#DDD7CB';
const HEADER_BG = '#F7F5F1';

const PAGE_MARGINS = { top: 138, bottom: 66, left: 54, right: 54 };
const BODY_SIZE = 10.2;

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Letterhead: icon + wordmark, then the document title. Drawn once for the
    first page and again on every page pdfkit adds via overflow or an
    explicit addPage(), so it's registered as a 'pageAdded' listener. */
function drawHeader(doc) {
  const left = doc.page.margins.left;
  const top = 40;

  try {
    doc.image(LOGO_ICON, left, top, { width: 32 });
  } catch { /* missing asset shouldn't take the whole PDF down */ }

  doc.font(BOLD).fontSize(13).fillColor(INK).text('TRATAMENTE', left + 40, top - 2);
  doc.font(BOLD).fontSize(13).fillColor(BRAND).text('TURCIA', left + 40, top + 13);
  doc.font(REGULAR).fontSize(7.5).fillColor(MUTED).text('cu grijă pentru tine', left + 40, top + 28);

  doc.font(BOLD).fontSize(20).fillColor(INK)
    .text('Informare Inițială - Acord GDPR', left, top + 52, { width: contentWidth(doc) });

  doc.y = PAGE_MARGINS.top;
}

/** Footer needs the total page count, which isn't known until the document
    is fully laid out — pdfkit's standard fix is bufferPages + a post-pass
    that revisits each page with switchToPage(). The footer band sits inside
    the page's bottom margin gutter (below page.margins.bottom's boundary),
    which is exactly the area pdfkit's own text-flow treats as "off the
    page" — calling .text() there makes it think the content overflowed and
    silently add a brand-new page. Zeroing the margin for the duration of
    these two calls draws the footer in place instead. */
function drawFooters(doc, dateLabel) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const width = contentWidth(doc);
    const left = doc.page.margins.left;
    const y = doc.page.height - PAGE_MARGINS.bottom + 18;
    const pageNum = i - range.start + 1;

    doc.rect(left, y, width, 20).stroke(LINE);
    doc.rect(left, y, width * 0.6, 20).stroke(LINE);

    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(REGULAR).fontSize(9).fillColor(MUTED)
      .text(dateLabel, left + 8, y + 5, { width: width * 0.6 - 16, lineBreak: false });
    doc.text(`${pageNum}/${range.count}`, left + width * 0.6, y + 5, {
      width: width * 0.4 - 8, align: 'right', lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }
}

function heading2(doc, text) {
  if (doc.y > PAGE_MARGINS.top) doc.moveDown(1);
  doc.font(BOLD).fontSize(14).fillColor(INK).text(text, { width: contentWidth(doc) });
  doc.moveDown(0.6);
}

function heading3(doc, text) {
  doc.moveDown(0.5);
  doc.font(BOLD).fontSize(11).fillColor(INK).text(text, { width: contentWidth(doc) });
  doc.moveDown(0.3);
}

function paragraph(doc, text) {
  doc.font(REGULAR).fontSize(BODY_SIZE).fillColor(INK)
    .text(text, { width: contentWidth(doc), align: 'left', lineGap: 2 });
  doc.moveDown(0.6);
}

function boldLine(doc, text) {
  doc.font(BOLD).fontSize(BODY_SIZE).fillColor(INK)
    .text(text, { width: contentWidth(doc) });
  doc.moveDown(0.6);
}

/** A bullet whose lead-in phrase is bold and the remainder isn't — matches
    the two list items under "Scopul..." and the plain ones under
    "Drepturile...". Pass boldLead='' for a plain bullet. */
function bullet(doc, boldLead, rest) {
  const indent = 14;
  const width = contentWidth(doc) - indent;
  doc.x = doc.page.margins.left + indent;
  if (boldLead) {
    doc.font(BOLD).fontSize(BODY_SIZE).fillColor(INK)
      .text(`•  ${boldLead}`, { continued: Boolean(rest), width, lineGap: 2 });
    if (rest) doc.font(REGULAR).fontSize(BODY_SIZE).fillColor(INK).text(` ${rest}`, { width, lineGap: 2 });
  } else {
    doc.font(REGULAR).fontSize(BODY_SIZE).fillColor(INK).text(`•  ${rest}`, { width, lineGap: 2 });
  }
  doc.x = doc.page.margins.left;
  doc.moveDown(0.35);
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

/** One row of the closing field table: a shaded label bar followed
    immediately by a value box, borders touching — exactly the look of the
    original export's "Următoarele date au fost furnizate" table. */
function tableField(doc, label, value) {
  const width = contentWidth(doc);
  const left = doc.page.margins.left;
  const labelHeight = 20;
  const text = value || '—';
  const valueHeight = Math.max(
    28,
    doc.font(REGULAR).fontSize(BODY_SIZE).heightOfString(text, { width: width - 20 }) + 16);

  ensureSpace(doc, labelHeight + valueHeight);
  let y = doc.y;

  doc.rect(left, y, width, labelHeight).fillAndStroke(HEADER_BG, LINE);
  doc.font(BOLD).fontSize(9.5).fillColor(INK).text(label, left + 10, y + 5, { width: width - 20, lineBreak: false });
  y += labelHeight;

  doc.rect(left, y, width, valueHeight).fillAndStroke('#ffffff', LINE);
  doc.font(REGULAR).fontSize(BODY_SIZE).fillColor(INK).text(text, left + 10, y + 8, { width: width - 20 });
  doc.y = y + valueHeight;
}

/** Same shape as tableField, but the value is the signature image. */
function tableFieldImage(doc, label, imageBuffer) {
  const width = contentWidth(doc);
  const left = doc.page.margins.left;
  const labelHeight = 20;
  const valueHeight = 120;

  ensureSpace(doc, labelHeight + valueHeight);
  let y = doc.y;

  doc.rect(left, y, width, labelHeight).fillAndStroke(HEADER_BG, LINE);
  doc.font(BOLD).fontSize(9.5).fillColor(INK).text(label, left + 10, y + 5, { width: width - 20, lineBreak: false });
  y += labelHeight;

  doc.rect(left, y, width, valueHeight).fillAndStroke('#ffffff', LINE);
  if (imageBuffer) doc.image(imageBuffer, left + 10, y + 10, { fit: [220, valueHeight - 20] });
  doc.y = y + valueHeight;
}

/**
 * @param {object} data
 * @param {string} data.categoryLabel
 * @param {string} data.procedureLabel
 * @param {string} data.name
 * @param {string} data.email
 * @param {string} data.phone
 * @param {string} data.cnp
 * @param {string} data.addressLine1
 * @param {string} data.addressLine2
 * @param {string} data.dateOfBirth  ISO date string
 * @param {Buffer} data.signaturePng  decoded signature image
 * @param {string} data.sourcePage
 * @returns {Promise<Buffer>}
 */
export function renderGdprRegistrationPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: PAGE_MARGINS, bufferPages: true, autoFirstPage: false });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.on('pageAdded', () => drawHeader(doc));

    doc.addPage();

    /* ---- Informarea GDPR (identical wording to acord-gdpr.html) ---- */
    paragraph(doc,
      'Societatea Medicross Medical Soulutions SRL, cu sediul în Ploiești, B-dul Republicii, Nr. 10, Bl. 33C, ap. ' +
      '22,judetul Prahova, având CUI RO 43759021, fiind înregistrată la Registrul Comerțului sub nr. J29/445/2021, ' +
      'telefon 0746.99.22.22, reprezentata prin Dl. Dr. Murat Gulseven, în calitate de Administrator, în baza art. 13 ' +
      'din REGULAMENTUL (UE) 2016/679 AL PARLAMENTULUI EUROPEAN SI AL CONSILIULUI/ 27 aprilie 2016, va informam ca ' +
      'vom colecta si prelucra datele dumneavoastră prin intermediul website-ului https://tratamente-turcia.ro cu ' +
      'caracter personal: nume, adresa de email, număr de telefon, adresa de domiciliul, CNP, serie și număr carte ' +
      'identitate și/sau pașaport, bilet de avion, poze personale, toate fiind în scopul obținerii unei oferte ' +
      'personalizate și al încheierii contractului de prestări servicii între dumneavoastră și Societatea Medicross ' +
      'Medical Soulutions SRL - Tratamente Turcia.');

    paragraph(doc,
      'Temeiul juridic al prelucrării datelor dumneavoastră cu caracter personal îl reprezintă - încheierea unui ' +
      'contract (Art. 6 alin. (1) lit. (b) din Regulament), precum si prelucrare necesară conformării obligației ' +
      'legale (Art. 6 alin. (1) lit. (c) din Regulament), obligație legala reglementată de legislație.');

    paragraph(doc,
      'Vă informăm că destinatarii datelor dumneavoastră cu caracter personal sunt angajații subscrisei, ' +
      'departamentul de contabilitate, dar și colaboratorii noștri (cărora le vor fi comunicate numele ' +
      'dumneavoastră, adresa de email, poze personale și numărul de telefon) și că nu intenționăm transferarea ' +
      'acestor date decât către spitalele colaboratoare din Turcia.');

    paragraph(doc,
      'Datele vor fi stocate pe o perioada determinată, atât timp cât se deruleaza contractul de prestari servicii ' +
      'și este în vigoare și, în situația unui litigiu, pe parcursul solutionării acestuia, precum si în ' +
      'conformitate cu legislația în vigoare atât timp cât avem obligația legală de a păstra contractele de ' +
      'prestări servicii și alte documente legale.');

    paragraph(doc,
      'Vă informăm că aveti dreptul de a solicita accesul la datele dumneavoastră personale, precum și ' +
      'rectificarea sau ștergerea acestora sau restricționarea prelucrării, conform legii, precum și dreptul de a ' +
      'face plângere la autoritatea de supraveghere, dacă considerați că drepturile dumneavoastră au fost ' +
      'nerespectate.');

    paragraph(doc,
      'Vom stabili măsuri tehnice și procedurale, pentru a proteja și pentru a asigura confidențialitatea, ' +
      'integritatea și accesibilitatea datelor dumneavoastră cu caracter personal prelucrate; vom preveni ' +
      'utilizarea sau accesul neautorizat și vom preveni încălcarea securității datelor cu caracter personal, în ' +
      'conformitate cu legislația în vigoare.');

    paragraph(doc,
      'In conformitate cu Legea nr. 171 din 14 iunie 2023, in modif. Si compl. Art. 226 din legea 286/2009 privind ' +
      'C.P., declar ca sunt de acord cu divulgarea, difuzarea, prezentarea sau transmiterea in orice mod a ' +
      'imaginilor intime ale subsemnatei/subsemnatului.');

    boldLine(doc, 'Am luat la cunoștință și sunt de acord cu toate cele de mai sus.');

    doc.moveDown(0.5);
    doc.font(BOLD).fontSize(9.5).fillColor(MUTED).text('NUMELE ÎN CLAR ȘI SEMNĂTURA');
    doc.moveDown(0.2);
    boldLine(doc, data.name);

    /* ---- Acordul foto/video/testimoniale ---- */
    heading2(doc, 'Acord privind utilizarea și procesarea imaginilor fotografice, testimonialelor, ' +
      'înregistrărilor audio și video');

    heading3(doc, 'I. Scopul în care va fi utilizat consimțământul');
    paragraph(doc, 'Fotografiile/ testimonialele/ înregistrările audio/ înregistrările video care fac obiectul ' +
      'prezentei vor fi utilizate strict în următoarele scopuri:');
    bullet(doc, 'publicarea pe Internet, în scopul prezentării și promovării activității „https://www.tratamente-turcia.ro”:',
      'pe site-ul www.tratamente-turcia.ro, pe rețelele de socializare precum Facebook, Instagram etc.');
    bullet(doc, 'transmiterea de către beneficiar a imaginilor pacientului către terții(spitalele partenere din Turcia) ' +
      'în scopul exclusiv de realizare de materiale publicitare audio și/sau video și/sau presa scrisă în vederea ' +
      'promovării activității „https://www.tratamente-turcia.ro”', '');

    heading3(doc, 'II. Drepturile pacientului');
    paragraph(doc, 'Pacientul este protejat de către Regulamentului nr. 679/2016 privind protecția persoanelor ' +
      'fizice in ceea ce privește prelucrarea datelor cu caracter personal si privind libera circulație a acestor ' +
      'date si de abrogare a Directivei 95/46/CE (Regulamentul General privind protecția datelor) și are dreptul de ' +
      'a solicita în orice moment:');
    bullet(doc, '', 'informare și consultarea informatiilor vizate');
    bullet(doc, '', 'restricționarea și opunerea în prelucrarea informațiilor vizate');
    bullet(doc, '', 'actualizarea informațiilor vizate');
    bullet(doc, '', 'ștergerea informațiilor vizate');

    heading3(doc, 'III. Valabilitate');
    paragraph(doc, 'Prezentul consimțământ este valabil din momentul semnarii acordului si până la retragerea ' +
      'expresă a acestuia, în formă scrisă.');

    heading3(doc, 'IV. Declaratie:');
    paragraph(doc, 'Pacientul își exprimă consimțământul in favoarea beneficiarului cu privire la utilizarea ' +
      'neremunerată a imaginilor fotografice, a testimonialelor, a înregistrărilor audio și video ale persoanei ' +
      'sale (sau al pacientului minor,daca e cazul) în scopurile descrise mai sus. Utilizarea imaginilor ' +
      'fotografice, testimonialelor, înregistrărilor audio și video în alte scopuri decât cele descrise mai sus ' +
      'sau pentru comercializarea prin transferul imaginilor către alți terți decât cei menționați, este strict ' +
      'interzisă.');

    doc.moveDown(0.3);
    ensureSpace(doc, 130); // name + signature image, kept on the same page
    boldLine(doc, data.name);
    const signatureTop = doc.y;
    if (data.signaturePng) doc.image(data.signaturePng, doc.x, signatureTop, { fit: [220, 90] });
    doc.y = signatureTop + 100;

    paragraph(doc, 'Următoarele date au fost furnizate:');

    /* ---- closing field table ---- */
    tableField(doc, data.categoryLabel, `•  ${data.procedureLabel}`);
    tableField(doc, 'Nume', data.name);
    tableField(doc, 'Email', data.email);
    tableField(doc, 'Telefon', data.phone);
    tableField(doc, 'CNP', data.cnp);
    tableField(doc, 'Address', data.addressLine1);
    tableField(doc, 'Address', data.addressLine2);
    tableField(doc, 'Date of Birth', data.dateOfBirth);
    tableFieldImage(doc, 'Signature', data.signaturePng);
    tableField(doc, 'GDPR Agreement', 'Accepted');

    const dateLabel = new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
      .replace(/\./g, '-');
    drawFooters(doc, dateLabel);

    doc.end();
  });
}
