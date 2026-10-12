// Install as a Web App, execute as owner. Set OFFER_SHEET_WEBHOOK_TOKEN
// in Script Properties and set the same secret on the Medicross server.
// No patient data is returned by this endpoint.
function doPost(e) {
  function result(value) {
    return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
  }
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (_) { return result({ok:false}); }
  var expected = PropertiesService.getScriptProperties().getProperty('OFFER_SHEET_WEBHOOK_TOKEN');
  if (!expected || expected.length < 32 || data.token !== expected) return result({ok:false});
  if (!/^[0-9a-f-]{36}$/i.test(data.id || '')) return result({ok:false});
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var book = SpreadsheetApp.openById('1gTrIf8GaQJTY9EQNiPwCXKwk6XeA4BsZL1n_plaemh4');
    var sheet = book.getSheetByName('Cereri site') || book.insertSheet('Cereri site');
    var headers = ['ID cerere','Data','Nume','Telefon','E-mail','Ofertă','Mesaj și detalii','Pagina'];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.setColumnWidths(1,8,180);
      sheet.setColumnWidth(7,380);
    }
    if (sheet.getLastRow() > 1 && sheet.getRange(2,1,sheet.getLastRow()-1,1)
      .createTextFinder(data.id).matchEntireCell(true).findNext()) return result({ok:true,id:data.id});
    // Prefix formula-like input and keep phones as text, including leading +/0.
    function literal(value) {
      var text = String(value || '').slice(0,6000);
      return /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
    }
    var next = sheet.getLastRow()+1;
    sheet.getRange(next,1,1,8).setNumberFormat('@').setValues([[
      literal(data.id),literal(data.createdAt),literal(data.name),literal(data.phone),
      literal(data.email),literal(data.procedure),literal(data.message),literal(data.sourcePage)
    ]]);
    SpreadsheetApp.flush();
    return result({ok:true,id:data.id});
  } finally { lock.releaseLock(); }
}
