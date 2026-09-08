/**
 * Backup.gs — weekly snapshot of the spreadsheet (and slip evidence) into a
 * restricted Drive folder, keeping the newest N copies.
 *
 * A copy inside the same Google account protects against bad edits and
 * accidental deletes. It does NOT protect against losing the account itself —
 * see docs/backup-restore.md for the off-account copy.
 */

function backupRun() {
  var folderId = getConfig('BACKUP_FOLDER_ID');
  if (!folderId) { Logger.log('BACKUP_FOLDER_ID not set — skipped'); return { ok: false, code: 'NO_FOLDER' }; }
  var folder = DriveApp.getFolderById(folderId);
  var file = DriveApp.getFileById(getConfig('SPREADSHEET_ID', true));
  var name = 'household-expense-backup-' + Utilities.formatDate(timeNow_(), timeZone_(), 'yyyy-MM-dd-HHmm');
  var copy = file.makeCopy(name, folder);
  backupPrune_(folder);
  Logger.log('backup created: ' + name);
  return { ok: true, name: name, id: copy.getId ? copy.getId() : '' };
}

function backupPrune_(folder) {
  var keep = getConfigInt('BACKUP_KEEP_COUNT');
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (String(f.getName()).indexOf('household-expense-backup-') === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(keep).forEach(function (f) {
    Logger.log('pruning old backup: ' + f.getName());
    f.setTrashed(true);
  });
}

/**
 * Verification helper: counts and totals per month for the CURRENT spreadsheet.
 * Run the same function against a restored copy (set SPREADSHEET_ID to the
 * copy in a scratch project) and compare the two outputs line by line.
 */
function backupFingerprint() {
  var byMonth = {};
  txActiveCommitted().forEach(function (r) {
    var m = timeMonthOf(r.occurred_date);
    if (!byMonth[m]) byMonth[m] = { count: 0, net: 0 };
    byMonth[m].count++;
    if (r.type === 'expense') byMonth[m].net += Number(r.amount_satang);
    else if (r.type === 'refund') byMonth[m].net -= Number(r.amount_satang);
  });
  var lines = Object.keys(byMonth).sort().map(function (m) {
    return m + '\trows=' + byMonth[m].count + '\tnet=' + moneyToDecimalString(byMonth[m].net);
  });
  lines.push('TOTAL_ROWS\t' + txAll().length);
  lines.push('ATTACHMENTS\t' + repoReadAll('Attachments').rows.length);
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}
