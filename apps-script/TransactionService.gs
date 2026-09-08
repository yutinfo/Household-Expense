/**
 * TransactionService.gs — the only writer of money rows.
 *
 * Rules enforced here:
 *  - amounts are positive integers in satang; `type` carries the direction
 *  - net expense = expense - refund, excluding transfer, void, and any batch
 *    whose Inbox row is not committed
 *  - logical unique key is event_id + item_index (retry-safe)
 *  - every mutation writes an AuditLog row and bumps `revision`
 */

var TX_TYPES = ['expense', 'refund', 'transfer'];
var TX_STATUS = { ACTIVE: 'active', VOID: 'void' };

function txAll() { return repoReadAll('Transactions').rows; }

function txById(transactionId) {
  return repoFindOne('Transactions', 'transaction_id', transactionId);
}

function txByEventItem_(eventId, itemIndex) {
  var rows = txAll();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].event_id === eventId && Number(rows[i].item_index) === Number(itemIndex)) return rows[i];
  }
  return null;
}

function txValidateDraft_(draft) {
  if (TX_TYPES.indexOf(draft.type) < 0) throw new Error('TX_BAD_TYPE:' + draft.type);
  moneyAssertInt(draft.amount_satang, 'amount');
  if (draft.amount_satang <= 0) throw new Error('TX_ZERO_AMOUNT');
  if (!timeIsValidDateISO(draft.occurred_date)) throw new Error('TX_BAD_DATE:' + draft.occurred_date);
  if (draft.type !== 'transfer') {
    if (!draft.category_id) throw new Error('TX_NO_CATEGORY');
    if (!categoryById(draft.category_id)) throw new Error('TX_UNKNOWN_CATEGORY:' + draft.category_id);
  }
  if (!draft.recorder_member_id) throw new Error('TX_NO_RECORDER');
  if (!draft.payer_member_id) throw new Error('TX_NO_PAYER');
  if (draft.type === 'refund' && draft.related_transaction_id) {
    var rel = txById(draft.related_transaction_id);
    if (!rel) throw new Error('TX_UNKNOWN_RELATED:' + draft.related_transaction_id);
  }
  return true;
}

/**
 * Writes a batch of drafts for one event, idempotently.
 * Existing rows for the same (event_id, item_index) are kept as-is, so a retry
 * after a partial write only fills the missing rows.
 * Must run under repoWithLock (see txCommitBatch).
 */
function txWriteBatch_(eventId, drafts) {
  var now = timeNowISO();
  var batchId = idBatch();
  var toAppend = [];
  var results = [];
  drafts.forEach(function (d, i) {
    txValidateDraft_(d);
    var existing = txByEventItem_(eventId, i);
    if (existing) { results.push(existing); return; }
    var row = {
      transaction_id: idTransaction(),
      event_id: eventId,
      item_index: i,
      batch_id: d.batch_id || batchId,
      occurred_date: d.occurred_date,
      created_at: now,
      type: d.type,
      description: d.description || '',
      amount_satang: d.amount_satang,
      category_id: d.type === 'transfer' ? '' : d.category_id,
      payer_member_id: d.payer_member_id,
      recorder_member_id: d.recorder_member_id,
      status: TX_STATUS.ACTIVE,
      revision: 1,
      related_transaction_id: d.related_transaction_id || '',
      original_text: d.original_text || '',
      updated_at: now
    };
    toAppend.push(row);
    results.push(row);
  });
  if (toAppend.length) {
    repoAppendRows('Transactions', toAppend);
    toAppend.forEach(function (r) { auditLog('', r.transaction_id, r.recorder_member_id, 'create', null, r); });
  }
  return results;
}

/**
 * Full commit path for one event: write rows, record expectations, mark the
 * Inbox row committed only after every expected row exists.
 * Returns the transaction rows.
 */
function txCommitBatch(eventId, drafts) {
  return repoWithLock(function () {
    inboxSetExpected_(eventId, drafts.length, drafts.map(function (d) {
      return { type: d.type, amount_satang: d.amount_satang, occurred_date: d.occurred_date, category_id: d.category_id, description: d.description, payer_member_id: d.payer_member_id, recorder_member_id: d.recorder_member_id, related_transaction_id: d.related_transaction_id || '', original_text: d.original_text || '' };
    }));
    var rows = txWriteBatch_(eventId, drafts);
    var written = txAll().filter(function (r) { return r.event_id === eventId; }).length;
    if (written < drafts.length) throw new Error('TX_BATCH_INCOMPLETE:' + written + '/' + drafts.length);
    // Every expected row now exists, so the batch counts in reports from here on.
    inboxMarkCommitted_(eventId);
    return rows;
  });
}

