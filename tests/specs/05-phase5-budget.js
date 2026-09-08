'use strict';
/** Phase 5 — budgets, alerts, dashboard, comparisons, push quota. */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');
const { sendText, press } = require('../harness/chat');

function setBudget(ctx, text, amountLabel) {
  const ask = sendText(ctx, text);
  return press(ctx, ask.first, 'ยืนยัน');
}

describe('Phase 5 · budgets', () => {
  it('setting a budget shows before/after and needs confirmation', () => {
    const ctx = bootProject();
    const ask = sendText(ctx, 'ตั้งงบอาหาร 8000 เดือนนี้');
    assert.includes(ask.text, 'ยังไม่ตั้งงบ');
    assert.includes(ask.text, '8,000 บาท');
    assert.equal(ctx.budgetGet('2026-09', 'food'), null, 'not applied before confirming');
    const done = press(ctx, ask.first, 'ยืนยัน');
    assert.includes(done.text, 'ตั้งงบ');
    assert.equal(ctx.budgetGet('2026-09', 'food').limit_satang, 800000);
  });

  it('a category with no budget says so instead of inventing one', () => {
    const ctx = bootProject();
    const r = sendText(ctx, 'เหลืองบอาหารเท่าไหร่');
    assert.includes(r.text, 'ยังไม่ตั้งงบ');
    assert.notIncludes(r.text, '%');
  });

  it('remaining budget follows the recorded spending', () => {
    const ctx = bootProject();
    setBudget(ctx, 'ตั้งงบอาหาร 1000 เดือนนี้');
    sendText(ctx, 'ค่าข้าว 300');
    const r = sendText(ctx, 'เหลืองบอาหารเท่าไหร่');
    assert.includes(r.text, 'ใช้ไป 300 บาท');
    assert.includes(r.text, 'เหลือ 700 บาท');
  });

  it('refunds and cancellations move the remaining budget back', () => {
    const ctx = bootProject();
    setBudget(ctx, 'ตั้งงบอาหาร 1000 เดือนนี้');
    const saved = sendText(ctx, 'ค่าข้าว 300');
    sendText(ctx, 'คืนข้าว ได้เงินคืน 100');
    let r = ctx.budgetRemaining('2026-09', 'food');
    assert.equal(r.remaining, 80000, '1000 - (300-100) = 800');
    ctx.txVoid(saved.transactions[0].transaction_id, 'yut', null, '');
    r = ctx.budgetRemaining('2026-09', 'food');
    assert.equal(r.remaining, 110000, 'cancelling the 300 leaves 1000 + 100 refund');
  });
});

describe('Phase 5 · alerts', () => {
  it('warns at 80% inside the save reply and never repeats the same threshold', () => {
    const ctx = bootProject();
    setBudget(ctx, 'ตั้งงบอาหาร 1000 เดือนนี้');
    const first = sendText(ctx, 'ค่าข้าว 850');
    assert.includes(first.text, 'ใกล้เต็มงบ');
    const second = sendText(ctx, 'ค่ากาแฟ 20');
    assert.notIncludes(second.text, 'ใกล้เต็มงบ', 'the 80% alert is not repeated');
    assert.equal(ctx.repoReadAll('Notifications').rows.length, 1);
  });

  it('warns again at 100% but only once', () => {
    const ctx = bootProject();
    setBudget(ctx, 'ตั้งงบอาหาร 1000 เดือนนี้');
    sendText(ctx, 'ค่าข้าว 850');
    const over = sendText(ctx, 'ค่าข้าวเย็น 300');
    assert.includes(over.text, 'เกินงบ');
    const keys = ctx.repoReadAll('Notifications').rows.map(r => r.notification_key);
    assert.equal(keys.length, 2);
    const again = sendText(ctx, 'ค่าขนม 50');
    assert.equal(ctx.repoReadAll('Notifications').rows.length, 2, 'no duplicate alerts');
    assert.notIncludes(again.text, 'เกินงบ');
  });

  it('a repeated trigger run does not resend an alert', () => {
    const ctx = bootProject({ properties: { PUSH_ENABLED: 'true', DAILY_SUMMARY_ENABLED: 'true' } });
    ctx.__mock.setFetchHandler(() => ({ status: 200, body: {} }));
    setBudget(ctx, 'ตั้งงบอาหาร 1000 เดือนนี้');
    ctx.repoReadAll('Notifications').rows.forEach(() => {});
    sendText(ctx, 'ค่าข้าว 900');
    const before = ctx.repoReadAll('Notifications').rows.length;
    ctx.scheduledDailySummary();
    ctx.scheduledDailySummary();
    assert.equal(ctx.repoReadAll('Notifications').rows.length, before, 'thresholds already sent stay sent');
  });
});

