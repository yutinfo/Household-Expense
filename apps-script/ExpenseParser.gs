/**
 * ExpenseParser.gs — deterministic Thai/English expense parsing (no AI).
 *
 * Contract: the parser NEVER guesses money. If the amounts cannot be paired
 * with descriptions unambiguously, it returns a clarify result and the router
 * asks the user instead of writing anything.
 */

var PLAN_WORDS = ['ว่าจะ', 'อยากซื้อ', 'กะว่า', 'คิดจะ', 'จะซื้อ', 'เดี๋ยวซื้อ', 'พรุ่งนี้จะ', 'วางแผน', 'น่าจะซื้อ', 'อยากได้', 'ถ้าซื้อ', 'planning', 'จะจ่าย'];
var QUESTION_WORDS = ['เท่าไหร่', 'เท่าไร', 'กี่บาท', 'เหลือเท่า', 'ใครจ่าย', '?', 'ไหม', 'มั้ย', 'หรือเปล่า', 'สรุป'];
var REFUND_WORDS = ['ได้เงินคืน', 'เงินคืน', 'คืนเงิน', 'คืนของ', 'refund', 'รีฟันด์', 'ยกเลิกออเดอร์ได้เงิน'];
var INCOME_WORDS = ['เงินเดือน', 'โบนัส', 'รายรับ', 'เงินเข้า', 'ได้รับเงิน', 'ขายของได้', 'ค่าจ้าง', 'ดอกเบี้ย'];
var TRANSFER_WORDS = ['โอนให้', 'โอนเข้า', 'โอนไป', 'ยืมเงิน', 'คืนหนี้ให้', 'transfer', 'โอนกลับ'];
var PAYER_MARKERS = ['จ่าย', 'ออกให้', 'ออกเงิน', 'เป็นคนจ่าย', 'จ่ายเอง'];

var THAI_NUM_WORDS = { 'ศูนย์': 0, 'หนึ่ง': 1, 'เอ็ด': 1, 'สอง': 2, 'ยี่': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5, 'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9 };
var THAI_NUM_SCALES = [['ล้าน', 1000000], ['แสน', 100000], ['หมื่น', 10000], ['พัน', 1000], ['ร้อย', 100], ['สิบ', 10]];

/**
 * Converts a Thai number phrase ("ห้าพัน", "สองร้อยห้าสิบ") to a number.
 * Returns null when the phrase is not a clean multiplicative number.
 */
function parseThaiNumberWords(text) {
  var s = String(text || '').trim();
  if (!s) return null;
  if (!/^[ก-๙]+$/.test(s)) return null;
  var total = 0;
  var rest = s;
  var matchedAny = false;
  for (var i = 0; i < THAI_NUM_SCALES.length; i++) {
    var scaleWord = THAI_NUM_SCALES[i][0];
    var scaleVal = THAI_NUM_SCALES[i][1];
    var idx = rest.indexOf(scaleWord);
    if (idx < 0) continue;
    var head = rest.slice(0, idx);
    var mult;
    if (head === '') mult = 1;
    else if (THAI_NUM_WORDS[head] !== undefined) mult = THAI_NUM_WORDS[head];
    else return null; // compound we do not understand — refuse rather than guess
    if (scaleVal === 10 && head === 'ยี่') mult = 2;
    total += mult * scaleVal;
    matchedAny = true;
    rest = rest.slice(idx + scaleWord.length);
  }
  if (rest) {
    if (THAI_NUM_WORDS[rest] === undefined) return null;
    total += THAI_NUM_WORDS[rest];
    matchedAny = true;
  }
  return matchedAny ? total : null;
}

/** Finds numeric amounts with their positions. */
function parseFindAmounts_(text) {
  var out = [];
  var re = /\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var raw = m[0];
    var satang = moneyParseToSatang(raw);
    if (satang === null || satang <= 0) continue;
    out.push({ raw: raw, start: m.index, end: m.index + raw.length, satang: satang, source: 'digits' });
  }
  return out;
}

