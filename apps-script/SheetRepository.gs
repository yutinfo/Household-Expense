/**
 * SheetRepository.gs — the only module that talks to SpreadsheetApp for data.
 * Reads whole tabs with getValues() (one call) and caches per execution.
 * Writes use setValues() ranges. Text cells are always stored as literal
 * strings so a user message like "=1+1" can never become a formula.
 */

var SHEET_SCHEMA = {
  Transactions: ['transaction_id', 'event_id', 'item_index', 'batch_id', 'occurred_date', 'created_at', 'type', 'description', 'amount_satang', 'category_id', 'payer_member_id', 'recorder_member_id', 'status', 'revision', 'related_transaction_id', 'original_text', 'updated_at'],
  Categories: ['category_id', 'name', 'active', 'sort_order'],
  Rules: ['rule_id', 'pattern', 'match_type', 'category_id', 'priority', 'active', 'created_by', 'updated_at'],
  Members: ['member_id', 'line_user_id', 'display_name', 'aliases', 'active'],
  Budgets: ['month', 'category_id', 'limit_satang', 'warning_percent', 'updated_by', 'updated_at'],
  Inbox: ['event_id', 'status', 'expected_item_count', 'lease_until', 'attempts', 'received_at', 'completed_at', 'last_error_code', 'payload_json', 'result_json'],
  PendingActions: ['action_id', 'event_id', 'owner_user_id', 'group_id', 'action_type', 'payload_json', 'expected_revision', 'expires_at', 'status', 'created_at', 'resolved_at'],
  AuditLog: ['audit_id', 'action_id', 'transaction_id', 'actor_id', 'action', 'before_json', 'after_json', 'created_at'],
  Notifications: ['notification_key', 'period', 'category_id', 'threshold', 'status', 'sent_at'],
  Usage: ['date', 'provider', 'model', 'request_count', 'input_tokens', 'output_tokens', 'estimated_cost_usd'],
  Onboarding: ['code', 'member_id', 'expires_at', 'used_by', 'used_at', 'status'],
  Attachments: ['attachment_id', 'line_message_id', 'event_id', 'uploader_member_id', 'drive_file_id', 'drive_url', 'mime_type', 'content_hash', 'document_type', 'ocr_status', 'extracted_json', 'created_at', 'expires_at'],
  TransactionAttachments: ['transaction_id', 'attachment_id', 'linked_by', 'linked_at'],
  Dashboard: []
};

var SHEET_NUMERIC_COLUMNS = {
  Transactions: ['item_index', 'amount_satang', 'revision'],
  Categories: ['sort_order'],
  Rules: ['priority'],
  Budgets: ['limit_satang', 'warning_percent'],
  Inbox: ['expected_item_count', 'attempts'],
  PendingActions: ['expected_revision'],
  Notifications: ['threshold'],
  Usage: ['request_count', 'input_tokens', 'output_tokens', 'estimated_cost_usd']
};

var __repoCache = {};
var __repoSpreadsheet = null;

function repoSpreadsheet_() {
  if (__repoSpreadsheet) return __repoSpreadsheet;
  var id = getConfig('SPREADSHEET_ID', true);
  __repoSpreadsheet = SpreadsheetApp.openById(id);
  return __repoSpreadsheet;
}

function repoInvalidate(name) {
  if (name) delete __repoCache[name]; else __repoCache = {};
}

function repoResetConnection_() { __repoSpreadsheet = null; __repoCache = {}; }

function repoGetSheet(name) {
  var ss = repoSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('SHEET_MISSING:' + name);
  return sh;
}

/** Forces a value to be stored as literal text if it starts with formula chars. */
function repoSanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = String(v);
  if (/^[=+\-@'\t\r]/.test(s)) return "'" + s; // leading apostrophe stores literal text in Sheets
  return s;
}

function repoRestoreCell_(v) {
  if (typeof v === 'string' && v.charAt(0) === "'") return v.slice(1);
  return v;
}

function repoCoerce_(name, header, v) {
  var numeric = (SHEET_NUMERIC_COLUMNS[name] || []).indexOf(header) >= 0;
  if (v === '' || v === null || v === undefined) return numeric ? 0 : '';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  var s = repoRestoreCell_(String(v));
  if (numeric) {
    var n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  return s;
}

/** Returns {headers, rows:[{...fields, _row: sheetRowNumber}]} */
function repoReadAll(name) {
  if (__repoCache[name]) return __repoCache[name];
  var sh = repoGetSheet(name);
  var lastRow = sh.getLastRow();
  var headers = SHEET_SCHEMA[name];
  var rows = [];
  if (lastRow >= 2 && headers.length) {
    var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      var empty = true;
      var obj = { _row: i + 2 };
      for (var c = 0; c < headers.length; c++) {
        var v = r[c];
        if (v !== '' && v !== null && v !== undefined) empty = false;
        obj[headers[c]] = repoCoerce_(name, headers[c], v);
      }
      if (!empty) rows.push(obj);
    }
  }
  var result = { headers: headers, rows: rows };
  __repoCache[name] = result;
  return result;
}

function repoFindOne(name, field, value) {
  var rows = repoReadAll(name).rows;
  for (var i = 0; i < rows.length; i++) if (rows[i][field] === value) return rows[i];
  return null;
}

function repoFilter(name, predicate) {
  return repoReadAll(name).rows.filter(predicate);
}

function repoToRowArray_(name, obj) {
  return SHEET_SCHEMA[name].map(function (h) { return repoSanitizeCell_(obj[h]); });
}

/** Appends objects as rows in one setValues call. Returns the new row numbers. */
function repoAppendRows(name, objects) {
  if (!objects || !objects.length) return [];
  var sh = repoGetSheet(name);
  var headers = SHEET_SCHEMA[name];
  var data = objects.map(function (o) { return repoToRowArray_(name, o); });
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, data.length, headers.length).setValues(data);
  repoInvalidate(name);
  return data.map(function (_, i) { return start + i; });
}

/** Updates the given fields on a row (by sheet row number). */
function repoUpdateRow(name, rowNumber, fields) {
  var sh = repoGetSheet(name);
  var headers = SHEET_SCHEMA[name];
  var current = sh.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(fields, h)) current[i] = repoSanitizeCell_(fields[h]);
  });
  sh.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
  repoInvalidate(name);
}

/** Updates the first row where field === value. Returns true if found. */
function repoUpdateWhere(name, field, value, fields) {
  var row = repoFindOne(name, field, value);
  if (!row) return false;
  repoUpdateRow(name, row._row, fields);
  return true;
}

function repoDeleteRows(name, rowNumbers) {
  if (!rowNumbers.length) return;
  var sh = repoGetSheet(name);
  rowNumbers.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  repoInvalidate(name);
}

/** Runs fn while holding the script lock. Never call AI or slow network inside. */
function repoWithLock(fn) {
  var lock = LockService.getScriptLock();
  var waitMs = getConfigInt('LOCK_WAIT_MS');
  if (!lock.tryLock(waitMs)) throw new Error('LOCK_TIMEOUT');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