describe('Phase 5 · reports and dashboard', () => {
  it('T21 the LINE answer and the Dashboard agree for the same range', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 120');
    sendText(ctx, 'เติมน้ำมัน 300');
    sendText(ctx, 'คืนข้าว ได้เงินคืน 20');
    ctx.dashboardRefresh('2026-09');

    const totals = ctx.reportMonthTotals('2026-09');
    const sheet = ctx.__mock.getSpreadsheet('TEST_SS').getSheetByName('Dashboard');
    const netRow = sheet.data.find(r => r[0] === 'รายจ่ายสุทธิ (บาท)');
    assert.equal(Number(netRow[1]), Number(ctx.moneyToDecimalString(totals.net)));
    assert.equal(Number(netRow[1]), 400, '120 + 300 - 20');

    const lineAnswer = sendText(ctx, 'เดือนนี้');
    assert.includes(lineAnswer.text, '400 บาท');
  });

  it('the dashboard marks categories without a budget', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 120');
    ctx.dashboardRefresh('2026-09');
    const sheet = ctx.__mock.getSpreadsheet('TEST_SS').getSheetByName('Dashboard');
    const foodRow = sheet.data.find(r => r[0] === 'อาหาร');
    assert.equal(foodRow[2], 'ยังไม่ตั้งงบ');
  });

  it('comparing months uses the same day window and says so', () => {
    const ctx = bootProject();
    ctx.inboxReceiveMany([{ eventId: 'EPREV', payload: {} }]);
    ctx.txCommitBatch('EPREV', [
      { type: 'expense', amount_satang: 50000, description: 'ข้าว', category_id: 'food', occurred_date: '2026-08-03', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'expense', amount_satang: 90000, description: 'ข้าว', category_id: 'food', occurred_date: '2026-08-20', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ]);
    ctx.inboxComplete('EPREV', {}, '');
    sendText(ctx, 'ค่าข้าว 100', 'yut', { todayISO: '2026-09-08' });

    const r = sendText(ctx, 'เทียบเดือนก่อน', 'yut', { todayISO: '2026-09-08' });
    assert.includes(r.text, 'เทียบช่วงวันที่ 1–8');
    assert.includes(r.text, 'เดือนนี้ 100 บาท');
    assert.includes(r.text, 'เดือนก่อน 500 บาท', 'only 1-8 Aug counts, not the whole month');
  });

  it('with no previous month it refuses to compute a percentage', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 100');
    const r = sendText(ctx, 'เทียบเดือนก่อน');
    assert.includes(r.text, 'เทียบเป็นเปอร์เซ็นต์ไม่ได้');
    assert.notIncludes(r.text, '%');
  });

  it('shows who paid what without splitting anything in half', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 100', 'yut');
    sendText(ctx, 'ค่ากาแฟ 60', 'wife');
    const r = sendText(ctx, 'เดือนนี้ใครจ่ายเท่าไหร่');
    assert.includes(r.text, 'ยุทธ 100 บาท');
    assert.includes(r.text, 'ภรรยา 60 บาท');
    assert.includes(r.text, 'ไม่หารครึ่ง');
  });
});

describe('Phase 5 · push quota', () => {
  it('T20 reports still work through Reply when push is off', () => {
    const ctx = bootProject({ properties: { PUSH_ENABLED: 'false' } });
    sendText(ctx, 'ค่าข้าว 100');
    const res = ctx.notifyPush([ctx.msgText('hi')]);
    assert.equal(res.sent, false);
    assert.equal(res.reason, 'PUSH_DISABLED');
    const r = sendText(ctx, 'เดือนนี้');
    assert.includes(r.text, '100 บาท', 'the on-demand report is unaffected');
  });

  it('push stops before the quota is gone and keeps a reserve', () => {
    const ctx = bootProject({ properties: { PUSH_ENABLED: 'true', PUSH_MONTHLY_QUOTA: '10', PUSH_RESERVE_FOR_RECOVERY: '4' } });
    ctx.__mock.setFetchHandler(() => ({ status: 200, body: {} }));
    let sent = 0;
    for (let i = 0; i < 6; i++) if (ctx.notifyPush([ctx.msgText('x')]).sent) sent++;
    assert.equal(sent, 3, '10 - 4 reserved = 6 recipients = 3 pushes of 2 people');
    assert.equal(ctx.notifyPush([ctx.msgText('x')]).reason, 'QUOTA_EXHAUSTED');
    assert.equal(ctx.notifyPush([ctx.msgText('x')], { useReserve: true }).sent, true, 'the reserve is available for recovery');
  });
});
