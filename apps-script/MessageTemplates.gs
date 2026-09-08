/**
 * MessageTemplates.gs — every user-facing string and LINE message object.
 * Messages are plain text plus quick-reply postback buttons, which keeps the
 * payload small and works in group chats.
 */

function msgText(text, quickReplyItems) {
  var m = { type: 'text', text: String(text).slice(0, 4900) };
  if (quickReplyItems && quickReplyItems.length) {
    m.quickReply = { items: quickReplyItems.slice(0, 13) };
  }
  return m;
}

function msgPostbackItem(label, data, displayText) {
  return {
    type: 'action',
    action: {
      type: 'postback',
      label: String(label).slice(0, 20),
      data: String(data).slice(0, 300),
      displayText: displayText ? String(displayText).slice(0, 300) : undefined
    }
  };
}

/** Encodes postback data as a compact query string. */
function msgPostbackData(params) {
  return Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k] == null ? '' : params[k]);
  }).join('&');
}

function msgParsePostbackData(data) {
  var out = {};
  String(data || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf('=');
    var k = i < 0 ? pair : pair.slice(0, i);
    var v = i < 0 ? '' : pair.slice(i + 1);
    try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}

function msgTypeLabel(type) {
  return type === 'refund' ? 'เงินคืน' : (type === 'transfer' ? 'โอนภายใน' : 'รายจ่าย');
}

/** One transaction line: "T7K2QA อาหาร 200 บาท (ยุทธจ่าย) 8 ก.ย. 2026" */
function msgTxLine(tx) {
  var parts = [tx.transaction_id];
  parts.push(msgTypeLabel(tx.type));
  if (tx.description) parts.push(tx.description);
  parts.push(moneyFormatBaht(tx.amount_satang));
  if (tx.type !== 'transfer') parts.push('[' + categoryName(tx.category_id) + ']');
  parts.push('จ่ายโดย ' + memberName(tx.payer_member_id));
  parts.push(timeThaiDateLabel(tx.occurred_date));
  return parts.join(' · ');
}

function msgSavedTransactions(txs, extraLines) {
  var lines = ['✅ บันทึกแล้ว'];
  txs.forEach(function (t) { lines.push('• ' + msgTxLine(t)); });
  if (txs.length > 1) {
    var net = txNetExpense(txs);
    lines.push('รวมรายจ่าย ' + moneyFormatBaht(net));
  }
  (extraLines || []).forEach(function (l) { lines.push(l); });
  var quick = [];
  if (txs.length === 1) {
    quick.push(msgPostbackItem('แก้ไข', msgPostbackData({ a: 'edit_menu', tx: txs[0].transaction_id, rev: txs[0].revision })));
    quick.push(msgPostbackItem('ยกเลิกรายการ', msgPostbackData({ a: 'void_ask', tx: txs[0].transaction_id, rev: txs[0].revision })));
  } else {
    txs.forEach(function (t, i) {
      quick.push(msgPostbackItem('แก้ #' + (i + 1), msgPostbackData({ a: 'edit_menu', tx: t.transaction_id, rev: t.revision })));
    });
  }
  return msgText(lines.join('\n'), quick);
}

function msgAskCategory(actionId, item, indexLabel) {
  var quick = categoryList().map(function (c) {
    return msgPostbackItem(c.name, msgPostbackData({ a: 'cat', p: actionId, c: c.category_id }), c.name);
  });
  quick.push(msgPostbackItem('ไม่บันทึก', msgPostbackData({ a: 'cancel', p: actionId }), 'ไม่บันทึก'));
  var head = 'รายการนี้จัดหมวดไหนครับ' + (indexLabel ? ' (' + indexLabel + ')' : '');
  var body = '“' + item.description + '” ' + moneyFormatBaht(item.amount_satang);
  return msgText(head + '\n' + body + '\n(ยังไม่นับยอดจนกว่าจะเลือกหมวด)', quick);
}

function msgAskClarify(question, actionId) {
  var quick = [];
  if (actionId) quick.push(msgPostbackItem('ยกเลิก', msgPostbackData({ a: 'cancel', p: actionId }), 'ยกเลิก'));
  return msgText('❓ ' + question, quick);
}

function msgConfirmVoid(actionId, tx) {
  var lines = ['ยืนยันยกเลิกรายการนี้ไหมครับ', 'ก่อน: ' + msgTxLine(tx), 'หลัง: รายการจะเป็นสถานะยกเลิก และยอดสรุปจะลดลง'];
  return msgText(lines.join('\n'), [
    msgPostbackItem('ยืนยันยกเลิก', msgPostbackData({ a: 'void_do', p: actionId }), 'ยืนยันยกเลิก'),
    msgPostbackItem('ไม่ยกเลิก', msgPostbackData({ a: 'cancel', p: actionId }), 'ไม่ยกเลิก')
  ]);
}

function msgEditMenu(tx) {
  var quick = [
    msgPostbackItem('เปลี่ยนหมวด', msgPostbackData({ a: 'edit_cat_menu', tx: tx.transaction_id, rev: tx.revision })),
    msgPostbackItem('ยกเลิกรายการ', msgPostbackData({ a: 'void_ask', tx: tx.transaction_id, rev: tx.revision }))
  ];
  var lines = [
    'รายการ: ' + msgTxLine(tx),
    'แก้ยอด/วันที่ พิมพ์ได้เลย เช่น',
    '  แก้ ' + tx.transaction_id + ' ยอด 250',
    '  แก้ ' + tx.transaction_id + ' หมวด อาหาร',
    '  แก้ ' + tx.transaction_id + ' วันที่ ' + tx.occurred_date
  ];
  return msgText(lines.join('\n'), quick);
}

function msgEditCategoryMenu(tx) {
  var quick = categoryList().map(function (c) {
    return msgPostbackItem(c.name, msgPostbackData({ a: 'edit_cat', tx: tx.transaction_id, rev: tx.revision, c: c.category_id }), c.name);
  });
  return msgText('เลือกหมวดใหม่สำหรับ ' + tx.transaction_id + ' (' + tx.description + ')', quick);
}

function msgConfirmEdit(actionId, before, afterPreview) {
  return msgText([
    'ยืนยันการแก้ไขไหมครับ',
    'ก่อน: ' + msgTxLine(before),
    'หลัง: ' + afterPreview
  ].join('\n'), [
    msgPostbackItem('ยืนยัน', msgPostbackData({ a: 'edit_do', p: actionId }), 'ยืนยัน'),
    msgPostbackItem('ไม่แก้', msgPostbackData({ a: 'cancel', p: actionId }), 'ไม่แก้')
  ]);
}

function msgAskLearnRule(actionId, keyword, categoryId) {
  return msgText('จำไว้ไหมครับว่า “' + keyword + '” = ' + categoryName(categoryId) + '?', [
    msgPostbackItem('จำไว้', msgPostbackData({ a: 'learn_yes', p: actionId }), 'จำไว้'),
    msgPostbackItem('ครั้งนี้ครั้งเดียว', msgPostbackData({ a: 'learn_no', p: actionId }), 'ครั้งนี้ครั้งเดียว')
  ]);
}

function msgHelp() {
  return msgText([
    '📌 วิธีใช้',
    '',
    'บันทึกรายจ่าย: พิมพ์ตามปกติ',
    '  ค่าส้มตำ 200',
    '  กาแฟ 65 ข้าว 80',
    '  เมื่อวานเติมน้ำมัน 300',
    '  ผ้าอ้อมลูก 499 เมียจ่าย',
    '',
    'เงินคืน: คืนของได้เงินคืน 50',
    'โอนกันเอง (ไม่นับรายจ่าย): โอนให้เมีย 3000',
    '',
    'ดูยอด: วันนี้ / เดือนนี้ / เดือนนี้ค่าอาหารเท่าไหร่ / เทียบเดือนก่อน / เดือนนี้ใครจ่ายเท่าไหร่',
    'รายการ: รายการล่าสุด',
    'แก้ไข: แก้ T12345 ยอด 250 · แก้ T12345 หมวด อาหาร',
    'ยกเลิก: ยกเลิก T12345',
    'งบ: ตั้งงบอาหาร 8000 เดือนนี้ · เหลืองบอาหารเท่าไหร่',
    'กฎที่จำไว้: กฎที่จำ · ลืมกฎ R0001',
    'สถานะระบบ: สถานะ'
  ].join('\n'));
}

function msgAccepted() {
  return msgText('📥 รับไว้แล้ว กำลังประมวลผล\nพิมพ์ "สถานะ" เพื่อตรวจผลได้ครับ');
}

function msgError(code) {
  return msgText('⚠️ ระบบมีปัญหาชั่วคราว (' + code + ')\nข้อความถูกเก็บไว้แล้ว พิมพ์ "สถานะ" เพื่อตรวจผล หรือส่งใหม่อีกครั้งได้ครับ');
}

function msgNotUnderstood() {
  return msgText('ไม่แน่ใจว่าจะบันทึกอะไรครับ ถ้าเป็นรายจ่ายพิมพ์ชื่อรายการกับจำนวนเงิน เช่น "ค่าข้าว 120"\nพิมพ์ "ช่วยเหลือ" เพื่อดูวิธีใช้');
}
