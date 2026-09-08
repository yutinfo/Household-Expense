'use strict';
/** Phase 1 — money, schema, idempotency, batch recovery. */
const { describe, it, assert } = require('../harness/runner');
const { loadProject, bootProject } = require('../harness/load');

describe('Phase 1 · money', () => {
  const ctx = loadProject();

  it('0.10 + 0.20 baht is exactly 0.30 baht', () => {
    const a = ctx.moneyParseToSatang('0.10');
    const b = ctx.moneyParseToSatang('0.20');
    assert.equal(a, 10);
    assert.equal(b, 20);
    assert.equal(a + b, 30);
    assert.equal(ctx.moneyToDecimalString(a + b), '0.30');
  });

  it('parses thousands separators and rejects junk', () => {
    assert.equal(ctx.moneyParseToSatang('1,234.50'), 123450);
    assert.equal(ctx.moneyParseToSatang('฿200'), 20000);
    assert.equal(ctx.moneyParseToSatang('200บาท'), 20000);
    assert.equal(ctx.moneyParseToSatang('12.345'), null, 'three decimals must be rejected');
    assert.equal(ctx.moneyParseToSatang('abc'), null);
    assert.equal(ctx.moneyParseToSatang('๒๐๐'), 20000, 'thai digits');
  });

  it('formats satang back to baht', () => {
    assert.equal(ctx.moneyFormat(123450), '1,234.50');
    assert.equal(ctx.moneyFormat(20000), '200');
    assert.equal(ctx.moneyFormatBaht(5000), '50 บาท');
  });
});

describe('Phase 1 · setup', () => {
  it('creates every tab and reruns without losing data', () => {
    const ctx = loadProject();
    ctx.setupSpreadsheet();
    const names = Object.keys(ctx.SHEET_SCHEMA);
    names.forEach(n => assert.ok(ctx.repoGetSheet(n), `missing tab ${n}`));
    assert.equal(ctx.categoryList().length, 8);

    ctx.setupAddMember('yut', 'Uyut', 'ยุทธ', 'ยุทธ,สามี');
    ctx.repoAppendRows('Transactions', [{
      transaction_id: 'TSEED1', event_id: 'E1', item_index: 0, batch_id: 'B1',
      occurred_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z', type: 'expense',
      description: 'ทดสอบ', amount_satang: 100, category_id: 'food', payer_member_id: 'yut',
      recorder_member_id: 'yut', status: 'active', revision: 1, related_transaction_id: '',
      original_text: 'ทดสอบ 1', updated_at: '2026-09-01T00:00:00Z'
    }]);

    ctx.setupSpreadsheet(); // rerun
    assert.equal(ctx.txAll().length, 1, 'existing rows survive a rerun');
    assert.equal(ctx.memberList().length, 1, 'members survive a rerun');
    assert.equal(ctx.categoryList().length, 8, 'categories are not duplicated');
  });

  it('stores user text starting with = as literal text', () => {
    const ctx = bootProject();
    ctx.inboxReceiveMany([{ eventId: 'EF', payload: {} }]);
    ctx.txCommitBatch('EF', [{
      type: 'expense', amount_satang: 10000, description: '=SUM(A1:A9)', category_id: 'food',
      occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut',
      original_text: '=SUM(A1:A9) 100'
    }]);
    const sheet = ctx.__mock.getSpreadsheet('TEST_SS').getSheetByName('Transactions');
    const descCol = ctx.SHEET_SCHEMA.Transactions.indexOf('description');
    const stored = sheet.data[1][descCol];
    assert.equal(String(stored).charAt(0), "'", 'formula-looking text must be stored as literal');
    assert.equal(ctx.txById(ctx.txAll()[0].transaction_id).description, '=SUM(A1:A9)', 'reads back unchanged');
  });
});

