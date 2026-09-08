/**
 * BudgetService.gs — monthly per-category budgets.
 * A category with no row is "ยังไม่ตั้งงบ". The bot never invents a budget:
 * only an explicit user command (confirmed) writes one.
 */

function budgetGet(month, categoryId) {
  var rows = repoFilter('Budgets', function (b) { return b.month === month && b.category_id === categoryId; });
  return rows.length ? rows[rows.length - 1] : null;
}

function budgetListForMonth(month) {
  return repoFilter('Budgets', function (b) { return b.month === month; });
}

function budgetSet(month, categoryId, limitSatang, actorMemberId) {
  if (!categoryById(categoryId)) return { ok: false, code: 'UNKNOWN_CATEGORY' };
  moneyAssertInt(limitSatang, 'budget');
  return repoWithLock(function () {
    var existing = budgetGet(month, categoryId);
    var before = existing ? { limit_satang: existing.limit_satang } : null;
    var warn = getConfig('BUDGET_WARNING_PERCENTS').split(',')[0] || '80';
    if (existing) {
      repoUpdateRow('Budgets', existing._row, { limit_satang: limitSatang, updated_by: actorMemberId || '', updated_at: timeNowISO() });
    } else {
      repoAppendRows('Budgets', [{
        month: month, category_id: categoryId, limit_satang: limitSatang,
        warning_percent: parseInt(warn, 10), updated_by: actorMemberId || '', updated_at: timeNowISO()
      }]);
    }
    auditLog('', '', actorMemberId, 'budget_set', before, { month: month, category_id: categoryId, limit_satang: limitSatang });
    return { ok: true, code: existing ? 'UPDATED' : 'CREATED' };
  });
}

/** Remaining budget for one category, or null when no budget is set. */
function budgetRemaining(month, categoryId, totals) {
  var b = budgetGet(month, categoryId);
  if (!b) return null;
  var t = totals || reportMonthTotals(month);
  var spent = t.byCategory[categoryId] || 0;
  return {
    limit: Number(b.limit_satang),
    spent: spent,
    remaining: Number(b.limit_satang) - spent,
    percent: Number(b.limit_satang) > 0 ? (spent * 100) / Number(b.limit_satang) : 0,
    warning_percent: Number(b.warning_percent) || 80
  };
}

function budgetSummaryLines(month, totals) {
  var budgets = budgetListForMonth(month);
  if (!budgets.length) return [];
  var t = totals || reportMonthTotals(month);
  var lines = ['— งบเดือนนี้ —'];
  budgets.forEach(function (b) {
    var r = budgetRemaining(month, b.category_id, t);
    if (!r) return;
    lines.push('• ' + categoryName(b.category_id) + ' ' + moneyFormat(r.spent) + '/' + moneyFormat(r.limit) +
      ' (' + (r.remaining >= 0 ? 'เหลือ ' + moneyFormat(r.remaining) : 'เกิน ' + moneyFormat(-r.remaining)) + ')');
  });
  return lines;
}

function budgetTextRemaining(categoryId, month) {
  var m = month || timeCurrentMonth();
  var r = budgetRemaining(m, categoryId);
  if (!r) return 'หมวด ' + categoryName(categoryId) + ' เดือน ' + timeThaiMonthLabel(m) + ' ยังไม่ตั้งงบครับ\nตั้งได้โดยพิมพ์ เช่น "ตั้งงบ' + categoryName(categoryId) + ' 5000 เดือนนี้"';
  var lines = ['💰 งบ ' + categoryName(categoryId) + ' เดือน ' + timeThaiMonthLabel(m)];
  lines.push('งบ ' + moneyFormatBaht(r.limit) + ' · ใช้ไป ' + moneyFormatBaht(r.spent) + ' (' + Math.round(r.percent) + '%)');
  lines.push(r.remaining >= 0 ? 'เหลือ ' + moneyFormatBaht(r.remaining) : '⚠️ เกินงบ ' + moneyFormatBaht(-r.remaining));
  lines.push('คิดจากรายการที่บันทึกไว้เท่านั้น');
  return lines.join('\n');
}

/**
 * Threshold crossings that have not been notified yet for this month.
 * Returns [{category_id, threshold, percent, remaining, key}]
 */
function budgetPendingAlerts(month, totals) {
  var thresholds = getConfig('BUDGET_WARNING_PERCENTS').split(',').map(function (s) { return parseInt(s, 10); }).filter(function (n) { return !isNaN(n); });
  var t = totals || reportMonthTotals(month);
  var out = [];
  budgetListForMonth(month).forEach(function (b) {
    var r = budgetRemaining(month, b.category_id, t);
    if (!r || r.limit <= 0) return;
    thresholds.forEach(function (th) {
      if (r.percent < th) return;
      var key = month + '|' + b.category_id + '|' + th;
      if (repoFindOne('Notifications', 'notification_key', key)) return;
      out.push({ category_id: b.category_id, threshold: th, percent: r.percent, remaining: r.remaining, limit: r.limit, spent: r.spent, key: key, month: month });
    });
  });
  return out;
}

/** Records an alert as sent so retries and repeated triggers do not duplicate it. */
function budgetMarkAlertSent(alert) {
  return repoWithLock(function () {
    if (repoFindOne('Notifications', 'notification_key', alert.key)) return false;
    repoAppendRows('Notifications', [{
      notification_key: alert.key, period: alert.month, category_id: alert.category_id,
      threshold: alert.threshold, status: 'sent', sent_at: timeNowISO()
    }]);
    return true;
  });
}

function budgetAlertText(alert) {
  var head = alert.threshold >= 100 ? '🚨 เกินงบแล้ว' : '⚠️ ใกล้เต็มงบ';
  return head + ' หมวด' + categoryName(alert.category_id) + ' ' +
    moneyFormat(alert.spent) + '/' + moneyFormat(alert.limit) + ' (' + Math.round(alert.percent) + '%)' +
    (alert.remaining >= 0 ? ' เหลือ ' + moneyFormatBaht(alert.remaining) : ' เกิน ' + moneyFormatBaht(-alert.remaining));
}
