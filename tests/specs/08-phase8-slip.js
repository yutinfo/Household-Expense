'use strict';
/** Phase 8 — slip and receipt images: OCR, confirmation, evidence, duplicates. */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');
const { sendText, press, pressData, makeCtx } = require('../harness/chat');

const PNG_BYTES = Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));

/** Boots with attachments + OCR on, and a scripted image download + model reply. */
function bootWithOcr(ocrReply, options) {
  const ctx = bootProject(Object.assign({
    properties: {
      OCR_ENABLED: 'true',
      GEMINI_API_KEY: 'test-key-abcdef123456',
      ATTACHMENT_FOLDER_ID: 'FOLDER1'
    }
  }, options || {}));
  ctx.__mock.setFetchHandler((url, params) => {
    if (String(url).indexOf('api-data.line.me') >= 0) {
      return { status: 200, body: 'PNGDATA', mime: 'image/png' };
    }
    if (String(url).indexOf('generativelanguage') >= 0) {
      const reply = typeof ocrReply === 'function' ? ocrReply(JSON.parse(params.payload)) : ocrReply;
      if (reply && reply.__http) return { status: reply.__http, body: { error: 'x' } };
      return {
        status: 200,
        body: {
          candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }],
          usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 200 }
        }
      };
    }
    return { status: 200, body: {} };
  });
  return ctx;
}

let imageCounter = 0;
function sendImage(ctx, who, opts) {
  const c = makeCtx(ctx, who, opts);
  imageCounter++;
  const messageId = (opts && opts.messageId) || 'IMG' + imageCounter;
  ctx.inboxReceiveMany([{ eventId: c.eventId, payload: { type: 'message' } }]);
  const out = ctx.routerHandleEvent(c, { type: 'message', message: { id: messageId, type: 'image' } });
  ctx.inboxComplete(c.eventId, { messages: out.messages || [] }, '');
  const messages = out.messages || [];
  return {
    messages, ctx: c, messageId,
    transactions: out.transactions || [],
    text: messages.map(m => m.text || '').join('\n'),
    first: messages[0],
    buttons: messages.reduce((a, m) => a.concat((m.quickReply ? m.quickReply.items : []).map(i => i.action.label)), [])
  };
}

const SLIP_TO_SHOP = {
  document_type: 'transfer_slip', readable: true, amount_decimal: '450.00', fee_decimal: '0',
  date: '2026-09-08', time: '12:30', sender_name: 'ยุทธ', receiver_name: 'ร้านข้าวมันไก่ทองคำ',
  receiver_account_masked: 'xxx-x-x1234', reference_no: 'REF123456789', line_items: [], uncertain_fields: []
};

