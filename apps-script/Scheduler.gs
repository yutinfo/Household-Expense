/**
 * Scheduler.gs — time-driven triggers.
 *
 * Apps Script fires triggers "around" the requested time, not to the minute,
 * so every scheduled message says "ช่วงประมาณ" rather than a precise time.
 */

function schedulerInstall() {
  schedulerRemoveAll();
  ScriptApp.newTrigger('recoveryRun').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('maintenanceRun').timeBased().everyDays(1).atHour(3).create();
  if (getConfigBool('DAILY_SUMMARY_ENABLED')) {
    ScriptApp.newTrigger('scheduledDailySummary').timeBased().everyDays(1).atHour(21).create();
  }
  if (getConfigBool('WEEKLY_SUMMARY_ENABLED')) {
    ScriptApp.newTrigger('scheduledWeeklySummary').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();
  }
  ScriptApp.newTrigger('dashboardRefreshTrigger').timeBased().everyHours(6).create();
  Logger.log('triggers installed: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
}

function schedulerRemoveAll() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function dashboardRefreshTrigger() {
  dashboardRefresh(timeCurrentMonth());
}

function scheduledDailySummary() {
  if (!getConfigBool('DAILY_SUMMARY_ENABLED')) return;
  var today = timeTodayISO();
  var text = reportToday(today);
  var alerts = notifyCollectAlerts_(timeMonthOf(today));
  var body = text + (alerts.length ? '\n' + alerts.join('\n') : '') + '\n(สรุปอัตโนมัติ ช่วงประมาณ 21:00 น.)';
  notifyPush([msgText(body)]);
}

function scheduledWeeklySummary() {
  if (!getConfigBool('WEEKLY_SUMMARY_ENABLED')) return;
  var today = timeTodayISO();
  var from = timeAddDays(today, -6);
  var body = reportTextForRange('สรุป 7 วันล่าสุด', from, today) + '\n(สรุปอัตโนมัติรายสัปดาห์ ช่วงประมาณเวลาที่ตั้งไว้)';
  notifyPush([msgText(body)]);
}

function notifyCollectAlerts_(month) {
  var totals = reportMonthTotals(month);
  var out = [];
  budgetPendingAlerts(month, totals).forEach(function (a) {
    if (budgetMarkAlertSent(a)) out.push(budgetAlertText(a));
  });
  return out;
}
