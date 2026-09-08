/**
 * Webhook.gs — Apps Script Web App entry point.
 *
 * Contract with the Worker:
 *   POST body  = { v, timestamp, nonce, body_b64, signature }
 *   200 body   = { ok:true, replies:[{replyToken, messages:[...]}], accepted:n }
 *   4xx/5xx    = { ok:false, code } — the Worker decides whether LINE should retry
 *
 * Ordering guarantee: an event is only reported as "saved" after its rows are
 * committed. Anything still queued is reported as "received, processing".
 */

function doPost(e) {
  var started = new Date().getTime();
  try {
    if (!e || !e.postData || !e.postData.contents) return webhookJson_({ ok: false, code: 'NO_BODY' });
    var envelope;
    try { envelope = JSON.parse(e.postData.contents); } catch (err) { return webhookJson_({ ok: false, code: 'BAD_JSON' }); }

    var verified = authVerifyEnvelope(envelope);
    if (!verified.ok) {
      Logger.log('envelope rejected: ' + verified.code);
      return webhookJson_({ ok: false, code: verified.code });
    }

    var lineBody;
    try { lineBody = JSON.parse(verified.body); } catch (err2) { return webhookJson_({ ok: false, code: 'BAD_LINE_JSON' }); }
    var events = lineBody.events || [];
    if (!events.length) return webhookJson_({ ok: true, replies: [], accepted: 0 }); // LINE "verify" ping

    // 1) durably record everything first
    var accepted = [];
    events.forEach(function (ev) {
      var eventId = webhookEventId_(ev);
      if (!eventId) return;
      accepted.push({ event: ev, eventId: eventId });
    });
    try {
      inboxReceiveMany(accepted.map(function (a) { return { eventId: a.eventId, payload: webhookStorablePayload_(a.event) }; }));
    } catch (storeErr) {
      Logger.log('inbox store failed: ' + configRedact(String(storeErr)));
      return webhookJson_({ ok: false, code: 'STORE_FAILED' }); // let LINE retry
    }

    // 2) process within the deadline; anything left stays queued for recovery
    var deadline = getConfigInt('PROCESSING_DEADLINE_MS');
    var replies = [];
    var deferred = 0;
    accepted.forEach(function (a) {
      var elapsed = new Date().getTime() - started;
      if (elapsed > deadline) {
        deferred++;
        if (a.event.replyToken) replies.push({ replyToken: a.event.replyToken, messages: [msgAccepted()] });
        return;
      }
      var out = webhookProcessEvent(a.eventId, a.event);
      if (out && out.messages && out.messages.length && a.event.replyToken) {
        replies.push({ replyToken: a.event.replyToken, messages: out.messages.slice(0, 5) });
      }
    });

    return webhookJson_({ ok: true, replies: replies, accepted: accepted.length, deferred: deferred });
  } catch (fatal) {
    Logger.log('doPost fatal: ' + configRedact(String(fatal && fatal.stack ? fatal.stack : fatal)));
    return webhookJson_({ ok: false, code: 'INTERNAL' });
  }
}

/** Health check that reveals nothing about the ledger. */
function doGet() {
  return webhookJson_({ ok: true, service: 'household-expense', ts: timeNowISO() });
}

function webhookJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Stable per-event ID: LINE's webhookEventId, else a hash of the event. */
function webhookEventId_(ev) {
  if (ev.webhookEventId) return String(ev.webhookEventId);
  var basis = [ev.type, ev.timestamp, ev.source && ev.source.userId, ev.source && ev.source.groupId,
    ev.message && ev.message.id, ev.postback && ev.postback.data].join('|');
  if (!basis.replace(/\|/g, '')) return null;
  return 'H' + authSha256Hex(basis).slice(0, 32);
}

/** What we keep in the journal: no tokens, no profile data beyond the IDs we need. */
function webhookStorablePayload_(ev) {
  return {
    type: ev.type,
    timestamp: ev.timestamp,
    source: { type: ev.source && ev.source.type, groupId: ev.source && ev.source.groupId, userId: ev.source && ev.source.userId },
    message: ev.message ? { id: ev.message.id, type: ev.message.type, text: ev.message.type === 'text' ? ev.message.text : undefined } : undefined,
    postback: ev.postback ? { data: ev.postback.data } : undefined
  };
}

/**
 * Processes one event exactly once. Safe to call again for the same event_id:
 * a completed event replays its stored reply instead of re-running.
 */
function webhookProcessEvent(eventId, ev) {
  var claim = inboxClaim(eventId);
  if (!claim.claimable) {
    if (claim.reason === 'done') {
      var prior = inboxResult(eventId);
      if (prior && prior.messages && prior.messages.length) return { messages: prior.messages };
      // Committed by the batch writer but the reply was never stored (the
      // execution died in between): rebuild it from the rows that exist.
      var rows = txByEvent(eventId);
      return { messages: rows.length ? [msgSavedTransactions(rows, [])] : [] };
    }
    return { messages: [] }; // busy: another execution owns it
  }

  var auth = authResolveSender(ev.source);
  if (!auth.ok) {
    // Onboarding is the only path where an unknown user may be answered.
    if (auth.code === 'USER_NOT_ALLOWED' && getConfigBool('ONBOARDING_ENABLED') &&
        ev.type === 'message' && ev.message && ev.message.type === 'text') {
      var m = String(ev.message.text || '').trim().match(/^ลงทะเบียน\s+([A-Za-z0-9]{4,10})$/);
      if (m && authIsAllowedGroup(ev.source && ev.source.groupId)) {
        var redeem = authRedeemOnboardingCode(m[1], ev.source.userId);
        var msg = redeem.ok
          ? msgText('ลงทะเบียน ' + redeem.member.display_name + ' เรียบร้อยครับ')
          : msgText('รหัสลงทะเบียนใช้ไม่ได้ (' + redeem.code + ')');
        inboxComplete(eventId, { messages: [msg] }, '');
        return { messages: [msg] };
      }
    }
    inboxComplete(eventId, { messages: [] }, auth.code);
    return { messages: [] }; // stay silent to strangers
  }

  var ctx = {
    userId: auth.userId,
    groupId: auth.groupId,
    eventId: eventId,
    memberId: auth.member.member_id,
    todayISO: timeTodayISO(),
    replyToken: ev.replyToken || ''
  };

  try {
    var result = routerHandleEvent(ctx, ev) || { messages: [] };
    inboxComplete(eventId, { messages: result.messages || [], transaction_ids: (result.transactions || []).map(function (t) { return t.transaction_id; }) }, '');
    return result;
  } catch (err) {
    var code = String(err && err.message ? err.message : err).slice(0, 60);
    Logger.log('process failed ' + eventId + ': ' + configRedact(String(err && err.stack ? err.stack : err)));
    inboxFail(eventId, code, false);
    return { messages: [msgError(code.split(':')[0])] };
  }
}
