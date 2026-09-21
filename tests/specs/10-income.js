'use strict';
/** Income — money coming in, kept apart from spending. */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');
const { sendText } = require('../harness/chat');

describe('รายรับ · บันทึกเงินเข้า', () => {
  it('I01 เงินเดือน 30000 → รายรับ ไม่มีหมวด', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'เงินเดือน 30000');
    assert.equal(r.transactions.length, 1);
    assert.equal(r.transactions[0].type, 'income');
    assert.equal(r.transactions[0].amount_satang, 3000000);
    assert.equal(r.transactions[0].category_id, '', 'รายรับไม่ควรมีหมวดรายจ่าย');
  });

  it('I02 โบนัส และ ขายของได้ ก็เป็นรายรับ', () => {
    assert.equal(sendText(bootProject(), 'โบนัส 5000').transactions[0].type, 'income');
    assert.equal(sendText(bootProject(), 'ขายของได้ 800').transactions[0].type, 'income');
  });

  it('I03 "ได้เงินคืน 200" ยังเป็นเงินคืน ไม่ใช่รายรับ', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'คืนเสื้อ ได้เงินคืน 200');
    assert.equal(r.transactions[0].type, 'refund', 'refund ต้องชนะ income เสมอ');
  });

  it('I04 รายรับไม่ไปเพิ่มยอดรายจ่าย', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าส้มตำ 200');
    sendText(ctx, 'เงินเดือน 30000');
    const t = ctx.reportMonthTotals('2026-09');
    assert.equal(t.net, 20000, 'รายจ่ายสุทธิต้องเป็น 200 บาทเท่านั้น');
    assert.equal(t.income, 3000000);
  });

  it('I05 รายรับไม่ถูกนับใน "ใครจ่ายเท่าไหร่"', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าส้มตำ 200');
    sendText(ctx, 'เงินเดือน 30000');
    const t = ctx.reportMonthTotals('2026-09');
    assert.equal(t.byPayer['yut'], 20000, 'ต้องเห็นแค่รายจ่าย 200');
  });

  it('I06 รายรับไม่โผล่ในหมวดใดหมวดหนึ่ง', () => {
    const ctx = bootProject();
    sendText(ctx, 'เงินเดือน 30000');
    const t = ctx.reportMonthTotals('2026-09');
    assert.deepEqual(Object.keys(t.byCategory), [], 'รายรับต้องไม่สร้างหมวด');
  });

  it('I07 สรุปเดือนแสดง รายรับ และ คงเหลือ', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าส้มตำ 200');
    sendText(ctx, 'เงินเดือน 30000');
    const text = ctx.reportTextForRange('เดือนนี้', '2026-09-01', '2026-09-30');
    assert.includes(text, 'รายรับ');
    assert.includes(text, 'คงเหลือ');
    assert.includes(text, '29,800', 'คงเหลือ = รายรับ 30,000 − รายจ่าย 200');
  });

  it('I08 เดือนที่ไม่มีรายรับ สรุปหน้าตาเหมือนเดิม', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าส้มตำ 200');
    const text = ctx.reportTextForRange('เดือนนี้', '2026-09-01', '2026-09-30');
    assert.notIncludes(text, 'รายรับ');
    assert.notIncludes(text, 'คงเหลือ');
  });

  it('I09 ข้อความบันทึกเขียนว่า "รับโดย" ไม่ใช่ "จ่ายโดย"', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'เงินเดือน 30000');
    assert.includes(r.text, 'รับโดย');
    assert.notIncludes(r.text, 'จ่ายโดย');
    assert.includes(r.text, 'รายรับ');
  });

  it('I10 รายรับไม่กินงบประมาณของหมวด', () => {
    const ctx = bootProject();
    ctx.budgetSet('2026-09', 'food', 100000);
    sendText(ctx, 'เงินเดือน 30000');
    const t = ctx.reportMonthTotals('2026-09');
    assert.equal(ctx.budgetPendingAlerts('2026-09', t).length, 0, 'รายรับต้องไม่ทำให้งบเตือน');
  });

  it('I11 หลายยอดในข้อความรายรับเดียว → ถามให้แยกพิมพ์', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'เงินเดือน 30000 โบนัส 5000');
    assert.equal(r.transactions.length, 0, 'ห้ามเดาว่ายอดไหนคือรายรับ');
  });
});

describe('Members · กันแถวขยะ', () => {
  it('I12 setupAddMember ปฏิเสธเมื่อถูกกดเรียกใช้โดยไม่มีอาร์กิวเมนต์', () => {
    const ctx = bootProject();
    const before = ctx.memberList().length;
    assert.throws(() => ctx.setupAddMember(), 'ต้องโยน error ไม่ใช่เขียนแถวว่าง');
    assert.throws(() => ctx.setupAddMember('x', '', '  ', ''), 'ชื่อว่างก็ต้องปฏิเสธ');
    assert.equal(ctx.memberList().length, before, 'ห้ามมีแถวใหม่เกิดขึ้น');
  });
});
