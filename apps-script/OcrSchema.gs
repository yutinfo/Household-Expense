/**
 * OcrSchema.gs — response contract for slip/receipt reading, plus the
 * validator that decides what may reach the confirmation screen.
 *
 * Anything the model could not actually read must come back as null. The
 * validator refuses invented values, and the user still confirms every field
 * before a transaction is created.
 */

function ocrResponseSchema() {
  return {
    type: 'OBJECT',
    properties: {
      document_type: { type: 'STRING', enum: ['transfer_slip', 'receipt', 'unknown'] },
      readable: { type: 'BOOLEAN' },
      amount_decimal: { type: 'STRING', nullable: true },
      fee_decimal: { type: 'STRING', nullable: true },
      date: { type: 'STRING', nullable: true },
      time: { type: 'STRING', nullable: true },
      sender_name: { type: 'STRING', nullable: true },
      receiver_name: { type: 'STRING', nullable: true },
      receiver_account_masked: { type: 'STRING', nullable: true },
      merchant_name: { type: 'STRING', nullable: true },
      reference_no: { type: 'STRING', nullable: true },
      line_items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { name: { type: 'STRING' }, amount_decimal: { type: 'STRING' } },
          required: ['name', 'amount_decimal']
        }
      },
      subtotal_decimal: { type: 'STRING', nullable: true },
      vat_decimal: { type: 'STRING', nullable: true },
      discount_decimal: { type: 'STRING', nullable: true },
      total_decimal: { type: 'STRING', nullable: true },
      uncertain_fields: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    required: ['document_type', 'readable', 'uncertain_fields']
  };
}

function ocrNullable_(v) {
  if (v === null || v === undefined) return null;
  var s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s === '-') return null;
  return s;
}

/** Masks all but the last 4 digits of anything that looks like an account number. */
function ocrMaskAccount(text) {
  var s = ocrNullable_(text);
  if (!s) return null;
  return s.replace(/\d/g, function (d, i, str) { return i >= String(str).replace(/\D/g, '').length - 4 ? d : 'x'; })
    .replace(/(\d|x){5,}/g, function (m) { return m.slice(-8); });
}

/**
 * Validates a raw OCR object.
 * Returns {ok:true, data} where data has satang integers and null for anything
 * unreadable, or {ok:false, code}.
 */
function ocrValidate(raw, ctx) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'NOT_OBJECT' };
  if (['transfer_slip', 'receipt', 'unknown'].indexOf(raw.document_type) < 0) return { ok: false, code: 'BAD_DOC_TYPE' };
  if (raw.readable === false) return { ok: false, code: 'UNREADABLE' };

  var today = ctx && ctx.todayISO ? ctx.todayISO : timeTodayISO();
  var out = {
    document_type: raw.document_type,
    amount_satang: null,
    fee_satang: null,
    date: null,
    time: ocrNullable_(raw.time),
    sender_name: ocrNullable_(raw.sender_name),
    receiver_name: ocrNullable_(raw.receiver_name),
    receiver_account_masked: ocrMaskAccount(raw.receiver_account_masked),
    merchant_name: ocrNullable_(raw.merchant_name),
    reference_no: ocrNullable_(raw.reference_no),
    line_items: [],
    subtotal_satang: null,
    vat_satang: null,
    discount_satang: null,
    total_satang: null,
    uncertain: Array.isArray(raw.uncertain_fields) ? raw.uncertain_fields.map(String).slice(0, 12) : []
  };

  function toSatang(v, label) {
    var s = ocrNullable_(v);
    if (s === null) return null;
    var sat = moneyParseToSatang(s);
    if (sat === null) { out.uncertain.push(label); return null; }
    return sat;
  }

  out.amount_satang = toSatang(raw.amount_decimal, 'amount');
  out.fee_satang = toSatang(raw.fee_decimal, 'fee');
  out.subtotal_satang = toSatang(raw.subtotal_decimal, 'subtotal');
  out.vat_satang = toSatang(raw.vat_decimal, 'vat');
  out.discount_satang = toSatang(raw.discount_decimal, 'discount');
  out.total_satang = toSatang(raw.total_decimal, 'total');

  var d = ocrNullable_(raw.date);
  if (d) {
    var iso = ocrNormalizeDate_(d, today);
    if (iso && timeIsValidDateISO(iso) && iso <= today && iso >= timeAddDays(today, -400)) out.date = iso;
    else out.uncertain.push('date');
  }

  if (Array.isArray(raw.line_items)) {
    for (var i = 0; i < raw.line_items.length && i < 50; i++) {
      var li = raw.line_items[i] || {};
      var sat = moneyParseToSatang(li.amount_decimal);
      if (sat === null) continue;
      out.line_items.push({ name: String(li.name || '').slice(0, 60), amount_satang: sat });
    }
  }

  // A receipt's net amount is the total; line items must never be added on top of it.
  if (out.document_type === 'receipt') {
    if (out.total_satang !== null) out.amount_satang = out.total_satang;
    else if (out.amount_satang === null && out.subtotal_satang !== null) {
      out.amount_satang = out.subtotal_satang + (out.vat_satang || 0) - (out.discount_satang || 0);
      out.uncertain.push('total_derived');
    }
    if (out.amount_satang !== null && out.line_items.length) {
      var sumItems = out.line_items.reduce(function (a, b) { return a + b.amount_satang; }, 0);
      var expected = out.amount_satang + (out.discount_satang || 0) - (out.vat_satang || 0);
      if (Math.abs(sumItems - expected) > 100 && Math.abs(sumItems - out.amount_satang) > 100) {
        out.uncertain.push('line_items_mismatch');
      }
    }
  }

  // A transfer slip's expense is the transferred amount; the fee is separate.
  if (out.document_type === 'transfer_slip' && out.amount_satang === null && out.total_satang !== null) {
    out.amount_satang = out.total_satang;
  }

  if (out.amount_satang === null) out.uncertain.push('amount');
  out.uncertain = out.uncertain.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  return { ok: true, data: out };
}

/** Accepts 05/09/2026, 05/09/69 (BE), 2026-09-05, "5 ก.ย. 2569". */
function ocrNormalizeDate_(text, todayISO) {
  var s = moneyNormalizeDigits(String(text)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    var day = parseInt(m[1], 10), mon = parseInt(m[2], 10), yr = parseInt(m[3], 10);
    // 2-digit years: "69" is Buddhist-era shorthand (2569 = 2026), "26" is CE.
    if (yr < 100) yr = yr >= 50 ? 2500 + yr : 2000 + yr;
    if (yr > 2400) yr -= 543;
    if (yr < 2000 || yr > 2100) return null;
    return yr + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
  }
  var info = parseFindDate_(s, todayISO);
  return info && info.date ? info.date : null;
}
