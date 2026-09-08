/**
 * AiSchema.gs — the response contract and the validator.
 *
 * The validator is the security boundary: the model may only *suggest*. Every
 * amount must appear in the user's own text, every category must already
 * exist, every payer must be a registered member, and the date must be within
 * a sane window. Confidence from the model is never a criterion.
 */

/** JSON schema passed to Gemini's structured output. */
function aiResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      intent: { type: 'STRING', enum: ['expense', 'refund', 'transfer', 'none', 'question'] },
      needs_clarification: { type: 'BOOLEAN' },
      question: { type: 'STRING' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            description: { type: 'STRING' },
            amount_decimal: { type: 'STRING' },
            date: { type: 'STRING' },
            category_id: { type: 'STRING' },
            payer_alias: { type: 'STRING' }
          },
          required: ['description', 'amount_decimal']
        }
      }
    },
    required: ['intent', 'needs_clarification', 'items']
  };
}

/** Digits of an amount as they could appear in the source text. */
function aiAmountAppearsInText_(amountDecimal, satang, text) {
  var t = moneyNormalizeDigits(String(text || '')).replace(/,/g, '');
  var candidates = {};
  var whole = Math.floor(satang / 100);
  candidates[String(whole)] = true;
  candidates[moneyToDecimalString(satang)] = true;
  candidates[String(amountDecimal).replace(/,/g, '')] = true;
  if (satang % 100 === 0) {
    candidates[String(whole)] = true;
    if (whole % 1000 === 0) candidates[String(whole / 1000) + 'k'] = true;
  }
  var found = Object.keys(candidates).some(function (c) { return c && t.indexOf(c) >= 0; });
  if (found) return true;
  // Thai number words, e.g. "ห้าพัน" for 5000
  var wordAmounts = parseFindThaiWordAmounts_(t);
  for (var i = 0; i < wordAmounts.length; i++) if (wordAmounts[i].satang === satang) return true;
  return false;
}

/**
 * Validates a raw model object against the user's text.
 * Returns { ok:true, result } in the same shape as parseMessage(), or
 * { ok:false, code } which the caller treats as "AI unusable".
 */
function aiValidate(raw, text, ctx) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'NOT_OBJECT' };
  var intents = ['expense', 'refund', 'transfer', 'none', 'question'];
  if (intents.indexOf(raw.intent) < 0) return { ok: false, code: 'BAD_INTENT' };

  if (raw.intent === 'none' || raw.intent === 'question') {
    return { ok: true, result: { kind: 'none', reason: raw.intent === 'question' ? 'QUESTION' : 'PLAN', source: 'ai' } };
  }
  if (raw.needs_clarification === true) {
    var q = String(raw.question || '').trim();
    if (!q) return { ok: false, code: 'NO_QUESTION' };
    if (q.length > 300) q = q.slice(0, 300);
    return { ok: true, result: { kind: 'clarify', code: 'AI_CLARIFY', question: q, data: { text: text }, source: 'ai' } };
  }
  if (!raw.items || !raw.items.length) return { ok: false, code: 'NO_ITEMS' };
  if (raw.items.length > 10) return { ok: false, code: 'TOO_MANY_ITEMS' };

  var today = ctx.todayISO || timeTodayISO();
  var earliest = timeAddDays(today, -370);
  var items = [];
  for (var i = 0; i < raw.items.length; i++) {
    var it = raw.items[i] || {};
    var satang = moneyParseToSatang(it.amount_decimal);
    if (satang === null || satang <= 0) return { ok: false, code: 'BAD_AMOUNT' };
    if (!aiAmountAppearsInText_(it.amount_decimal, satang, text)) return { ok: false, code: 'AMOUNT_NOT_IN_TEXT' };

    var date = it.date && timeIsValidDateISO(it.date) ? it.date : today;
    if (date > today) return { ok: false, code: 'FUTURE_DATE' };
    if (date < earliest) return { ok: false, code: 'DATE_TOO_OLD' };

    var categoryId = '';
    if (raw.intent !== 'transfer') {
      if (it.category_id && categoryById(it.category_id)) categoryId = it.category_id;
      else if (it.category_id) return { ok: false, code: 'UNKNOWN_CATEGORY' }; // never let AI invent one
    }

    var payerId = ctx.recorderMemberId;
    if (it.payer_alias) {
      var m = memberByAlias(it.payer_alias);
      if (!m) return { ok: false, code: 'UNKNOWN_PAYER' };
      payerId = m.member_id;
    }

    var desc = String(it.description || '').trim().slice(0, 120);
    if (!desc && raw.intent !== 'transfer') return { ok: false, code: 'NO_DESCRIPTION' };

    items.push({
      type: raw.intent,
      amount_satang: satang,
      description: desc,
      category_id: categoryId,
      category_source: categoryId ? 'ai' : 'unknown',
      occurred_date: date,
      payer_member_id: payerId,
      recorder_member_id: ctx.recorderMemberId,
      original_text: text
    });
  }

  var unknown = [];
  items.forEach(function (it, i) { if (it.type !== 'transfer' && !it.category_id) unknown.push(i); });
  return { ok: true, result: { kind: 'items', items: items, unknownCategoryIndexes: unknown, source: 'ai' } };
}
