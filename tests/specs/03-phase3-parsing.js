'use strict';
/** Phase 3 — rule-based recording, editing, cancelling, basic reports (AI off). */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');
const { sendText, press } = require('../harness/chat');

describe('Phase 3 · recording from natural text', () => {
  it('T01 ค่าส้มตำ200 → 200 baht, food', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ค่าส้มตำ200');
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].amount_satang, 20000);
    assert.equal(r.transactions[0].category_id, 'food');
    assert.includes(r.text, 'บันทึกแล้ว');
  });

  it('T02 ซื้อของในอีเกีย 5000 → home', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ซื้อของในอีเกีย 5000');
    assert.equal(r.transactions[0].amount_satang, 500000);
    assert.equal(r.transactions[0].category_id, 'home');
  });

  it('T03 กินข้าวที่อีเกีย 200 → food beats the store rule', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'กินข้าวที่อีเกีย 200');
    assert.equal(r.transactions[0].category_id, 'food');
    assert.equal(r.transactions[0].amount_satang, 20000);
  });

  it('T04 กาแฟ 65 ข้าว 80 → two rows totalling 145', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'กาแฟ 65 ข้าว 80');
    assert.equal(r.transactions.length, 2);
    assert.equal(ctx.txNetExpense(r.transactions), 14500);
    assert.equal(r.transactions[0].description, 'กาแฟ');
    assert.equal(r.transactions[1].description, 'ข้าว');
  });

  it('T05 เมื่อวาน uses the Bangkok calendar date', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'เมื่อวานเติมน้ำมัน 300', 'yut', { todayISO: '2026-09-08' });
    assert.equal(r.transactions[0].occurred_date, '2026-09-07');
    assert.equal(r.transactions[0].category_id, 'travel');
  });

  it('T06 payer differs from recorder', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ผ้าอ้อมลูก 499 เมียจ่าย', 'yut');
    assert.equal(r.transactions[0].payer_member_id, 'wife');
    assert.equal(r.transactions[0].recorder_member_id, 'yut');
    assert.equal(r.transactions[0].category_id, 'child');
    assert.equal(r.transactions[0].amount_satang, 49900);
  });

  it('T07 โอนให้เมีย3000 is a transfer, not an expense', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'โอนให้เมีย 3000');
    assert.equal(r.transactions[0].type, 'transfer');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0);
    assert.equal(ctx.reportMonthTotals('2026-09').transfer, 300000);
  });

  it('T10 ว่าจะซื้อโต๊ะ 5000 records nothing', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ว่าจะซื้อโต๊ะ 5000');
    assert.equal(r.transactions.length, 0);
    assert.equal(ctx.txAll().length, 0);
  });

  it('T09 ซื้อของ 800 asks for a category and records nothing yet', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ซื้อของ 800');
    assert.equal(r.transactions.length, 0);
    assert.includes(r.text, 'หมวด');
    assert.equal(ctx.txAll().length, 0, 'nothing written while pending');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0);

    const chosen = press(ctx, r.first, 'ของใช้และตกแต่งบ้าน');
    assert.equal(chosen.transactions.length, 1);
    assert.equal(chosen.transactions[0].category_id, 'home');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 80000);
  });

  it('a total for several items is questioned instead of split', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'กาแฟข้าวรวม145');
    assert.equal(r.transactions.length, 0);
    assert.includes(r.text, 'แยกยอด');
  });

  it('an amount with no description is questioned', () => {
    const ctx = bootProject();
    const r = sendText(ctx, '350');
    assert.equal(r.transactions.length, 0);
    assert.includes(r.text, 'ค่าอะไร');
  });

  it('a future date is refused', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ค่าข้าว 100 วันที่ 20/12/2026', 'yut', { todayISO: '2026-09-08' });
    assert.equal(r.transactions.length, 0);
    assert.includes(r.text, 'อนาคต');
  });

  it('a day without a month is questioned', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'ค่าข้าว 100 วันที่ 5');
    assert.equal(r.transactions.length, 0);
    assert.includes(r.text, 'ระบุวันที่');
  });

  it('T08 refund reduces the category total', () => {
    const ctx = bootProject();
    sendText(ctx, 'ซื้อเสื้อ 500');
    const r = sendText(ctx, 'คืนเสื้อ ได้เงินคืน 200');
    assert.equal(r.transactions[0].type, 'refund');
    const totals = ctx.reportMonthTotals('2026-09');
    assert.equal(totals.net, 30000, '500 - 200 = 300 baht');
  });
});

