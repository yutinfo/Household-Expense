/**
 * EventService.gs — durable Inbox journal for every LINE event.
 * Lifecycle: queued -> processing (leased) -> committed | failed
 * Idempotency: one Inbox row per event_id; retries re-use the row.
 * A batch of transactions is only "committed" once every expected row exists.
 */

var INBOX_STATUS = { QUEUED: 'queued', PROCESSING: 'processing', COMMITTED: 'committed', FAILED: 'failed' };

function inboxGet(eventId) {
  return repoFindOne('Inbox', 'event_id', eventId);
}

/**
 * Durably records an incoming event. Returns {accepted:boolean, existing:boolean, status}.
 * Must be called under lock by the caller or via inboxReceiveLocked.
 */
function inboxReceive_(eventId, payload) {
  var row = inboxGet(eventId);
  if (row) return { accepted: true, existing: true, status: row.status };
  repoAppendRows('Inbox', [{
    event_id: eventId,
    status: INBOX_STATUS.QUEUED,
    expected_item_count: 0,
    lease_until: '',
    attempts: 0,
    received_at: timeNowISO(),
    completed_at: '',
    last_error_code: '',
    payload_json: JSON.stringify(payload || {}),
    result_json: ''
  }]);
  return { accepted: true, existing: false, status: INBOX_STATUS.QUEUED };
}

function inboxReceiveMany(list) {
  return repoWithLock(function () {
    return list.map(function (e) { return inboxReceive_(e.eventId, e.payload); });
  });
}

/**
 * Claims an event for processing with a lease. Returns:
 *  {claimable:true, row}                         — proceed
 *  {claimable:false, reason:'done', row}         — already committed/failed: return stored result
 *  {claimable:false, reason:'busy', row}         — another execution holds a live lease
 *  {claimable:false, reason:'missing'}           — unknown event
 */
function inboxClaim(eventId) {
  return repoWithLock(function () {
    var row = inboxGet(eventId);
    if (!row) return { claimable: false, reason: 'missing' };
    if (row.status === INBOX_STATUS.COMMITTED || row.status === INBOX_STATUS.FAILED) {
      return { claimable: false, reason: 'done', row: row };
    }
    if (row.status === INBOX_STATUS.PROCESSING && !timeIsPastISO(row.lease_until)) {
      return { claimable: false, reason: 'busy', row: row };
    }
    var maxAttempts = getConfigInt('MAX_ATTEMPTS');
    if (row.attempts >= maxAttempts) {
      repoUpdateRow('Inbox', row._row, { status: INBOX_STATUS.FAILED, last_error_code: 'MAX_ATTEMPTS', completed_at: timeNowISO() });
      return { claimable: false, reason: 'done', row: inboxGet(eventId) };
    }
    repoUpdateRow('Inbox', row._row, {
      status: INBOX_STATUS.PROCESSING,
      lease_until: timePlusSecondsISO(getConfigInt('LEASE_SECONDS')),
      attempts: row.attempts + 1
    });
    return { claimable: true, row: inboxGet(eventId) };
  });
}

/** Records the parsed items in the journal so recovery can finish a partial batch. Under lock. */
function inboxSetExpected_(eventId, itemCount, items) {
  var row = inboxGet(eventId);
  if (!row) throw new Error('INBOX_MISSING:' + eventId);
  var payload = {};
  try { payload = JSON.parse(row.payload_json || '{}'); } catch (e) { payload = {}; }
  payload.items = items;
  repoUpdateRow('Inbox', row._row, { expected_item_count: itemCount, payload_json: JSON.stringify(payload) });
}

function inboxPayload(eventId) {
  var row = inboxGet(eventId);
  if (!row) return null;
  try { return JSON.parse(row.payload_json || '{}'); } catch (e) { return {}; }
}

/**
 * Marks a batch committed the moment every expected row exists.
 * Caller must already hold the script lock (txCommitBatch does).
 */
function inboxMarkCommitted_(eventId) {
  var row = inboxGet(eventId);
  if (!row) throw new Error('INBOX_MISSING:' + eventId);
  if (row.status === INBOX_STATUS.COMMITTED) return;
  repoUpdateRow('Inbox', row._row, {
    status: INBOX_STATUS.COMMITTED,
    lease_until: '',
    completed_at: timeNowISO()
  });
}

/** Marks the event finished. `result` is stored so retries/status can replay the reply. */
function inboxComplete(eventId, result, errorCode) {
  return repoWithLock(function () {
    var row = inboxGet(eventId);
    if (!row) throw new Error('INBOX_MISSING:' + eventId);
    repoUpdateRow('Inbox', row._row, {
      status: INBOX_STATUS.COMMITTED,
      lease_until: '',
      completed_at: row.completed_at || timeNowISO(),
      last_error_code: errorCode || '',
      result_json: JSON.stringify(result || {})
    });
  });
}

/** Releases the lease after a failure; the row stays queued for retry until MAX_ATTEMPTS. */
function inboxFail(eventId, errorCode, fatal) {
  return repoWithLock(function () {
    var row = inboxGet(eventId);
    if (!row) return;
    var maxAttempts = getConfigInt('MAX_ATTEMPTS');
    var exhausted = fatal || row.attempts >= maxAttempts;
    repoUpdateRow('Inbox', row._row, {
      status: exhausted ? INBOX_STATUS.FAILED : INBOX_STATUS.QUEUED,
      lease_until: '',
      last_error_code: String(errorCode || 'ERROR').slice(0, 80),
      completed_at: exhausted ? timeNowISO() : ''
    });
  });
}

function inboxResult(eventId) {
  var row = inboxGet(eventId);
  if (!row || !row.result_json) return null;
  try { return JSON.parse(row.result_json); } catch (e) { return null; }
}

/** Events that need recovery: queued, or processing with an expired lease. */
function inboxListRecoverable() {
  return repoFilter('Inbox', function (r) {
    if (r.status === INBOX_STATUS.QUEUED) return true;
    if (r.status === INBOX_STATUS.PROCESSING && timeIsPastISO(r.lease_until)) return true;
    return false;
  });
}

/** Set of event_ids whose batch is committed (used to exclude partial batches from reports). */
function inboxCommittedSet() {
  var set = {};
  repoReadAll('Inbox').rows.forEach(function (r) { if (r.status === INBOX_STATUS.COMMITTED) set[r.event_id] = true; });
  return set;
}

function inboxSummaryCounts(excludeEventId) {
  var counts = { queued: 0, processing: 0, committed: 0, failed: 0 };
  repoReadAll('Inbox').rows.forEach(function (r) {
    if (excludeEventId && r.event_id === excludeEventId) return;
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  return counts;
}
