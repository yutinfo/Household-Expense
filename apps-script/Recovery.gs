/**
 * Recovery.gs — finishes work that the webhook could not complete in time,
 * and repairs batches that stopped halfway through writing.
 *
 * Run from a time-driven trigger (see Scheduler.gs). Reply tokens are gone by
 * then, so results are delivered by push when quota allows; otherwise the user
 * sees them via "สถานะ" / "รายการล่าสุด".
 */

function recoveryRun() {
  var processed = 0, repaired = 0, failed = 0;
  var pending = inboxListRecoverable();
  var deadline = new Date().getTime() + 4 * 60 * 1000; // stay well inside the 6-minute limit

  for (var i = 0; i < pending.length; i++) {
    if (new Date().getTime() > deadline) break;
    var row = pending[i];
    var payload = inboxPayload(row.event_id) || {};

    // Case 1: a batch that was partly written — fill only the missing rows.
    if (payload.items && payload.items.length) {
      var existing = txByEvent(row.event_id);
      if (existing.length < payload.items.length) {
        try {
          txCommitBatch(row.event_id, payload.items);
          repaired++;
        } catch (e) {
          Logger.log('recovery repair failed ' + row.event_id + ': ' + configRedact(String(e)));
          inboxFail(row.event_id, 'REPAIR_FAILED', false);
          failed++;
          continue;
        }
      }
      var rows = txByEvent(row.event_id);
      inboxComplete(row.event_id, { messages: [msgSavedTransactions(rows, [])], transaction_ids: rows.map(function (t) { return t.transaction_id; }) }, 'RECOVERED');
      recoveryNotify_(row.event_id, rows);
      processed++;
      continue;
    }

    // Case 2: never processed — run it now from the stored payload.
    var ev = recoveryEventFromPayload_(payload);
    if (!ev) { inboxFail(row.event_id, 'NO_PAYLOAD', true); failed++; continue; }
    var out = webhookProcessEvent(row.event_id, ev);
    if (out && out.messages && out.messages.length) recoveryPushMessages_(out.messages);
    processed++;
  }
  Logger.log('recoveryRun processed=' + processed + ' repaired=' + repaired + ' failed=' + failed);
  return { processed: processed, repaired: repaired, failed: failed };
}

function recoveryEventFromPayload_(payload) {
  if (!payload || !payload.type || !payload.source) return null;
  return {
    type: payload.type,
    timestamp: payload.timestamp,
    source: payload.source,
    message: payload.message,
    postback: payload.postback,
    replyToken: '' // expired by now
  };
}

function recoveryNotify_(eventId, rows) {
  if (!rows || !rows.length) return;
  recoveryPushMessages_([msgText('⏱️ งานที่ค้างอยู่ประมวลผลเสร็จแล้ว\n' + rows.map(function (r) { return '• ' + msgTxLine(r); }).join('\n'))]);
}

function recoveryPushMessages_(messages) {
  var res = notifyPush(messages, { useReserve: true });
  if (!res.sent) Logger.log('recovery push skipped: ' + res.reason);
}

/**
 * Consistency report for the owner: batches with missing rows, transactions
 * whose event never committed, and stuck pending actions.
 */
function recoveryAudit() {
  var issues = [];
  repoReadAll('Inbox').rows.forEach(function (r) {
    var payload = inboxPayload(r.event_id) || {};
    var expected = Number(r.expected_item_count) || (payload.items ? payload.items.length : 0);
    if (!expected) return;
    var actual = txByEvent(r.event_id).length;
    if (actual !== expected) issues.push('event ' + r.event_id + ': rows ' + actual + '/' + expected + ' (status ' + r.status + ')');
  });
  var committed = inboxCommittedSet();
  txAll().forEach(function (t) {
    if (t.event_id && !committed[t.event_id]) issues.push('transaction ' + t.transaction_id + ' belongs to uncommitted event ' + t.event_id);
  });
  var stuck = repoFilter('PendingActions', function (p) { return p.status === 'open' && timeIsPastISO(p.expires_at); });
  if (stuck.length) issues.push(stuck.length + ' pending actions past expiry (run maintenanceRun to close)');
  Logger.log(issues.length ? issues.join('\n') : 'recoveryAudit: no issues');
  return issues;
}