/** Finds Thai-word amounts ("ห้าพัน") when no digits carry the money. */
function parseFindThaiWordAmounts_(text) {
  var out = [];
  var re = /(ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?(ล้าน|แสน|หมื่น|พัน|ร้อย|สิบ)+[ก-๙]*/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var phrase = m[0];
    // trim trailing "บาท" or other words that are not part of the number
    var trimmed = phrase.replace(/(บาท|ถ้วน)$/, '');
    var n = parseThaiNumberWords(trimmed);
    if (n === null || n <= 0) continue;
    out.push({ raw: phrase, start: m.index, end: m.index + phrase.length, satang: n * 100, source: 'thai_words' });
  }
  return out;
}

/** Strips currency words that trail an amount so descriptions stay clean. */
function parseCleanDescription_(text) {
  return String(text || '')
    .replace(/[฿]/g, ' ')
    .replace(/(บาท|บ\.|baht|thb)/gi, ' ')
    .replace(/^[\s,.\-–—:/]+|[\s,.\-–—:/]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Detects a date expression and returns {date, ambiguous, label, start, end} or null. */
function parseFindDate_(text, todayISO) {
  var t = text;
  var rel = [
    { words: ['วันนี้', 'เมื่อเช้า', 'เมื่อกี้', 'เมื่อกี๊', 'ตอนเช้า', 'เที่ยงนี้', 'เย็นนี้'], days: 0 },
    { words: ['เมื่อวานซืน', 'วานซืน'], days: -2 },
    { words: ['เมื่อวาน', 'เมื่อวานนี้', 'วานนี้'], days: -1 }
  ];
  for (var i = 0; i < rel.length; i++) {
    for (var j = 0; j < rel[i].words.length; j++) {
      var w = rel[i].words[j];
      var idx = t.indexOf(w);
      if (idx >= 0) {
        return { date: timeAddDays(todayISO, rel[i].days), ambiguous: false, label: w, start: idx, end: idx + w.length };
      }
    }
  }
  // dd/mm or dd/mm/yyyy
  var m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m) {
    var day = parseInt(m[1], 10);
    var mon = parseInt(m[2], 10);
    var yr = m[3] ? parseInt(m[3], 10) : parseInt(todayISO.slice(0, 4), 10);
    if (yr < 100) yr += 2000;
    if (yr > 2400) yr -= 543; // Buddhist era
    var iso = yr + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
    if (!timeIsValidDateISO(iso)) return { date: null, ambiguous: true, label: m[0], start: m.index, end: m.index + m[0].length };
    return { date: iso, ambiguous: false, label: m[0], start: m.index, end: m.index + m[0].length };
  }
  // "5 ก.ย." / "5 กันยายน"
  var monthNames = Object.keys(THAI_MONTHS).sort(function (a, b) { return b.length - a.length; });
  for (var k = 0; k < monthNames.length; k++) {
    var name = monthNames[k];
    var pos = t.indexOf(name);
    if (pos < 0) continue;
    var before = t.slice(Math.max(0, pos - 6), pos);
    var dm = before.match(/(\d{1,2})\s*$/);
    if (!dm) continue;
    var mn = THAI_MONTHS[name];
    var after = t.slice(pos + name.length, pos + name.length + 6);
    var ym = after.match(/^\s*(\d{2,4})/);
    var year = ym ? parseInt(ym[1], 10) : parseInt(todayISO.slice(0, 4), 10);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    var iso2 = year + '-' + ('0' + mn).slice(-2) + '-' + ('0' + parseInt(dm[1], 10)).slice(-2);
    var startPos = pos - dm[0].length;
    var endPos = pos + name.length + (ym ? ym[0].length : 0);
    if (!timeIsValidDateISO(iso2)) return { date: null, ambiguous: true, label: t.slice(startPos, endPos), start: startPos, end: endPos };
    return { date: iso2, ambiguous: false, label: t.slice(startPos, endPos), start: startPos, end: endPos };
  }
  // "วันที่ 5" — month is missing, so this is ambiguous by design
  var dm2 = t.match(/วันที่\s*(\d{1,2})(?!\d)/);
  if (dm2) {
    return { date: null, ambiguous: true, label: dm2[0], start: dm2.index, end: dm2.index + dm2[0].length, dayOnly: parseInt(dm2[1], 10) };
  }
  return null;
}

/** Detects an explicit payer mention such as "เมียจ่าย" / "ยุทธออกให้". */
function parseFindPayer_(text) {
  var idx = memberAliasIndex();
  for (var i = 0; i < idx.length; i++) {
    var alias = idx[i].alias;
    if (!alias) continue;
    var pos = text.toLowerCase().indexOf(alias.toLowerCase());
    if (pos < 0) continue;
    var after = text.slice(pos + alias.length, pos + alias.length + 12);
    for (var j = 0; j < PAYER_MARKERS.length; j++) {
      if (after.indexOf(PAYER_MARKERS[j]) === 0 || after.replace(/^\s+/, '').indexOf(PAYER_MARKERS[j]) === 0) {
        var endPos = pos + alias.length + after.indexOf(PAYER_MARKERS[j]) + PAYER_MARKERS[j].length;
        return { member: idx[i].member, start: pos, end: endPos, label: text.slice(pos, endPos) };
      }
    }
  }
  return null;
}

/** Detects a transfer counterpart such as "โอนให้เมีย". */
function parseFindTransferTarget_(text) {
  for (var t = 0; t < TRANSFER_WORDS.length; t++) {
    var w = TRANSFER_WORDS[t];
    var pos = text.indexOf(w);
    if (pos < 0) continue;
    var tail = text.slice(pos + w.length);
    var idx = memberAliasIndex();
    for (var i = 0; i < idx.length; i++) {
      var alias = idx[i].alias;
      if (tail.toLowerCase().indexOf(alias.toLowerCase()) === 0 || tail.replace(/^\s+/, '').toLowerCase().indexOf(alias.toLowerCase()) === 0) {
        return { keyword: w, member: idx[i].member, start: pos };
      }
    }
    return { keyword: w, member: null, start: pos };
  }
  return null;
}

function parseHasPlanWord_(text) {
  for (var i = 0; i < PLAN_WORDS.length; i++) if (text.indexOf(PLAN_WORDS[i]) >= 0) return PLAN_WORDS[i];
  return null;
}

function parseHasQuestionWord_(text) {
  for (var i = 0; i < QUESTION_WORDS.length; i++) if (text.indexOf(QUESTION_WORDS[i]) >= 0) return QUESTION_WORDS[i];
  return null;
}

/** Counts how many distinct rule patterns the description matches (2+ = likely multiple items). */
function parseCountItemSignals_(desc) {
  var t = String(desc || '').toLowerCase();
  var seen = {};
  var count = 0;
  ruleActiveList().forEach(function (r) {
    if (Number(r.priority) < 90) return; // only strong item words count as separate items
    if (!ruleMatches_(r, t)) return;
    var p = String(r.pattern).toLowerCase();
    // skip patterns contained in an already-counted longer pattern
    var dup = Object.keys(seen).some(function (s) { return s.indexOf(p) >= 0 || p.indexOf(s) >= 0; });
    if (dup) return;
    seen[p] = true;
    count++;
  });
  return count;
}

/**
 * Main entry. ctx = { recorderMemberId, todayISO }
 * Returns one of:
 *  { kind:'none', reason }
 *  { kind:'clarify', code, question, data }
 *  { kind:'items', items:[draft], unknownCategoryIndexes:[i] }
 */
function parseMessage(rawText, ctx) {
  var text = moneyNormalizeDigits(String(rawText || '')).trim();
  if (!text) return { kind: 'none', reason: 'EMPTY' };
  var todayISO = ctx.todayISO || timeTodayISO();

  var plan = parseHasPlanWord_(text);
  if (plan) return { kind: 'none', reason: 'PLAN', matched: plan };

  var amounts = parseFindAmounts_(text);
  if (!amounts.length) amounts = parseFindThaiWordAmounts_(text);
  if (!amounts.length) return { kind: 'none', reason: 'NO_AMOUNT' };

  // A question that also contains a number ("เดือนนี้ค่าอาหารเท่าไหร่") is not an expense.
  var q = parseHasQuestionWord_(text);
  if (q) return { kind: 'none', reason: 'QUESTION', matched: q };

  var dateInfo = parseFindDate_(text, todayISO);
  if (dateInfo && dateInfo.ambiguous) {
    return {
      kind: 'clarify',
      code: 'AMBIGUOUS_DATE',
      question: 'ระบุวันที่ให้ชัดหน่อยครับ ("' + dateInfo.label + '" ยังไม่ชัด) เช่น 05/09/2026 หรือพิมพ์ "วันนี้"',
      data: { text: rawText }
    };
  }
  var occurredDate = dateInfo && dateInfo.date ? dateInfo.date : todayISO;
  if (occurredDate > todayISO) {
    return {
      kind: 'clarify',
      code: 'FUTURE_DATE',
      question: 'วันที่ ' + occurredDate + ' เป็นอนาคต ยังไม่บันทึกครับ ถ้าจ่ายแล้ววันนี้พิมพ์ "วันนี้" หรือระบุวันที่ที่จ่ายจริง',
      data: { text: rawText }
    };
  }

  // Remove the date phrase from the text used for descriptions.
  var working = text;
  var offsets = [];
  if (dateInfo && dateInfo.start !== undefined && dateInfo.end !== undefined) {
    offsets.push({ start: dateInfo.start, end: dateInfo.end });
  }

  var payerInfo = parseFindPayer_(text);
  var payerMemberId = payerInfo ? payerInfo.member.member_id : ctx.recorderMemberId;
  if (payerInfo) offsets.push({ start: payerInfo.start, end: payerInfo.end });

  var transferInfo = parseFindTransferTarget_(text);
  var refundWord = null;
  for (var i = 0; i < REFUND_WORDS.length; i++) if (text.indexOf(REFUND_WORDS[i]) >= 0) { refundWord = REFUND_WORDS[i]; break; }
  // Refund wins: "ได้เงินคืน" contains money-in wording but is a negative expense.
  var incomeWord = null;
  if (!refundWord) {
    for (var n = 0; n < INCOME_WORDS.length; n++) if (text.indexOf(INCOME_WORDS[n]) >= 0) { incomeWord = INCOME_WORDS[n]; break; }
  }

  // Blank out date/payer spans so they never leak into a description.
  function blankOut(s, spans) {
    var chars = s.split('');
    spans.forEach(function (sp) {
      for (var i = sp.start; i < sp.end && i < chars.length; i++) chars[i] = ' ';
    });
    return chars.join('');
  }
  working = blankOut(working, offsets);

  // ---- income ---------------------------------------------------------------
  // Money coming in. Carries no category, so it never lands in a spending
  // total, a category breakdown, or a budget.
  if (incomeWord && !transferInfo) {
    if (amounts.length !== 1) {
      return { kind: 'clarify', code: 'INCOME_MULTI_AMOUNT', question: 'รายรับมีหลายจำนวนเงินในข้อความเดียว แยกพิมพ์ทีละรายการครับ', data: { text: rawText } };
    }
    var inDesc = parseCleanDescription_(working.replace(/\d[\d,]*(\.\d{1,2})?/g, ' '));
    return {
      kind: 'items',
      items: [{
        type: 'income',
        amount_satang: amounts[0].satang,
        description: inDesc || incomeWord,
        category_id: '',
        category_source: 'income',
        occurred_date: occurredDate,
        payer_member_id: payerMemberId,
        recorder_member_id: ctx.recorderMemberId,
        original_text: rawText
      }],
      unknownCategoryIndexes: []
    };
  }

  // ---- transfer -------------------------------------------------------------
  if (transferInfo && !refundWord) {
    if (amounts.length !== 1) {
      return { kind: 'clarify', code: 'TRANSFER_MULTI_AMOUNT', question: 'การโอนมีหลายจำนวนเงินในข้อความเดียว ระบุยอดที่โอนจริงครับ', data: { text: rawText } };
    }
    var tDesc = parseCleanDescription_(working.replace(/\d[\d,]*(\.\d{1,2})?/g, ' '));
    return {
      kind: 'items',
      items: [{
        type: 'transfer',
        amount_satang: amounts[0].satang,
        description: tDesc || (transferInfo.member ? 'โอนให้' + transferInfo.member.display_name : 'โอนภายใน'),
        category_id: '',
        category_source: 'transfer',
        occurred_date: occurredDate,
        payer_member_id: ctx.recorderMemberId,
        recorder_member_id: ctx.recorderMemberId,
        original_text: rawText
      }],
      unknownCategoryIndexes: []
    };
  }

  var type = refundWord ? 'refund' : 'expense';

  // ---- amount/description pairing ------------------------------------------
  // Build a segment per amount: text between the previous amount and this one.
  var segments = [];
  var cursor = 0;
  amounts.forEach(function (a, i) {
    var before = working.slice(cursor, a.start);
    var after = i === amounts.length - 1 ? working.slice(a.end) : '';
    segments.push({ amount: a, before: parseCleanDescription_(before), after: parseCleanDescription_(after) });
    cursor = a.end;
  });

  // "รวม 145" style: a single amount labelled as a total for several items.
  var totalMarker = /(รวม|ทั้งหมด|total|รวมเป็น|ราคารวม)\s*$/;
  if (amounts.length === 1) {
    var seg = segments[0];
    var desc0 = seg.before || seg.after;
    var looksTotal = totalMarker.test(seg.before);
    var signals = parseCountItemSignals_(desc0);
    if (looksTotal && signals >= 2) {
      return {
        kind: 'clarify',
        code: 'TOTAL_NEEDS_SPLIT',
        question: 'ข้อความมีหลายรายการแต่บอกยอดรวมอย่างเดียว ช่วยแยกยอดให้หน่อยครับ เช่น "กาแฟ 65 ข้าว 80" หรือพิมพ์ "รวมเป็นรายการเดียว" เพื่อบันทึกก้อนเดียว',
        data: { text: rawText, total_satang: seg.amount.satang }
      };
    }
  }

  var items = [];
  var unknown = [];
  for (var s = 0; s < segments.length; s++) {
    var sg = segments[s];
    var desc = sg.before;
    if (!desc && sg.after) desc = sg.after;
    desc = parseCleanDescription_(desc.replace(totalMarker, ''));
    if (!desc) {
      return {
        kind: 'clarify',
        code: 'AMOUNT_WITHOUT_DESCRIPTION',
        question: 'ยอด ' + moneyFormatBaht(sg.amount.satang) + ' ยังไม่รู้ว่าเป็นค่าอะไรครับ ช่วยพิมพ์ชื่อรายการด้วย',
        data: { text: rawText, amount_satang: sg.amount.satang }
      };
    }
    var match = categoryMatch(desc);
    var item = {
      type: type,
      amount_satang: sg.amount.satang,
      description: desc,
      category_id: match ? match.category_id : '',
      category_source: match ? ('rule:' + match.rule_id) : 'unknown',
      occurred_date: occurredDate,
      payer_member_id: payerMemberId,
      recorder_member_id: ctx.recorderMemberId,
      original_text: rawText
    };
    if (!match) unknown.push(s);
    items.push(item);
  }

  return { kind: 'items', items: items, unknownCategoryIndexes: unknown };
}
