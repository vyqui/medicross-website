/**
 * Bound Google Apps Script for "Medicross — OPD Consultation Management".
 * Settings > Script properties: OPD_WEBHOOK_SECRET = a long random secret.
 * Deploy as Web app: Execute as Me; Access: Anyone.
 * Store URL and the same secret in Railway (never commit them).
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ok:false,error:'busy'});
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('OPD_WEBHOOK_SECRET');
    if (!expected || data.secret !== expected) return json_({ok:false,error:'unauthorized'});
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('OPD Requests');
    if (!sheet) return json_({ok:false,error:'missing sheet'});
    if (!data.requestId || !data.name || !data.email) return json_({ok:false,error:'invalid'});
    const key = String(data.requestId).slice(0,80);
    const matches = sheet.getRange(2,1,Math.max(1,sheet.getLastRow()-1),1)
      .createTextFinder(key).matchEntireCell(true).findNext();
    if (matches) return json_({ok:true,duplicate:true});
    const clean = value => {
      const str = String(value == null ? '' : value).slice(0,3000);
      return /^[=+@\-\t\r]/.test(str) ? "'" + str : str;
    };
    sheet.appendRow([
      key, clean(data.receivedAt), clean(data.name), clean(data.email),
      clean(data.phone), clean(data.doctor), clean(data.date), clean(data.time),
      clean(data.note), 'New', '', '', 'Sent', 'Pending', clean(data.source),
    ]);
    return json_({ok:true});
  } catch (error) {
    console.error(error);
    return json_({ok:false,error:'internal'});
  } finally {
    lock.releaseLock();
  }
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
