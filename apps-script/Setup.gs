/**
 * Setup.gs — idempotent spreadsheet bootstrap.
 * Run setupSpreadsheet() from the editor. Safe to run repeatedly: it only adds
 * missing tabs/headers/seed rows, never deletes or overwrites existing data.
 */

var DEFAULT_CATEGORIES = [
  ['food', 'อาหาร', 10],
  ['home', 'ของใช้และตกแต่งบ้าน', 20],
  ['child', 'ลูก', 30],
  ['travel', 'เดินทาง', 40],
  ['bills', 'บิลประจำ', 50],
  ['health', 'สุขภาพ', 60],
  ['personal', 'ส่วนตัว', 70],
  ['other', 'อื่น ๆ', 80]
];

/**
 * Seed rules. priority: higher wins. Item/food words (100) beat store names (50)
 * so "กินข้าวที่อีเกีย" is food even though "อีเกีย" maps to home.
 */
var DEFAULT_RULES = [
  // food
  ['ส้มตำ', 'contains', 'food', 100], ['ข้าว', 'contains', 'food', 100], ['กาแฟ', 'contains', 'food', 100],
  ['กิน', 'contains', 'food', 100], ['อาหาร', 'contains', 'food', 100], ['ก๋วยเตี๋ยว', 'contains', 'food', 100],
  ['ขนม', 'contains', 'food', 100], ['น้ำ', 'contains', 'food', 90], ['ชา', 'contains', 'food', 90],
  ['บุฟเฟ่ต์', 'contains', 'food', 100], ['หมูกระทะ', 'contains', 'food', 100], ['ชาบู', 'contains', 'food', 100],
  ['pizza', 'contains', 'food', 100], ['พิซซ่า', 'contains', 'food', 100], ['kfc', 'contains', 'food', 100],
  ['mk', 'word', 'food', 100], ['ผลไม้', 'contains', 'food', 100], ['ตลาด', 'contains', 'food', 80],
  ['7-11', 'contains', 'food', 70], ['เซเว่น', 'contains', 'food', 70], ['เบเกอรี่', 'contains', 'food', 100],
  ['มื้อ', 'contains', 'food', 100], ['เที่ยง', 'contains', 'food', 90], ['เย็น', 'contains', 'food', 80], ['เช้า', 'contains', 'food', 80],
  // home
  ['อีเกีย', 'contains', 'home', 50], ['ikea', 'contains', 'home', 50], ['ของใช้', 'contains', 'home', 60],
  ['ตกแต่ง', 'contains', 'home', 60], ['โฮมโปร', 'contains', 'home', 50], ['homepro', 'contains', 'home', 50],
  ['เฟอร์นิเจอร์', 'contains', 'home', 60], ['โต๊ะ', 'contains', 'home', 60], ['เก้าอี้', 'contains', 'home', 60],
  ['ผงซักฟอก', 'contains', 'home', 60], ['น้ำยา', 'contains', 'home', 60], ['ทิชชู่', 'contains', 'home', 60],
  ['ห้อง', 'contains', 'home', 55], ['บ้าน', 'contains', 'home', 55], ['โลตัส', 'contains', 'home', 40], ['บิ๊กซี', 'contains', 'home', 40],
  // child
  ['ผ้าอ้อม', 'contains', 'child', 100], ['ลูก', 'contains', 'child', 70], ['นมผง', 'contains', 'child', 100],
  ['ของเล่น', 'contains', 'child', 100], ['ค่าเทอม', 'contains', 'child', 100], ['โรงเรียน', 'contains', 'child', 90],
  // travel
  ['น้ำมัน', 'contains', 'travel', 100], ['เติมน้ำมัน', 'contains', 'travel', 110], ['แท็กซี่', 'contains', 'travel', 100],
  ['grab', 'contains', 'travel', 90], ['แกร็บ', 'contains', 'travel', 90], ['bts', 'contains', 'travel', 100],
  ['mrt', 'contains', 'travel', 100], ['รถไฟฟ้า', 'contains', 'travel', 100], ['ค่ารถ', 'contains', 'travel', 100],
  ['ทางด่วน', 'contains', 'travel', 100], ['ที่จอดรถ', 'contains', 'travel', 100], ['จอดรถ', 'contains', 'travel', 100],
  ['ค่าเดินทาง', 'contains', 'travel', 100], ['วินมอไซ', 'contains', 'travel', 100], ['ตั๋ว', 'contains', 'travel', 80],
  // bills
  ['ค่าไฟ', 'contains', 'bills', 100], ['ค่าน้ำ', 'contains', 'bills', 100], ['ค่าเน็ต', 'contains', 'bills', 100],
  ['อินเทอร์เน็ต', 'contains', 'bills', 100], ['ค่าโทรศัพท์', 'contains', 'bills', 100], ['ค่ามือถือ', 'contains', 'bills', 100],
  ['ค่าเช่า', 'contains', 'bills', 100], ['ค่าส่วนกลาง', 'contains', 'bills', 100], ['ประกัน', 'contains', 'bills', 90],
  ['netflix', 'contains', 'bills', 100], ['ผ่อน', 'contains', 'bills', 90],
  // health
  ['หมอ', 'contains', 'health', 100], ['ยา', 'word', 'health', 90], ['โรงพยาบาล', 'contains', 'health', 100],
  ['คลินิก', 'contains', 'health', 100], ['ฟัน', 'contains', 'health', 100], ['ร้านยา', 'contains', 'health', 100],
  ['วิตามิน', 'contains', 'health', 100],
  // personal
  ['ตัดผม', 'contains', 'personal', 100], ['เสื้อ', 'contains', 'personal', 90], ['รองเท้า', 'contains', 'personal', 90],
  ['เครื่องสำอาง', 'contains', 'personal', 100], ['หนัง', 'contains', 'personal', 80], ['เกม', 'contains', 'personal', 80]
];

