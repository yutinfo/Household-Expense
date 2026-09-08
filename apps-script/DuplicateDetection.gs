/**
 * DuplicateDetection.gs — "have we already recorded this?" for slips.
 *
 * Levels of certainty:
 *   exact      — same LINE message ID, or byte-identical image (definitely the same upload)
 *   strong     — same reference number (a bank reference is unique per transfer)
 *   candidate  — same amount AND same date AND a matching counterpart/merchant
 * A matching amount on its own is never treated as a duplicate: two 200-baht
 * lunches on the same day are perfectly normal.
 */

function dupFindForAttachment(attachment, extracted) {
  var out = { exact: null, strong: [], candidates: [] };

  if (extracted && extracted.reference_no) {
    repoReadAll('Attachments').rows.forEach(function (a) {
      if (a.attachment_id === attachment.attachment_id) return;
      var ex = attachmentExtracted(a.attachment_id);
      if (ex && ex.reference_no && String(ex.reference_no) === String(extracted.reference_no)) {
        if (attachmentIsLinked(a.attachment_id)) out.strong.push({ attachment_id: a.attachment_id, reason: 'reference_no' });
      }
    });
  }

  if (extracted && extracted.amount_satang) {
    var date = extracted.date;
    txActiveCommitted().forEach(function (t) {
      if (Number(t.amount_satang) !== Number(extracted.amount_satang)) return;
      var sameDate = date ? t.occurred_date === date : false;
      if (!sameDate) return;
      var name = String(extracted.merchant_name || extracted.receiver_name || '').toLowerCase();
      var descMatch = name && String(t.description || '').toLowerCase().indexOf(name.slice(0, 6)) >= 0;
      out.candidates.push({ transaction_id: t.transaction_id, reason: descMatch ? 'amount_date_name' : 'amount_date', transaction: t });
    });
    out.candidates.sort(function (a, b) { return (b.reason === 'amount_date_name' ? 1 : 0) - (a.reason === 'amount_date_name' ? 1 : 0); });
    out.candidates = out.candidates.slice(0, 5);
  }
  return out;
}

/** Transactions the user could reasonably attach this slip to. */
function dupAttachableTransactions(extracted, memberId) {
  var rows = txActiveCommitted();
  var amount = extracted && extracted.amount_satang;
  var date = extracted && extracted.date;
  var scored = rows.map(function (t) {
    var score = 0;
    if (amount && Number(t.amount_satang) === Number(amount)) score += 3;
    if (date && t.occurred_date === date) score += 2;
    if (memberId && t.recorder_member_id === memberId) score += 1;
    if (attachmentsForTransaction(t.transaction_id).length) score -= 2;
    return { transaction: t, score: score };
  }).filter(function (s) { return s.score >= 3; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, 4).map(function (s) { return s.transaction; });
}