describe('Phase 1 · ledger arithmetic', () => {
  it('expense 200, refund 50, transfer 3000 nets to 150 baht', () => {
    const ctx = bootProject();
    ctx.inboxReceiveMany([{ eventId: 'E1', payload: {} }]);
    ctx.txCommitBatch('E1', [
      { type: 'expense', amount_satang: 20000, description: 'ข้าว', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'refund', amount_satang: 5000, description: 'คืนของ', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'transfer', amount_satang: 300000, description: 'โอนให้เมีย', category_id: '', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ]);
    ctx.inboxComplete('E1', {}, '');
    const totals = ctx.reportMonthTotals('2026-09');
    assert.equal(totals.net, 15000, 'net expense is 150 baht');
    assert.equal(totals.transfer, 300000);
    assert.equal(totals.byCategory.food, 15000);
  });

  it('amounts are stored positive with direction in type', () => {
    const ctx = bootProject();
    ctx.inboxReceiveMany([{ eventId: 'E2', payload: {} }]);
    ctx.txCommitBatch('E2', [
      { type: 'refund', amount_satang: 5000, description: 'คืนของ', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ]);
    ctx.txAll().forEach(t => assert.ok(Number(t.amount_satang) > 0, 'no negative amounts in the sheet'));
  });
});

describe('Phase 1 · idempotency and recovery', () => {
  it('retrying the same event produces one set of rows', () => {
    const ctx = bootProject();
    const drafts = [
      { type: 'expense', amount_satang: 6500, description: 'กาแฟ', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'expense', amount_satang: 8000, description: 'ข้าว', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ];
    ctx.inboxReceiveMany([{ eventId: 'EDUP', payload: {} }]);
    ctx.txCommitBatch('EDUP', drafts);
    ctx.txCommitBatch('EDUP', drafts); // retry
    assert.equal(ctx.txByEvent('EDUP').length, 2, 'no duplicate rows on retry');
  });

  it('a crash mid-batch is repaired without duplicating the written rows', () => {
    const ctx = bootProject();
    const drafts = [
      { type: 'expense', amount_satang: 10000, description: 'ข้าว', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'expense', amount_satang: 20000, description: 'ของใช้', category_id: 'home', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'expense', amount_satang: 30000, description: 'น้ำมัน', category_id: 'travel', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ];
    ctx.inboxReceiveMany([{ eventId: 'EPART', payload: {} }]);

    // simulate: expectations recorded, only the first row written, then a crash
    ctx.inboxSetExpected_('EPART', 3, drafts);
    ctx.repoAppendRows('Transactions', [{
      transaction_id: 'TPART1', event_id: 'EPART', item_index: 0, batch_id: 'BPART',
      occurred_date: '2026-09-08', created_at: '2026-09-08T01:00:00Z', type: 'expense',
      description: 'ข้าว', amount_satang: 10000, category_id: 'food', payer_member_id: 'yut',
      recorder_member_id: 'yut', status: 'active', revision: 1, related_transaction_id: '',
      original_text: '', updated_at: '2026-09-08T01:00:00Z'
    }]);

    const before = ctx.reportMonthTotals('2026-09');
    assert.equal(before.net, 0, 'an uncommitted batch is excluded from reports');

    ctx.recoveryRun();

    const rows = ctx.txByEvent('EPART');
    assert.equal(rows.length, 3, 'recovery fills only the missing rows');
    assert.equal(rows.filter(r => r.transaction_id === 'TPART1').length, 1, 'the already-written row is untouched');
    const after = ctx.reportMonthTotals('2026-09');
    assert.equal(after.net, 60000, 'the repaired batch now counts once');
  });

  it('a batch counts only once every expected row exists', () => {
    const ctx = bootProject();
    const drafts = [
      { type: 'expense', amount_satang: 9900, description: 'ข้าว', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' },
      { type: 'expense', amount_satang: 100, description: 'ขนม', category_id: 'food', occurred_date: '2026-09-08', payer_member_id: 'yut', recorder_member_id: 'yut' }
    ];
    ctx.inboxReceiveMany([{ eventId: 'EOPEN', payload: {} }]);

    // only the first row makes it to the sheet, then the execution stops
    ctx.inboxSetExpected_('EOPEN', 2, drafts);
    ctx.repoAppendRows('Transactions', [{
      transaction_id: 'THALF', event_id: 'EOPEN', item_index: 0, batch_id: 'BHALF',
      occurred_date: '2026-09-08', created_at: '2026-09-08T01:00:00Z', type: 'expense',
      description: 'ข้าว', amount_satang: 9900, category_id: 'food', payer_member_id: 'yut',
      recorder_member_id: 'yut', status: 'active', revision: 1, related_transaction_id: '',
      original_text: '', updated_at: '2026-09-08T01:00:00Z'
    }]);
    assert.equal(ctx.inboxGet('EOPEN').status, 'queued');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 0, 'a half-written batch is not counted');

    ctx.txCommitBatch('EOPEN', drafts);
    assert.equal(ctx.inboxGet('EOPEN').status, 'committed');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 10000, 'counted as soon as the batch is complete');
  });
});
