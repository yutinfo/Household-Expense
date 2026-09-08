/**
 * PendingActionService.gs — questions the bot is waiting on.
 *
 * A pending action is bound to (owner_user_id, group_id) and expires. Claiming
 * one is a single-winner operation under lock, so a double tap on a button or
 * two people answering at once can only take effect once.
 */

var PENDING_STATUS = { OPEN: 'open', RESOLVED: 'resolved', EXPIRED: 'expired', CANCELLED: 'cancelled' };

var PENDING_TYPES = {
  CHOOSE_CATEGORY: 'choose_category',
  CONFIRM_VOID: 'confirm_void',
  CONFIRM_EDIT: 'confirm_edit',
  CLARIFY: 'clarify',
  LEARN_RULE: 'learn_rule',
  CONFIRM_BUDGET: 'confirm_budget',
  CHOOSE_TRANSACTION: 'choose_transaction',
  CONFIRM_SLIP: 'confirm_slip'
};

function pendingCreate(type, ownerUserId, groupId, payload, options) {
  options = options || {};
  var ttlMin = options.ttlMinutes || getConfigInt('PENDING_TTL_MINUTES');
  var row = {
    action_id: idPending(),
    event_id: options.eventId || '',
    owner_user_id: ownerUserId || '',
    group_id: groupId || '',
    action_type: type,
    payload_json: JSON.stringify(payload || {}),
    expected_revision: options.expectedRevision == null ? '' : options.expectedRevision,
    expires_at: timePlusSecondsISO(ttlMin * 60),
    status: PENDING_STATUS.OPEN,
    created_at: timeNowISO(),
    resolved_at: ''
  };
  repoAppendRows('PendingActions', [row]);
  return row;
}

function pendingGet(actionId) {
  return repoFindOne('PendingActions', 'action_id', actionId);
}

function pendingPayload(row) {
  if (!row) return null;
  try { return JSON.parse(row.payload_json || '{}'); } catch (e) { return {}; }
}

/**
 * Atomically takes ownership of a pending action.
 * Returns {ok:false, code:'NOT_FOUND'|'EXPIRED'|'ALREADY_DONE'|'WRONG_USER'|'WRONG_GROUP'} or
 *         {ok:true, action, payload}
 */
function pendingClaim(actionId, userId, groupId) {
  return repoWithLock(function () {
    var row = pendingGet(actionId);
    if (!row) return { ok: false, code: 'NOT_FOUND' };
    if (row.status !== PENDING_STATUS.OPEN) return { ok: false, code: 'ALREADY_DONE', action: row };
    if (row.group_id && groupId && row.group_id !== groupId) return { ok: false, code: 'WRONG_GROUP' };
    if (row.owner_user_id && userId && row.owner_user_id !== userId) return { ok: false, code: 'WRONG_USER', action: row };
    if (timeIsPastISO(row.expires_at)) {
      repoUpdateRow('PendingActions', row._row, { status: PENDING_STATUS.EXPIRED, resolved_at: timeNowISO() });
      return { ok: false, code: 'EXPIRED', action: row };
    }
    repoUpdateRow('PendingActions', row._row, { status: PENDING_STATUS.RESOLVED, resolved_at: timeNowISO() });
    return { ok: true, action: row, payload: pendingPayload(row) };
  });
}

/** Cancels an action without performing it. */
function pendingCancel(actionId) {
  var row = pendingGet(actionId);
  if (!row || row.status !== PENDING_STATUS.OPEN) return false;
  repoUpdateRow('PendingActions', row._row, { status: PENDING_STATUS.CANCELLED, resolved_at: timeNowISO() });
  return true;
}

/** Newest open action of a user in a group (used for free-text answers such as "อาหาร"). */
function pendingLatestOpenFor(userId, groupId, type) {
  var rows = repoFilter('PendingActions', function (r) {
    return r.status === PENDING_STATUS.OPEN &&
      r.owner_user_id === userId &&
      (!groupId || r.group_id === groupId) &&
      (!type || r.action_type === type) &&
      !timeIsPastISO(r.expires_at);
  });
  rows.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  return rows[0] || null;
}

function pendingListOpen(groupId) {
  return repoFilter('PendingActions', function (r) {
    return r.status === PENDING_STATUS.OPEN && (!groupId || r.group_id === groupId) && !timeIsPastISO(r.expires_at);
  });
}

/** Marks everything past its expiry as expired (run from the maintenance trigger). */
function pendingExpireOverdue() {
  var n = 0;
  repoFilter('PendingActions', function (r) { return r.status === PENDING_STATUS.OPEN && timeIsPastISO(r.expires_at); })
    .forEach(function (r) {
      repoUpdateRow('PendingActions', r._row, { status: PENDING_STATUS.EXPIRED, resolved_at: timeNowISO() });
      n++;
    });
  return n;
}
