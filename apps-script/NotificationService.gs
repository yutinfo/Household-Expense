/**
 * NotificationService.gs — budget alerts and quota-aware push.
 *
 * Alerts ride along with the reply after a save whenever possible, because a
 * reply costs no message quota. Push is only used for scheduled summaries and
 * for late results, and it stops before the monthly quota is exhausted so the
 * recovery path can still notify.
 */

/** Extra lines to append to the "saved" reply (costs no quota). */
function notifyBudgetLinesAfterSave(rows, ctx) {
  if (!rows || !rows.length) return [];
  var months = {};
  rows.forEach(function (r) { if (r.type !== 'transfer') months[timeMonthOf(r.occurred_date)] = true; });
  var lines = [];
  Object.keys(months).forEach(function (m) {
    var totals = reportMonthTotals(m);
    budgetPendingAlerts(m, totals).forEach(function (alert) {
      if (budgetMarkAlertSent(alert)) lines.push(budgetAlertText(alert));
    });
  });
  return lines;
}

/** Push messages used this month, counted per recipient. */
function notifyPushUsedThisMonth() {
  var month = timeCurrentMonth();
  var used = 0;
  repoFilter('Usage', function (u) { return u.provider === 'line' && u.model === 'push' && String(u.date).slice(0, 7) === month; })
    .forEach(function (u) { used += Number(u.request_count) || 0; });
  return used;
}

function notifyPushRemaining(reserveForRecovery) {
  var quota = getConfigInt('PUSH_MONTHLY_QUOTA');
  var reserve = reserveForRecovery === false ? 0 : getConfigInt('PUSH_RESERVE_FOR_RECOVERY');
  return quota - reserve - notifyPushUsedThisMonth();
}

function notifyRecordPush_(recipients) {
  repoWithLock(function () {
    var date = timeTodayISO();
    var rows = repoFilter('Usage', function (u) { return u.date === date && u.provider === 'line' && u.model === 'push'; });
    if (rows.length) {
      repoUpdateRow('Usage', rows[0]._row, { request_count: Number(rows[0].request_count) + recipients });
    } else {
      repoAppendRows('Usage', [{ date: date, provider: 'line', model: 'push', request_count: recipients, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 }]);
    }
  });
}

/**
 * Sends a push to the family group if push is enabled and quota allows.
 * Returns {sent:boolean, reason}.
 */
function notifyPush(messages, options) {
  options = options || {};
  if (!getConfigBool('PUSH_ENABLED')) return { sent: false, reason: 'PUSH_DISABLED' };
  var recipients = Math.max(1, memberList().length);
  var remaining = notifyPushRemaining(options.useReserve === true ? false : true);
  if (remaining < recipients) return { sent: false, reason: 'QUOTA_EXHAUSTED' };
  var to = options.to || getConfig('ALLOWED_GROUP_ID', true);
  var res = linePush(to, messages);
  if (!res.ok) return { sent: false, reason: res.code };
  notifyRecordPush_(recipients);
  return { sent: true, recipients: recipients };
}
