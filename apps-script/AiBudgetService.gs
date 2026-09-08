/**
 * AiBudgetService.gs — local hard cap on AI spending.
 *
 * A provider-side budget alert is not a cap, so every call reserves an
 * estimated cost under lock BEFORE the request and reconciles with the real
 * token usage afterwards. When the month's reserved+actual cost reaches the
 * limit, AI is skipped and the rule/button path is used instead.
 */

function aiUsageMonthRows(month) {
  return repoFilter('Usage', function (u) { return String(u.date).slice(0, 7) === month; });
}

function aiBudgetStatus(month) {
  var m = month || timeCurrentMonth();
  var used = 0, requests = 0, inTok = 0, outTok = 0;
  aiUsageMonthRows(m).forEach(function (u) {
    used += Number(u.estimated_cost_usd) || 0;
    requests += Number(u.request_count) || 0;
    inTok += Number(u.input_tokens) || 0;
    outTok += Number(u.output_tokens) || 0;
  });
  var limit = getConfigFloat('AI_MONTHLY_BUDGET_USD');
  return { month: m, used: used, limit: limit, remaining: limit - used, requests: requests, input_tokens: inTok, output_tokens: outTok };
}

/**
 * Reserves the estimated worst-case cost of one call.
 * Returns {ok:true, reservationDate} or {ok:false, code:'BUDGET_EXHAUSTED'}.
 */
function aiBudgetReserve() {
  var reserve = getConfigFloat('AI_RESERVE_USD_PER_CALL');
  return repoWithLock(function () {
    var status = aiBudgetStatus();
    if (status.used + reserve > status.limit) return { ok: false, code: 'BUDGET_EXHAUSTED', status: status };
    aiUsageAdd_(timeTodayISO(), 'gemini', getConfig('AI_MODEL'), 1, 0, 0, reserve);
    return { ok: true, reserved: reserve };
  });
}

/** Replaces the reservation with the real cost once tokens are known. */
function aiBudgetSettle(reserved, inputTokens, outputTokens) {
  var inRate = getConfigFloat('AI_INPUT_USD_PER_MTOK');
  var outRate = getConfigFloat('AI_OUTPUT_USD_PER_MTOK');
  var actual = (Number(inputTokens || 0) / 1000000) * inRate + (Number(outputTokens || 0) / 1000000) * outRate;
  var delta = actual - (reserved || 0);
  repoWithLock(function () {
    aiUsageAdd_(timeTodayISO(), 'gemini', getConfig('AI_MODEL'), 0, Number(inputTokens || 0), Number(outputTokens || 0), delta);
  });
  return actual;
}

/** Releases a reservation when the call never produced usage (timeout, error). */
function aiBudgetRelease(reserved) {
  if (!reserved) return;
  repoWithLock(function () {
    aiUsageAdd_(timeTodayISO(), 'gemini', getConfig('AI_MODEL'), 0, 0, 0, -reserved);
  });
}

/** Adds to today's usage row (creating it if needed). Caller holds the lock. */
function aiUsageAdd_(dateISO, provider, model, requests, inputTokens, outputTokens, costUsd) {
  var rows = repoFilter('Usage', function (u) { return u.date === dateISO && u.provider === provider && u.model === model; });
  if (rows.length) {
    var r = rows[0];
    repoUpdateRow('Usage', r._row, {
      request_count: Number(r.request_count) + requests,
      input_tokens: Number(r.input_tokens) + inputTokens,
      output_tokens: Number(r.output_tokens) + outputTokens,
      estimated_cost_usd: Math.max(0, Number(r.estimated_cost_usd) + costUsd)
    });
  } else {
    repoAppendRows('Usage', [{
      date: dateISO, provider: provider, model: model,
      request_count: requests, input_tokens: inputTokens, output_tokens: outputTokens,
      estimated_cost_usd: Math.max(0, costUsd)
    }]);
  }
}
