/** AuditService.gs — append-only history of every change made through the bot. */

function auditLog(actionId, transactionId, actorId, action, before, after) {
  repoAppendRows('AuditLog', [{
    audit_id: idAudit(),
    action_id: actionId || '',
    transaction_id: transactionId || '',
    actor_id: actorId || '',
    action: action,
    before_json: before ? JSON.stringify(auditStrip_(before)) : '',
    after_json: after ? JSON.stringify(auditStrip_(after)) : '',
    created_at: timeNowISO()
  }]);
}

function auditStrip_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = obj[k]; });
  return out;
}

function auditListForTransaction(transactionId) {
  return repoFilter('AuditLog', function (r) { return r.transaction_id === transactionId; });
}
