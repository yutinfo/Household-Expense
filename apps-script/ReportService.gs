/**
 * ReportService.gs — all numbers come from committed, active rows only.
 * Reports always state the date range they cover and never claim to represent
 * spending that was not recorded.
 */

function reportRangeTotals(fromISO, toISO) {
  var rows = txInDateRange(txActiveCommitted(), fromISO, toISO);
  var byCategory = {};
  var byPayer = {};
  var expense = 0, refund = 0, transfer = 0, count = 0;
  rows.forEach(function (r) {
    if (r.type === 'transfer') { transfer += Number(r.amount_satang); return; }
    count++;
    var sign = r.type === 'refund' ? -1 : 1;
    if (r.type === 'expense') expense += Number(r.amount_satang); else refund += Number(r.amount_satang);
    byCategory[r.category_id] = (byCategory[r.category_id] || 0) + sign * Number(r.amount_satang);
    byPayer[r.payer_member_id] = (byPayer[r.payer_member_id] || 0) + sign * Number(r.amount_satang);
  });
  return {
    from: fromISO, to: toISO,
    net: expense - refund,
    expense: expense, refund: refund, transfer: transfer,
    count: count,
    byCategory: byCategory,
    byPayer: byPayer,
    rows: rows
  };
}

function reportMonthTotals(month) {
  var from = month + '-01';
  var to = month + '-' + ('0' + timeDaysInMonth(month)).slice(-2);
  var t = reportRangeTotals(from, to);
  t.month = month;
  return t;
}

function reportCategorySorted(byCategory) {
  return Object.keys(byCategory)
    .map(function (id) { return { category_id: id, name: categoryName(id), amount: byCategory[id] }; })
    .filter(function (c) { return c.amount !== 0; })
    .sort(function (a, b) { return b.amount - a.amount; });
}

function reportTextForRange(title, fromISO, toISO) {
  var t = reportRangeTotals(fromISO, toISO);
  var lines = [];
  lines.push('📊 ' + title + ' (' + timeThaiDateLabel(fromISO) + (fromISO === toISO ? '' : ' – ' + timeThaiDateLabel(toISO)) + ')');
  if (t.count === 0) {
    lines.push('ยังไม่มีรายการที่บันทึกในช่วงนี้ครับ');
    return lines.join('\n');
  }
  lines.push('รายจ่ายสุทธิ ' + moneyFormatBaht(t.net) + ' จาก ' + t.count + ' รายการที่บันทึก');
  if (t.refund > 0) lines.push('(รายจ่าย ' + moneyFormatBaht(t.expense) + ' หักเงินคืน ' + moneyFormatBaht(t.refund) + ')');
  reportCategorySorted(t.byCategory).forEach(function (c) {
    lines.push('• ' + c.name + ' ' + moneyFormatBaht(c.amount));
  });
  if (t.transfer > 0) lines.push('โอนภายในครอบครัว ' + moneyFormatBaht(t.transfer) + ' (ไม่นับเป็นรายจ่าย)');
  return lines.join('\n');
}

function reportToday(todayISO) {
  var d = todayISO || timeTodayISO();
  return reportTextForRange('สรุปวันนี้', d, d);
}

function reportThisMonth(month) {
  var m = month || timeCurrentMonth();
  var t = reportMonthTotals(m);
  var lines = [reportTextForRange('สรุปเดือน ' + timeThaiMonthLabel(m), t.from, t.to)];
  var budgetLines = budgetSummaryLines(m, t);
  if (budgetLines.length) lines.push(budgetLines.join('\n'));
  return lines.join('\n');
}

function reportCategoryInMonth(categoryId, month) {
  var m = month || timeCurrentMonth();
  var t = reportMonthTotals(m);
  var amount = t.byCategory[categoryId] || 0;
  var lines = ['📊 ' + categoryName(categoryId) + ' เดือน ' + timeThaiMonthLabel(m) + ': ' + moneyFormatBaht(amount)];
  var n = t.rows.filter(function (r) { return r.category_id === categoryId && r.type !== 'transfer'; }).length;
  lines.push('จาก ' + n + ' รายการที่บันทึก (' + timeThaiDateLabel(t.from) + ' – ' + timeThaiDateLabel(t.to) + ')');
  var b = budgetGet(m, categoryId);
  if (b) {
    var remain = Number(b.limit_satang) - amount;
    lines.push('งบ ' + moneyFormatBaht(b.limit_satang) + ' → ' + (remain >= 0 ? 'เหลือ ' + moneyFormatBaht(remain) : 'เกินงบ ' + moneyFormatBaht(-remain)));
  } else {
    lines.push('หมวดนี้ยังไม่ตั้งงบ');
  }
  return lines.join('\n');
}

