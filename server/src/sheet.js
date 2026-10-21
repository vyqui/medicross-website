/* Google Sheets delivery through the Apps Script web app (integrations/opd-google-sheet.gs).
   Same webhook for OPD requests and general leads; the row's `kind` picks the tab.
   Never throws: callers must not depend on Sheets being reachable. */
export function sheetConfigured() {
  return Boolean(process.env.OPD_SHEET_WEBHOOK_URL && process.env.OPD_SHEET_WEBHOOK_SECRET);
}

export async function postToSheet(row, log) {
  if (!sheetConfigured()) return false;
  try {
    const response = await fetch(process.env.OPD_SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: process.env.OPD_SHEET_WEBHOOK_SECRET, ...row }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Sheet webhook HTTP ' + response.status);
    const receipt = await response.json();
    if (!receipt.ok) throw new Error('Sheet webhook rejected request: ' + (receipt.error || 'unknown'));
    return true;
  } catch (err) {
    log?.error({ err }, 'spreadsheet synchronization failed');
    return false;
  }
}
