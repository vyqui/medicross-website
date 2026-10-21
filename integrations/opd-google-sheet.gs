/**
 * Bound Google Apps Script for "Medicross — OPD Consultation Management".
 * Settings > Script properties: OPD_WEBHOOK_SECRET = a long random secret.
 * Deploy as Web app: Execute as Me; Access: Anyone.
 * Store URL and the same secret in Railway (never commit them).
 *
 * One webhook, two tabs:
 *   - OPD consultation requests (no `kind`)  -> tab "OPD Requests" (must already exist)
 *   - general website leads (kind = "lead")  -> tab "Leads" (created automatically)
 * After editing this file: Deploy > Manage deployments > edit > New version.
 */
const LEADS_HEADERS = [
  'Request ID', 'Received at', 'Name', 'Phone', 'Email', 'Procedure', 'Message',
  'Source page', 'Form', 'Campaign / UTM', 'Marketing consent', 'Status', 'Notes',
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ok:false,error:'busy'});
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('OPD_WEBHOOK_SECRET');
    if (!expected || data.secret !== expected) return json_({ok:false,error:'unauthorized'});
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (data.kind === 'lead') return appendLead_(ss, data);
    return appendOpd_(ss, data);
  } catch (error) {
    console.error(error);
    return json_({ok:false,error:'internal'});
  } finally {
    lock.releaseLock();
  }
}

function appendOpd_(ss, data) {
  const sheet = ss.getSheetByName('OPD Requests');
  if (!sheet) return json_({ok:false,error:'missing sheet'});
  if (!data.requestId || !data.name || !data.email) return json_({ok:false,error:'invalid'});
  const key = String(data.requestId).slice(0,80);
  if (exists_(sheet, key)) return json_({ok:true,duplicate:true});
  sheet.appendRow([
    key, clean_(data.receivedAt), clean_(data.name), clean_(data.email),
    clean_(data.phone), clean_(data.doctor), clean_(data.date), clean_(data.time),
    clean_(data.note), 'New', '', '', 'Sent', 'Pending', clean_(data.source),
  ]);
  return json_({ok:true});
}

function appendLead_(ss, data) {
  if (!data.requestId || !(data.phone || data.email)) return json_({ok:false,error:'invalid'});
  let sheet = ss.getSheetByName('Leads');
  if (!sheet) {
    sheet = ss.insertSheet('Leads');
    sheet.appendRow(LEADS_HEADERS);
    sheet.setFrozenRows(1);
  }
  const key = String(data.requestId).slice(0,80);
  if (exists_(sheet, key)) return json_({ok:true,duplicate:true});
  sheet.appendRow([
    key, clean_(data.receivedAt), clean_(data.name), clean_(data.phone), clean_(data.email),
    clean_(data.procedure), clean_(data.message), clean_(data.source), clean_(data.formType),
    clean_(data.campaign), clean_(data.marketingConsent), 'New', '',
  ]);
  return json_({ok:true});
}

function exists_(sheet, key) {
  return !!sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),1)
    .createTextFinder(key).matchEntireCell(true).findNext();
}

/* Cells that start with = + @ - would be evaluated as formulas; force text. */
function clean_(value) {
  const str = String(value == null ? '' : value).slice(0,3000);
  return /^[=+@\-\t\r]/.test(str) ? "'" + str : str;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