function reportByPayer(month) {
  var m = month || timeCurrentMonth();
  var t = reportMonthTotals(m);
  if (t.count === 0) return 'เดือน ' + timeThaiMonthLabel(m) + ' ยังไม่มีรายการที่บันทึกครับ';
  var lines = ['👥 ใครจ่ายเท่าไหร่ เดือน ' + timeThaiMonthLabel(m)];
  Object.keys(t.byPayer).forEach(function (p) {
    lines.push('• ' + memberName(p) + ' ' + moneyFormatBaht(t.byPayer[p]));
  });
  lines.push('รวม ' + moneyFormatBaht(t.net) + ' (รายจ่ายครอบครัวนับเต็มจำนวน ไม่หารครึ่ง)');
  return lines.join('\n');
}

/**
 * Compares the current month against the previous one. When the current month
 * is not finished, the same day-of-month window is used on both sides and that
 * is stated explicitly.
 */
function reportCompareMonths(month, todayISO) {
  var m = month || timeCurrentMonth();
  var prev = timePreviousMonth(m);
  var today = todayISO || timeTodayISO();
  var isCurrent = timeMonthOf(today) === m;
  var dayCut = isCurrent ? parseInt(today.slice(8, 10), 10) : timeDaysInMonth(m);

  var prevDays = timeDaysInMonth(prev);
  var prevCut = Math.min(dayCut, prevDays);
  var cur = reportRangeTotals(m + '-01', m + '-' + ('0' + dayCut).slice(-2));
  var pre = reportRangeTotals(prev + '-01', prev + '-' + ('0' + prevCut).slice(-2));

  var lines = ['📈 เทียบเดือน ' + timeThaiMonthLabel(m) + ' กับ ' + timeThaiMonthLabel(prev)];
  lines.push(isCurrent
    ? 'เทียบช่วงวันที่ 1–' + dayCut + ' เท่ากันทั้งสองเดือน (เดือนนี้ยังไม่จบ)'
    : 'เทียบทั้งเดือน');
  if (pre.count === 0) {
    lines.push('เดือนก่อนยังไม่มีรายการที่บันทึก จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้');
    lines.push('เดือนนี้ ' + moneyFormatBaht(cur.net) + ' จาก ' + cur.count + ' รายการ');
    return lines.join('\n');
  }
  var diff = cur.net - pre.net;
  var pct = pre.net === 0 ? null : Math.round((diff / pre.net) * 1000) / 10;
  lines.push('เดือนนี้ ' + moneyFormatBaht(cur.net) + ' · เดือนก่อน ' + moneyFormatBaht(pre.net));
  lines.push((diff >= 0 ? 'มากกว่า ' : 'น้อยกว่า ') + moneyFormatBaht(Math.abs(diff)) + (pct === null ? '' : ' (' + (diff >= 0 ? '+' : '-') + Math.abs(pct) + '%)'));
  return lines.join('\n');
}

function reportRecent(limit, recorderMemberId) {
  var rows = txRecent(limit || 5, recorderMemberId);
  if (!rows.length) return 'ยังไม่มีรายการที่บันทึกครับ';
  var lines = ['🧾 รายการล่าสุด'];
  rows.forEach(function (r, i) { lines.push((i + 1) + '. ' + msgTxLine(r)); });
  return lines.join('\n');
}

/**
 * Operational status: pending work, failures, AI/push switches.
 * The event currently being answered is excluded, otherwise the reply would
 * always claim that one job is still waiting — itself.
 */
function reportStatus(groupId, currentEventId) {
  var counts = inboxSummaryCounts(currentEventId);
  var pending = pendingListOpen(groupId).length;
  var lines = ['🔧 สถานะระบบ'];
  lines.push('งานที่บันทึกสำเร็จ: ' + (counts.committed || 0));
  lines.push('รอประมวลผล: ' + ((counts.queued || 0) + (counts.processing || 0)));
  lines.push('ล้มเหลว: ' + (counts.failed || 0));
  lines.push('คำถามที่รอคำตอบ: ' + pending);
  lines.push('AI: ' + (getConfigBool('AI_ENABLED') ? 'เปิด' : 'ปิด') + ' · แจ้งเตือน Push: ' + (getConfigBool('PUSH_ENABLED') ? 'เปิด' : 'ปิด'));
  if (getConfigBool('AI_ENABLED')) {
    var b = aiBudgetStatus();
    lines.push('งบ AI เดือนนี้: ใช้ไป $' + b.used.toFixed(4) + ' / $' + b.limit.toFixed(2));
  }
  var failed = repoFilter('Inbox', function (r) { return r.status === 'failed'; }).slice(-3);
  failed.forEach(function (f) { lines.push('• ล้มเหลว ' + f.event_id.slice(0, 10) + ' (' + f.last_error_code + ')'); });
  return lines.join('\n');
}
