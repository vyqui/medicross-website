import path from 'node:path';
import PDFDocument from 'pdfkit';

/* ---------------------------------------------------------------------------
   Renders a completed GDPR travel-registration as a PDF, matching the layout
   of the old WordPress form's export (category/procedure header, one
   labelled field per line, the drawn signature, then the GDPR line and the
   page it was submitted from). This is the only place that ever touches the
   CNP or the signature image — neither is written to the database, so this
   PDF (mailed out immediately) is the sole record of them.

   PDFKit's built-in Helvetica is a WinAnsi/Latin-1 font: it silently drops
   ă/â/î and mangles ș/ț (Romanian's comma-below letters aren't in Latin-1 at
   all), which turned every field label and half the values into garbage.
   DejaVu Sans has full Romanian coverage, so it's bundled here and embedded
   instead — bitstream-vera licensed, free to redistribute.
   --------------------------------------------------------------------------- */

const FONT_DIR = path.join(import.meta.dirname, '..', 'assets', 'fonts');
const REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const FIELD_LABEL_COLOR = '#6B655C';
const INK = '#211E1A';
const BRAND = '#D42B2B';

function field(doc, label, value) {
  doc.font(BOLD).fontSize(9).fillColor(FIELD_LABEL_COLOR)
    .text(label.toUpperCase(), { characterSpacing: 0.6 });
  doc.font(REGULAR).fontSize(12.5).fillColor(INK)
    .text(value || '—', { paragraphGap: 14 });
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
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 64, right: 64 } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(BOLD).fontSize(10).fillColor(BRAND)
      .text(data.categoryLabel.toUpperCase(), { characterSpacing: 0.6 });
    doc.font(BOLD).fontSize(20).fillColor(INK)
      .text(data.procedureLabel, { paragraphGap: 22 });

    field(doc, 'Nume', data.name);
    field(doc, 'E-mail', data.email);
    field(doc, 'Telefon', data.phone);
    field(doc, 'CNP', data.cnp);
    field(doc, 'Adresă', data.addressLine1);
    field(doc, 'Localitate, Județ', data.addressLine2);
    field(doc, 'Data nașterii', data.dateOfBirth);

    doc.font(BOLD).fontSize(9).fillColor(FIELD_LABEL_COLOR)
      .text('SEMNĂTURĂ', { characterSpacing: 0.6, paragraphGap: 6 });
    if (data.signaturePng) {
      doc.image(data.signaturePng, { fit: [220, 90] });
      doc.moveDown(0.5);
    }

    doc.moveDown(0.5);
    doc.font(BOLD).fontSize(9).fillColor(FIELD_LABEL_COLOR)
      .text('ACORD GDPR', { characterSpacing: 0.6 });
    doc.font(BOLD).fontSize(12.5).fillColor('#2F6B41')
      .text('Acceptat', { paragraphGap: 30 });

    doc.font(REGULAR).fontSize(10).fillColor(FIELD_LABEL_COLOR)
      .text(`Înregistrarea a fost făcută la pagina:\n${data.sourcePage}`, { paragraphGap: 18 });
    doc.font(BOLD).fontSize(11).fillColor(INK)
      .text('Echipa Tratamente Turcia');

    doc.end();
  });
}