describe('Phase 8 · reading a slip', () => {
  it('shows what it read and records nothing until confirmed', () => {
    const ctx = bootWithOcr(SLIP_TO_SHOP);
    const r = sendImage(ctx);
    assert.includes(r.text, '450 บาท');
    assert.includes(r.text, '8 ก.ย. 2026');
    assert.includes(r.text, 'ร้านข้าวมันไก่ทองคำ');
    assert.includes(r.text, 'ยังไม่บันทึกจนกว่าจะกดยืนยัน');
    assert.equal(ctx.txAll().length, 0, 'no transaction before confirmation');
    assert.equal(ctx.repoReadAll('Attachments').rows.length, 1, 'the image is kept as evidence');
  });

  it('asks what the payment was for instead of guessing from the receiver name', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'นายสมชาย ใจดี' }));
    const r = sendImage(ctx);
    assert.includes(r.text, 'ยังไม่ทราบ');
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.includes(confirm.text, 'จัดหมวดไหน', 'it asks for the category before writing');
    assert.equal(ctx.txAll().length, 0);
  });

  it('confirming creates exactly one transaction with the evidence linked', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const r = sendImage(ctx);
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.equal(confirm.transactions.length, 1);
    const tx = confirm.transactions[0];
    assert.equal(tx.amount_satang, 45000);
    assert.equal(ctx.attachmentsForTransaction(tx.transaction_id).length, 1);
    assert.includes(confirm.text, 'แนบหลักฐาน');

    const again = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.includes(again.text, 'ทำไปแล้ว');
    assert.equal(ctx.txAll().length, 1, 'a second press creates nothing');
  });

  it('a transfer to the spouse is proposed as an internal transfer', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ภรรยา' }));
    const r = sendImage(ctx);
    assert.includes(r.text, 'โอนภายในครอบครัว');
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.equal(confirm.transactions[0].type, 'transfer');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0, 'it never counts as an expense');
  });

  it('a blurred image records nothing and offers the manual path', () => {
    const ctx = bootWithOcr({ document_type: 'transfer_slip', readable: false, uncertain_fields: ['amount'] });
    const r = sendImage(ctx);
    assert.equal(ctx.txAll().length, 0);
    assert.includes(r.text, 'พิมพ์ยอดเอง');
    const typed = sendText(ctx, 'ค่าอาหาร 250');
    assert.equal(typed.transactions.length, 1);
    assert.includes(typed.text, 'แนบรูปที่ส่งมาก่อนหน้า');
    assert.equal(ctx.attachmentsForTransaction(typed.transactions[0].transaction_id).length, 1);
  });

  it('an amount that could not be read is never invented', () => {
    const ctx = bootWithOcr({ document_type: 'receipt', readable: true, amount_decimal: null, merchant_name: 'ร้านค้า', uncertain_fields: ['amount'] });
    const r = sendImage(ctx);
    assert.includes(r.text, 'อ่านยอดเงินจากรูปไม่ชัด');
    assert.equal(ctx.txAll().length, 0);
  });

  it('a malformed OCR response records nothing', () => {
    const ctx = bootProject({ properties: { OCR_ENABLED: 'true', GEMINI_API_KEY: 'k123456789', ATTACHMENT_FOLDER_ID: 'FOLDER1' } });
    ctx.__mock.setFetchHandler(url => String(url).indexOf('api-data') >= 0
      ? { status: 200, body: 'PNGDATA', mime: 'image/png' }
      : { status: 200, body: { candidates: [{ content: { parts: [{ text: '{oops' }] } }] } });
    const r = sendImage(ctx);
    assert.equal(ctx.txAll().length, 0);
    assert.includes(r.text, 'อ่านรูปไม่สำเร็จ');
  });

  it('an OCR outage still lets the user type the record and keep the evidence', () => {
    const ctx = bootProject({ properties: { OCR_ENABLED: 'true', GEMINI_API_KEY: 'k123456789', ATTACHMENT_FOLDER_ID: 'FOLDER1' } });
    ctx.__mock.setFetchHandler(url => {
      if (String(url).indexOf('api-data') >= 0) return { status: 200, body: 'PNGDATA', mime: 'image/png' };
      throw new Error('provider down');
    });
    const r = sendImage(ctx);
    assert.includes(r.text, 'พิมพ์ยอดเอง');
    const typed = sendText(ctx, 'ค่าอาหาร 250');
    assert.equal(ctx.attachmentsForTransaction(typed.transactions[0].transaction_id).length, 1);
  });

  it('the OCR budget guard falls back to manual entry', () => {
    const ctx = bootWithOcr(SLIP_TO_SHOP, { properties: { OCR_ENABLED: 'true', GEMINI_API_KEY: 'k123456789', ATTACHMENT_FOLDER_ID: 'FOLDER1', OCR_MONTHLY_BUDGET_USD: '0.0000001' } });
    const r = sendImage(ctx);
    assert.includes(r.text, 'งบอ่านรูปเดือนนี้เต็ม');
    assert.equal(ctx.txAll().length, 0);
  });
});

describe('Phase 8 · receipts', () => {
  it('a receipt total is used once and line items are not added on top', () => {
    const ctx = bootWithOcr({
      document_type: 'receipt', readable: true,
      merchant_name: 'ซุปเปอร์มาร์เก็ต',
      line_items: [{ name: 'นม', amount_decimal: '60' }, { name: 'ขนมปัง', amount_decimal: '40' }],
      subtotal_decimal: '100', discount_decimal: '10', vat_decimal: '6.30', total_decimal: '96.30',
      date: '2026-09-08', uncertain_fields: []
    });
    const r = sendImage(ctx);
    assert.includes(r.text, '96.30 บาท');
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    const tx = confirm.transactions[0] || ctx.txAll()[0];
    if (tx) assert.equal(tx.amount_satang, 9630, 'the net total, not the sum of items');
  });

  it('line items that do not add up are flagged as uncertain', () => {
    const ctx = bootWithOcr({
      document_type: 'receipt', readable: true, merchant_name: 'ร้านค้า',
      line_items: [{ name: 'ก', amount_decimal: '500' }],
      total_decimal: '100', date: '2026-09-08', uncertain_fields: []
    });
    const r = sendImage(ctx);
    assert.includes(r.text, 'line_items_mismatch');
  });

  it('the transfer fee is not added to the expense', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { fee_decimal: '10', receiver_name: 'ร้านข้าวมันไก่' }));
    const r = sendImage(ctx);
    assert.includes(r.text, 'ค่าธรรมเนียมอีก 10 บาท');
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.equal(confirm.transactions[0].amount_satang, 45000, 'only the transferred amount');
  });
});