/** Voids a transaction (soft delete). Optimistic concurrency on `revision`. */
function txVoid(transactionId, actorMemberId, expectedRevision, actionId) {
  return repoWithLock(function () {
    var row = txById(transactionId);
    if (!row) return { ok: false, code: 'NOT_FOUND' };
    if (row.status === TX_STATUS.VOID) return { ok: true, code: 'ALREADY_VOID', transaction: row };
    if (expectedRevision != null && Number(expectedRevision) !== Number(row.revision)) {
      return { ok: false, code: 'REVISION_CONFLICT', transaction: row };
    }
    var before = row;
    var fields = { status: TX_STATUS.VOID, revision: Number(row.revision) + 1, updated_at: timeNowISO() };
    repoUpdateRow('Transactions', row._row, fields);
    var after = txById(transactionId);
    auditLog(actionId || '', transactionId, actorMemberId, 'void', before, after);
    return { ok: true, code: 'VOIDED', transaction: after };
  });
}

/**
 * Edits amount / category / date / payer / description. Only whitelisted fields.
 * `patch` values are already validated by the caller (parser or button flow).
 */
var TX_EDITABLE_FIELDS = ['amount_satang', 'category_id', 'occurred_date', 'payer_member_id', 'description', 'type', 'related_transaction_id'];

function txEdit(transactionId, patch, actorMemberId, expectedRevision, actionId) {
  return repoWithLock(function () {
    var row = txById(transactionId);
    if (!row) return { ok: false, code: 'NOT_FOUND' };
    if (row.status === TX_STATUS.VOID) return { ok: false, code: 'IS_VOID', transaction: row };
    if (expectedRevision != null && Number(expectedRevision) !== Number(row.revision)) {
      return { ok: false, code: 'REVISION_CONFLICT', transaction: row };
    }
    var fields = {};
    Object.keys(patch).forEach(function (k) {
      if (TX_EDITABLE_FIELDS.indexOf(k) >= 0 && patch[k] !== undefined && patch[k] !== null) fields[k] = patch[k];
    });
    if (!Object.keys(fields).length) return { ok: false, code: 'NO_CHANGES', transaction: row };

    var merged = {};
    Object.keys(row).forEach(function (k) { merged[k] = row[k]; });
    Object.keys(fields).forEach(function (k) { merged[k] = fields[k]; });
    txValidateDraft_(merged);

    fields.revision = Number(row.revision) + 1;
    fields.updated_at = timeNowISO();
    repoUpdateRow('Transactions', row._row, fields);
    var after = txById(transactionId);
    auditLog(actionId || '', transactionId, actorMemberId, 'edit', row, after);
    return { ok: true, code: 'EDITED', transaction: after, before: row };
  });
}

/** Active rows belonging to committed batches only. */
function txActiveCommitted() {
  var committed = inboxCommittedSet();
  return txAll().filter(function (r) {
    return r.status === TX_STATUS.ACTIVE && (!r.event_id || committed[r.event_id]);
  });
}

/** Net expense in satang for rows matching `filter` (expense minus refund, transfers excluded). */
function txNetExpense(rows) {
  var net = 0;
  rows.forEach(function (r) {
    if (r.type === 'expense') net += Number(r.amount_satang);
    else if (r.type === 'refund') net -= Number(r.amount_satang);
  });
  return net;
}

function txInDateRange(rows, fromISO, toISO) {
  return rows.filter(function (r) { return r.occurred_date >= fromISO && r.occurred_date <= toISO; });
}

function txInMonth(rows, month) {
  return rows.filter(function (r) { return timeMonthOf(r.occurred_date) === month; });
}

/** Most recent committed, active transactions recorded by a member (or anyone). */
function txRecent(limit, recorderMemberId) {
  var rows = txActiveCommitted().filter(function (r) {
    return !recorderMemberId || r.recorder_member_id === recorderMemberId;
  });
  rows.sort(function (a, b) {
    if (a.created_at === b.created_at) return Number(b.item_index) - Number(a.item_index);
    return a.created_at < b.created_at ? 1 : -1;
  });
  return rows.slice(0, limit || 5);
}

/** All rows written by one event, in item order (used for reply messages and recovery). */
function txByEvent(eventId) {
  return txAll().filter(function (r) { return r.event_id === eventId; })
    .sort(function (a, b) { return Number(a.item_index) - Number(b.item_index); });
}
