/**
 * Maintenance.gs — daily housekeeping.
 *
 * Retention applies ONLY to operational data (expired questions, old event
 * journal rows, orphan slip uploads). Ledger rows and the audit trail are
 * never deleted by this policy.
 */

function maintenanceRun() {
  var expired = pendingExpireOverdue();
  var events = maintenancePruneInbox_();
  var orphans = attachmentPruneOrphans();
  var backup = maintenanceWeeklyBackup_();
  dashboardRefresh(timeCurrentMonth());
  var msg = 'maintenance: pendingExpired=' + expired + ' inboxPruned=' + events + ' orphanAttachments=' + orphans + ' backup=' + backup;
  Logger.log(msg);
  return msg;
}

/** Removes finished Inbox rows older than RETENTION_EVENT_DAYS. */
function maintenancePruneInbox_() {
  var cutoff = timeAddDays(timeTodayISO(), -getConfigInt('RETENTION_EVENT_DAYS'));
  var doomed = repoFilter('Inbox', function (r) {
    if (r.status !== 'committed' && r.status !== 'failed') return false;
    var when = String(r.completed_at || r.received_at || '').slice(0, 10);
    return when && when < cutoff;
  });
  // keep any row whose transactions might still need repair
  var keepIds = {};
  txAll().forEach(function (t) { if (t.event_id) keepIds[t.event_id] = true; });
  var rows = doomed.filter(function (r) { return !keepIds[r.event_id]; }).map(function (r) { return r._row; });
  repoDeleteRows('Inbox', rows);
  return rows.length;
}

function maintenanceWeeklyBackup_() {
  if (!getConfig('BACKUP_FOLDER_ID')) return 'skipped(no folder)';
  var dow = Number(Utilities.formatDate(timeNow_(), timeZone_(), 'u')); // 1=Mon .. 7=Sun
  if (dow !== 7) return 'skipped(not sunday)';
  var res = backupRun();
  return res.ok ? res.name : 'failed(' + res.code + ')';
}

/** Owner switches, callable from the editor. */
function maintenanceEnableAi() { PropertiesService.getScriptProperties().setProperty('AI_ENABLED', 'true'); configReset_(); Logger.log('AI enabled'); }
function maintenanceDisableAi() { PropertiesService.getScriptProperties().setProperty('AI_ENABLED', 'false'); configReset_(); Logger.log('AI disabled'); }
function maintenanceEnablePush() { PropertiesService.getScriptProperties().setProperty('PUSH_ENABLED', 'true'); configReset_(); Logger.log('Push enabled'); }
function maintenanceDisablePush() { PropertiesService.getScriptProperties().setProperty('PUSH_ENABLED', 'false'); configReset_(); Logger.log('Push disabled'); }

/** Prints everything an operator needs when something looks wrong. */
function maintenanceStatusReport() {
  var lines = [];
  lines.push('=== config ===');
  lines = lines.concat(configHealthCheck());
  lines.push('=== inbox ===');
  var counts = inboxSummaryCounts();
  Object.keys(counts).forEach(function (k) { lines.push(k + ': ' + counts[k]); });
  lines.push('=== pending ===');
  lines.push('open: ' + pendingListOpen().length);
  lines.push('=== ai budget ===');
  var b = aiBudgetStatus();
  lines.push('used $' + b.used.toFixed(4) + ' / $' + b.limit.toFixed(2) + ' requests=' + b.requests);
  lines.push('=== push ===');
  lines.push('used ' + notifyPushUsedThisMonth() + ' / quota ' + getConfigInt('PUSH_MONTHLY_QUOTA'));
  lines.push('=== consistency ===');
  lines = lines.concat(recoveryAudit());
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}