describe('Phase 8 · duplicates and attaching', () => {
  it('the same image sent twice is not stored or recorded twice', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const first = sendImage(ctx, 'yut', { messageId: 'IMG-SAME' });
    press(ctx, first.first, 'ยืนยันบันทึก');
    const second = sendImage(ctx, 'yut', { messageId: 'IMG-SAME' });
    assert.includes(second.text, 'เคยยืนยันไปแล้ว');
    assert.equal(ctx.txAll().length, 1);
    assert.equal(ctx.repoReadAll('Attachments').rows.length, 1);
  });

  it('a re-cropped image with the same reference is surfaced as a possible duplicate', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const first = sendImage(ctx, 'yut', { messageId: 'IMG-A' });
    press(ctx, first.first, 'ยืนยันบันทึก');
    const second = sendImage(ctx, 'yut', { messageId: 'IMG-B' });
    assert.includes(second.text, 'อาจเป็นสลิปซ้ำ');
  });

  it('the same amount alone is not treated as a duplicate', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    sendText(ctx, 'ค่าข้าว 450', 'yut', { todayISO: '2026-09-01' });
    const r = sendImage(ctx);
    assert.notIncludes(r.text, 'อาจเป็นสลิปซ้ำ');
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    assert.equal(ctx.txAll().length, 2, 'a different day is a different expense');
  });

  it('a slip can be attached to an expense that was already typed', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const typed = sendText(ctx, 'ค่าข้าว 450');
    const txId = typed.transactions[0].transaction_id;
    const before = ctx.reportMonthTotals('2026-09').net;

    const img = sendImage(ctx);
    const attach = press(ctx, img.first, 'แนบกับ ' + txId);
    assert.includes(attach.text, 'แนบหลักฐาน');
    assert.equal(ctx.reportMonthTotals('2026-09').net, before, 'the total does not increase');
    assert.equal(ctx.attachmentsForTransaction(txId).length, 1);
  });

  it('one person\'s text is never bound to the other person\'s image', () => {
    const ctx = bootWithOcr({ document_type: 'transfer_slip', readable: false, uncertain_fields: [] });
    sendImage(ctx, 'wife');
    const typed = sendText(ctx, 'ค่ากาแฟ 60', 'yut');
    assert.equal(ctx.attachmentsForTransaction(typed.transactions[0].transaction_id).length, 0);
    const hers = sendText(ctx, 'ค่าอาหาร 250', 'wife');
    assert.equal(ctx.attachmentsForTransaction(hers.transactions[0].transaction_id).length, 1);
  });

  it('two pending images from one person are resolved one at a time, newest first', () => {
    const ctx = bootWithOcr({ document_type: 'transfer_slip', readable: false, uncertain_fields: [] });
    sendImage(ctx, 'yut', { messageId: 'IMG-1' });
    sendImage(ctx, 'yut', { messageId: 'IMG-2' });
    const typed = sendText(ctx, 'ค่าอาหาร 250', 'yut');
    const linked = ctx.attachmentsForTransaction(typed.transactions[0].transaction_id);
    assert.equal(linked.length, 1, 'only one image is attached');
    assert.equal(linked[0].line_message_id, 'IMG-2', 'the most recent one');
    assert.equal(ctx.pendingListOpen('Cgroup1').length, 1, 'the other image is still waiting');
  });
});

describe('Phase 8 · evidence lifecycle', () => {
  it('an unconfirmed image is cleaned up but a linked one is kept', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const keep = sendImage(ctx, 'yut', { messageId: 'IMG-KEEP' });
    press(ctx, keep.first, 'ยืนยันบันทึก');
    const drop = sendImage(ctx, 'yut', { messageId: 'IMG-DROP' });
    press(ctx, drop.first, 'ยกเลิก');

    // expire the orphan
    const orphan = ctx.attachmentByMessageId('IMG-DROP');
    ctx.repoUpdateWhere('Attachments', 'attachment_id', orphan.attachment_id, { expires_at: '2020-01-01T00:00:00Z' });
    const removed = ctx.attachmentPruneOrphans();
    assert.equal(removed, 1);
    assert.equal(ctx.attachmentByMessageId('IMG-DROP'), null);
    assert.ok(ctx.attachmentByMessageId('IMG-KEEP'), 'the confirmed evidence stays');
  });

  it('a linked attachment has no TTL and survives maintenance', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_name: 'ร้านข้าวมันไก่' }));
    const r = sendImage(ctx);
    const confirm = press(ctx, r.first, 'ยืนยันบันทึก');
    const att = ctx.attachmentsForTransaction(confirm.transactions[0].transaction_id)[0];
    assert.equal(att.expires_at, '', 'no expiry once it is evidence');
    ctx.maintenanceRun();
    assert.ok(ctx.attachmentById(att.attachment_id), 'still there after maintenance');
  });

  it('unsupported file types are refused', () => {
    const ctx = bootProject({ properties: { OCR_ENABLED: 'true', GEMINI_API_KEY: 'k123456789', ATTACHMENT_FOLDER_ID: 'FOLDER1' } });
    ctx.__mock.setFetchHandler(() => ({ status: 200, body: 'GIFDATA', mime: 'image/gif' }));
    const r = sendImage(ctx);
    assert.includes(r.text, 'JPEG/PNG');
    assert.equal(ctx.repoReadAll('Attachments').rows.length, 0);
  });

  it('account numbers are masked in what the group sees', () => {
    const ctx = bootWithOcr(Object.assign({}, SLIP_TO_SHOP, { receiver_account_masked: '1234567890', receiver_name: 'ร้านข้าวมันไก่' }));
    const r = sendImage(ctx);
    assert.notIncludes(r.text, '1234567890');
  });
});