describe('Phase 3 · editing and cancelling', () => {
  it('T14 pressing confirm twice only changes data once', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const txId = saved.transactions[0].transaction_id;
    const ask = sendText(ctx, 'ยกเลิก ' + txId);
    const first = press(ctx, ask.first, 'ยืนยันยกเลิก');
    assert.includes(first.text, 'ยกเลิกรายการ');
    const second = press(ctx, ask.first, 'ยืนยันยกเลิก');
    assert.includes(second.text, 'ทำไปแล้ว');
    assert.equal(ctx.txById(txId).revision, 2, 'revision only moved once');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0);
    assert.equal(ctx.auditListForTransaction(txId).length, 2, 'history kept: create + void');
  });

  it('T13 editing after someone else changed the row asks for a reload', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const txId = saved.transactions[0].transaction_id;
    const menu = press(ctx, saved.first, 'แก้ไข');
    const catMenu = press(ctx, menu.first, 'เปลี่ยนหมวด');

    // the other person edits first
    ctx.txEdit(txId, { amount_satang: 12000 }, 'wife', 1, '');

    const stale = press(ctx, catMenu.first, 'เดินทาง');
    assert.includes(stale.text, 'เพิ่งถูกแก้โดยอีกคน');
    assert.equal(ctx.txById(txId).category_id, 'food', 'the stale edit did not apply');
  });

  it('edit by command shows before/after and applies after confirmation', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const txId = saved.transactions[0].transaction_id;
    const ask = sendText(ctx, 'แก้ ' + txId + ' ยอด 250');
    assert.includes(ask.text, 'ก่อน:');
    assert.includes(ask.text, 'หลัง:');
    assert.equal(ctx.txById(txId).amount_satang, 10000, 'not applied before confirming');
    const done = press(ctx, ask.first, 'ยืนยัน');
    assert.equal(ctx.txById(txId).amount_satang, 25000);
    assert.includes(done.text, 'แก้แล้ว');
  });

  it('cancelling makes the report go down but keeps the history', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const txId = saved.transactions[0].transaction_id;
    assert.equal(ctx.reportMonthTotals('2026-09').net, 10000);
    ctx.txVoid(txId, 'yut', null, '');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0);
    assert.equal(ctx.txById(txId).status, 'void');
    assert.ok(ctx.auditListForTransaction(txId).length >= 2);
  });

  it('"แก้รายการล่าสุด" targets the sender\'s own latest entry', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 100', 'wife');
    const mine = sendText(ctx, 'ค่ากาแฟ 60', 'yut');
    const r = sendText(ctx, 'แก้รายการล่าสุด', 'yut');
    assert.includes(r.text, mine.transactions[0].transaction_id);
  });

  it('"แก้รายการล่าสุด" asks which one when the last message had several', () => {
    const ctx = bootProject();
    sendText(ctx, 'กาแฟ 65 ข้าว 80', 'yut');
    const r = sendText(ctx, 'แก้รายการล่าสุด', 'yut');
    assert.includes(r.text, 'เลือกรายการ');
  });
});

describe('Phase 3 · reports and concurrency', () => {
  it('T12 two people writing at once keep both rows', () => {
    const ctx = bootProject();
    const a = sendText(ctx, 'ค่าข้าว 100', 'yut');
    const b = sendText(ctx, 'ค่ากาแฟ 60', 'wife');
    assert.notEqual(a.transactions[0].transaction_id, b.transactions[0].transaction_id);
    assert.equal(ctx.txAll().length, 2);
    assert.equal(ctx.reportMonthTotals('2026-09').net, 16000);
  });

  it('reports state their date range and only count recorded rows', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 120');
    const r = sendText(ctx, 'เดือนนี้');
    assert.includes(r.text, 'รายการที่บันทึก');
    assert.includes(r.text, '1 ก.ย. 2026 – 30 ก.ย. 2026');
    assert.includes(r.text, '120 บาท');
  });

  it('answers a category question from the ledger', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าส้มตำ 200');
    sendText(ctx, 'เติมน้ำมัน 300');
    const r = sendText(ctx, 'เดือนนี้ค่าอาหารเท่าไหร่');
    assert.includes(r.text, '200 บาท');
    assert.notIncludes(r.text, '500');
  });

  it('empty ranges say so instead of inventing numbers', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'วันนี้');
    assert.includes(r.text, 'ยังไม่มีรายการ');
  });

  it('help and status work', () => {
    const ctx = bootProject();
    assert.includes(sendText(ctx, 'ช่วยเหลือ').text, 'วิธีใช้');
    const s = sendText(ctx, 'สถานะ');
    assert.includes(s.text, 'สถานะระบบ');
    assert.includes(s.text, 'AI: ปิด');
  });

  it('รายการล่าสุด lists ids that can be edited', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const r = sendText(ctx, 'รายการล่าสุด');
    assert.includes(r.text, saved.transactions[0].transaction_id);
  });
});
