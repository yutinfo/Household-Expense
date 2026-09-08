/**
 * Dashboard.gs — writes the summary block used by the humans looking at the
 * spreadsheet. The numbers come from ReportService, i.e. the exact same code
 * path the LINE answers use, so the two can never disagree.
 */

function dashboardRefresh(month) {
  var m = month || timeCurrentMonth();
  var sh = repoGetSheet('Dashboard');
  var totals = reportMonthTotals(m);
  var today = timeTodayISO();

  var rows = [];
  rows.push(['สรุปบัญชีครัวเรือน', '', '', '']);
  rows.push(['เดือน', timeThaiMonthLabel(m), 'อัปเดตล่าสุด', timeNowISO()]);
  rows.push(['ช่วงข้อมูล', totals.from + ' ถึง ' + totals.to, 'จำนวนรายการ', totals.count]);
  rows.push(['รายจ่ายสุทธิ (บาท)', Number(moneyToDecimalString(totals.net)), 'รายจ่ายรวม', Number(moneyToDecimalString(totals.expense))]);
  rows.push(['เงินคืน', Number(moneyToDecimalString(totals.refund)), 'โอนภายใน (ไม่นับรายจ่าย)', Number(moneyToDecimalString(totals.transfer))]);
  rows.push(['', '', '', '']);

  rows.push(['หมวด', 'ยอด (บาท)', 'งบ (บาท)', 'คงเหลือ (บาท)']);
  var catStart = rows.length + 1;
  categoryList().forEach(function (c) {
    var spent = totals.byCategory[c.category_id] || 0;
    var b = budgetGet(m, c.category_id);
    rows.push([
      c.name,
      Number(moneyToDecimalString(spent)),
      b ? Number(moneyToDecimalString(b.limit_satang)) : 'ยังไม่ตั้งงบ',
      b ? Number(moneyToDecimalString(Number(b.limit_satang) - spent)) : ''
    ]);
  });
  var catEnd = rows.length;
  rows.push(['', '', '', '']);

  rows.push(['ผู้จ่าย', 'ยอด (บาท)', '', '']);
  memberList().forEach(function (mem) {
    rows.push([mem.display_name, Number(moneyToDecimalString(totals.byPayer[mem.member_id] || 0)), '', '']);
  });
  rows.push(['', '', '', '']);

  rows.push(['วันที่', 'ยอดรายวัน (บาท)', '', '']);
  var dayStart = rows.length + 1;
  var days = timeDaysInMonth(m);
  var lastDay = timeMonthOf(today) === m ? parseInt(today.slice(8, 10), 10) : days;
  var byDay = {};
  totals.rows.forEach(function (r) {
    if (r.type === 'transfer') return;
    var sign = r.type === 'refund' ? -1 : 1;
    byDay[r.occurred_date] = (byDay[r.occurred_date] || 0) + sign * Number(r.amount_satang);
  });
  for (var d = 1; d <= lastDay; d++) {
    var iso = m + '-' + ('0' + d).slice(-2);
    rows.push([iso, Number(moneyToDecimalString(byDay[iso] || 0)), '', '']);
  }
  var dayEnd = rows.length;

  rows.push(['', '', '', '']);
  rows.push(['หมายเหตุ', 'ตัวเลขทั้งหมดมาจากรายการที่บันทึกและ commit แล้วเท่านั้น ไม่รวมงานที่ยังรอประมวลผล', '', '']);

  sh.clearContents();
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  dashboardDrawCharts_(sh, catStart, catEnd, dayStart, dayEnd);
  return { month: m, rows: rows.length };
}

function dashboardDrawCharts_(sh, catStart, catEnd, dayStart, dayEnd) {
  try {
    sh.getCharts().forEach(function (c) { sh.removeChart(c); });
    if (catEnd >= catStart) {
      var pie = sh.newChart()
        .setChartType(Charts.ChartType.PIE)
        .addRange(sh.getRange(catStart, 1, catEnd - catStart + 1, 2))
        .setPosition(2, 6, 0, 0)
        .setOption('title', 'รายจ่ายตามหมวด')
        .build();
      sh.insertChart(pie);
    }
    if (dayEnd >= dayStart) {
      var line = sh.newChart()
        .setChartType(Charts.ChartType.COLUMN)
        .addRange(sh.getRange(dayStart, 1, dayEnd - dayStart + 1, 2))
        .setPosition(20, 6, 0, 0)
        .setOption('title', 'ยอดรายวัน')
        .build();
      sh.insertChart(line);
    }
  } catch (e) {
    Logger.log('charts skipped: ' + e);
  }
}