function setupSpreadsheet() {
  var ss = repoSpreadsheet_();
  var created = [];
  Object.keys(SHEET_SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      created.push(name);
    }
    var headers = SHEET_SCHEMA[name];
    if (headers.length) {
      var existing = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, headers.length).getValues()[0] : [];
      var needsHeader = false;
      for (var i = 0; i < headers.length; i++) if (existing[i] !== headers[i]) needsHeader = true;
      if (needsHeader) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      setupFormatSheet_(sh, name, headers);
    }
  });
  repoInvalidate();
  setupSeedCategories_();
  setupSeedRules_();
  setupProtections_();
  try { ss.setSpreadsheetTimeZone(getConfig('TIMEZONE')); } catch (e) { /* not available in all contexts */ }
  var ssDefault = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (ssDefault && ssDefault.getLastRow() === 0 && ss.getSheets().length > 1) {
    try { ss.deleteSheet(ssDefault); } catch (e) { /* ignore */ }
  }
  Logger.log('setupSpreadsheet done. created tabs: ' + (created.join(', ') || 'none'));
  return created;
}

function setupFormatSheet_(sh, name, headers) {
  try {
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    var numeric = SHEET_NUMERIC_COLUMNS[name] || [];
    numeric.forEach(function (col) {
      var idx = headers.indexOf(col) + 1;
      if (idx > 0) sh.getRange(2, idx, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat(col === 'estimated_cost_usd' ? '0.000000' : '0');
    });
    // Everything else is plain text so dates/ids/descriptions are never auto-converted.
    headers.forEach(function (h, i) {
      if (numeric.indexOf(h) < 0) sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    });
    if (name === 'Transactions') {
      var typeIdx = headers.indexOf('type') + 1;
      var statusIdx = headers.indexOf('status') + 1;
      var typeRule = SpreadsheetApp.newDataValidation().requireValueInList(['expense', 'refund', 'transfer'], true).setAllowInvalid(false).build();
      var statusRule = SpreadsheetApp.newDataValidation().requireValueInList(['active', 'void'], true).setAllowInvalid(false).build();
      sh.getRange(2, typeIdx, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(typeRule);
      sh.getRange(2, statusIdx, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);
    }
  } catch (e) {
    Logger.log('format skipped for ' + name + ': ' + e);
  }
}

function setupSeedCategories_() {
  var existing = repoReadAll('Categories').rows;
  var have = {};
  existing.forEach(function (r) { have[r.category_id] = true; });
  var add = DEFAULT_CATEGORIES.filter(function (c) { return !have[c[0]]; }).map(function (c) {
    return { category_id: c[0], name: c[1], active: 'true', sort_order: c[2] };
  });
  if (add.length) repoAppendRows('Categories', add);
}

function setupSeedRules_() {
  var existing = repoReadAll('Rules').rows;
  if (existing.length) return; // user may have edited rules; never re-seed over them
  var now = timeNowISO();
  var rows = DEFAULT_RULES.map(function (r, i) {
    return { rule_id: 'R' + ('0000' + (i + 1)).slice(-4), pattern: r[0], match_type: r[1], category_id: r[2], priority: r[3], active: 'true', created_by: 'seed', updated_at: now };
  });
  repoAppendRows('Rules', rows);
}

/** Warn-only protection on system tabs so accidental edits prompt a dialog. */
function setupProtections_() {
  var systemTabs = ['Inbox', 'PendingActions', 'AuditLog', 'Notifications', 'Usage', 'Onboarding'];
  var ss = repoSpreadsheet_();
  systemTabs.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    try {
      var protections = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if (protections && protections.length) return;
      sh.protect().setDescription('System tab — edit via bot only').setWarningOnly(true);
    } catch (e) {
      Logger.log('protect skipped for ' + name + ': ' + e);
    }
  });
  var tx = ss.getSheetByName('Transactions');
  if (tx) {
    try {
      var existing = tx.getProtections(SpreadsheetApp.ProtectionType.RANGE);
      if (!existing || !existing.length) {
        var sysCols = ['transaction_id', 'event_id', 'item_index', 'batch_id', 'created_at', 'revision'];
        sysCols.forEach(function (c) {
          var idx = SHEET_SCHEMA.Transactions.indexOf(c) + 1;
          tx.getRange(1, idx, tx.getMaxRows(), 1).protect().setDescription('System column: ' + c).setWarningOnly(true);
        });
      }
    } catch (e) {
      Logger.log('range protect skipped: ' + e);
    }
  }
}

/**
 * Adds a member row (run by the owner from the editor).
 * aliases: comma-separated nicknames used in messages, e.g. "เมีย,ภรรยา,แฟน".
 */
function setupAddMember(memberId, lineUserId, displayName, aliases) {
  if (repoFindOne('Members', 'member_id', memberId)) {
    repoUpdateWhere('Members', 'member_id', memberId, { line_user_id: lineUserId || '', display_name: displayName, aliases: aliases || '', active: 'true' });
  } else {
    repoAppendRows('Members', [{ member_id: memberId, line_user_id: lineUserId || '', display_name: displayName, aliases: aliases || '', active: 'true' }]);
  }
}
