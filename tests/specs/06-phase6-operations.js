'use strict';
/** Phase 6 — backup/restore, retention, reconciliation, operator tooling. */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');
const { sendText } = require('../harness/chat');

/** Copies every tab into a second spreadsheet and points the project at it. */
function restoreIntoCopy(ctx, newId) {
  const source = ctx.__mock.getSpreadsheet('TEST_SS');
  const copy = ctx.__mock.getSpreadsheet(newId);
  source.getSheets().forEach(sh => {
    const target = copy.getSheetByName(sh.getName()) || copy.insertSheet(sh.getName());
    target.data = sh.data.map(r => r.slice());
  });
  ctx.__mock.props.SPREADSHEET_ID = newId;
  ctx.configReset_();
  ctx.repoResetConnection_();
}

describe('Phase 6 · backup and restore', () => {
  it('creates a snapshot and keeps only the newest N', () => {
    const ctx = bootProject({ properties: { BACKUP_FOLDER_ID: 'FOLDER-BK', BACKUP_KEEP_COUNT: '3' } });
    for (let i = 0; i < 5; i++) ctx.backupRun();
    const kept = ctx.__mock.driveFiles.filter(f => f.folder === 'FOLDER-BK' && !f.trashed);
    assert.equal(kept.length, 3, 'older snapshots are trashed');
  });

  it('skips cleanly when no backup folder is configured', () => {
    const ctx = bootProject();
    const res = ctx.backupRun();
    assert.equal(res.ok, false);
    assert.equal(res.code, 'NO_FOLDER');
  });

  it('T22 a restored copy has the same row count and monthly totals', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 120');
    sendText(ctx, 'เติมน้ำมัน 300');
    sendText(ctx, 'คืนข้าว ได้เงินคืน 20');
    const before = ctx.backupFingerprint();
    const beforeTotals = ctx.reportMonthTotals('2026-09');

    restoreIntoCopy(ctx, 'TEST_SS_RESTORED');

    const after = ctx.backupFingerprint();
    assert.equal(after, before, 'fingerprints match after restore');
    assert.equal(ctx.reportMonthTotals('2026-09').net, beforeTotals.net);
    assert.equal(ctx.txAll().length, 3);
  });
});

describe('Phase 6 · retention', () => {
  it('expired questions are closed but the ledger is untouched', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    const ask = sendText(ctx, 'ซื้อของที่ร้านลุงหมี 800');
    const pending = ctx.pendingListOpen('Cgroup1')[0];
    ctx.repoUpdateWhere('PendingActions', 'action_id', pending.action_id, { expires_at: '2020-01-01T00:00:00Z' });

    const closed = ctx.pendingExpireOverdue();
    assert.equal(closed, 1);
    assert.equal(ctx.pendingGet(pending.action_id).status, 'expired');
    assert.equal(ctx.txAll().length, 1, 'the recorded expense is not touched');
    assert.ok(ctx.txById(saved.transactions[0].transaction_id));
  });

  it('old event rows are pruned but never the ones a ledger row still needs', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 100');
    const inbox = ctx.repoReadAll('Inbox').rows;
    inbox.forEach(r => ctx.repoUpdateWhere('Inbox', 'event_id', r.event_id, { completed_at: '2020-01-01T00:00:00Z', status: 'committed' }));

    // an unrelated, long-finished event with no transactions
    ctx.repoAppendRows('Inbox', [{
      event_id: 'EOLD', status: 'committed', expected_item_count: 0, lease_until: '',
      attempts: 1, received_at: '2020-01-01T00:00:00Z', completed_at: '2020-01-01T00:00:00Z',
      last_error_code: '', payload_json: '{}', result_json: '{}'
    }]);

    ctx.maintenancePruneInbox_();
    assert.equal(ctx.inboxGet('EOLD'), null, 'the orphan event row is gone');
    assert.equal(ctx.txAll().length, 1, 'the ledger row survives');
    assert.ok(ctx.inboxGet(ctx.txAll()[0].event_id), 'its event row is kept so reports still count it');
    assert.equal(ctx.reportMonthTotals('2026-09').net, 10000);
  });

  it('audit history is never removed by maintenance', () => {
    const ctx = bootProject();
    const saved = sendText(ctx, 'ค่าข้าว 100');
    ctx.txVoid(saved.transactions[0].transaction_id, 'yut', null, '');
    const before = ctx.repoReadAll('AuditLog').rows.length;
    ctx.maintenanceRun();
    assert.equal(ctx.repoReadAll('AuditLog').rows.length, before);
  });
});

describe('Phase 6 · reconciliation and status', () => {
  it('the audit spots a batch that is missing rows', () => {
    const ctx = bootProject();
    ctx.inboxReceiveMany([{ eventId: 'EBAD', payload: {} }]);
    ctx.inboxSetExpected_('EBAD', 2, [{ type: 'expense' }, { type: 'expense' }]);
    const issues = ctx.recoveryAudit();
    assert.ok(issues.some(i => i.indexOf('EBAD') >= 0), 'the incomplete batch is reported');
  });

  it('every job state is visible to the user', () => {
    const ctx = bootProject();
    sendText(ctx, 'ค่าข้าว 100');
    ctx.repoAppendRows('Inbox', [{
      event_id: 'EFAIL', status: 'failed', expected_item_count: 0, lease_until: '', attempts: 3,
      received_at: '2026-09-08T00:00:00Z', completed_at: '2026-09-08T00:01:00Z',
      last_error_code: 'LOCK_TIMEOUT', payload_json: '{}', result_json: ''
    }]);
    ctx.repoAppendRows('Inbox', [{
      event_id: 'EWAIT', status: 'queued', expected_item_count: 0, lease_until: '', attempts: 0,
      received_at: '2026-09-08T00:00:00Z', completed_at: '', last_error_code: '', payload_json: '{}', result_json: ''
    }]);
    const status = sendText(ctx, 'สถานะ').text;
    assert.includes(status, 'บันทึกสำเร็จ');
    assert.includes(status, 'รอประมวลผล: 1');
    assert.includes(status, 'ล้มเหลว: 1');
    assert.includes(status, 'LOCK_TIMEOUT');
  });

  it('the operator report never prints a secret', () => {
    const ctx = bootProject({ properties: { AI_ENABLED: 'true', GEMINI_API_KEY: 'super-secret-key-value-123' } });
    const report = ctx.maintenanceStatusReport();
    assert.notIncludes(report, 'super-secret-key-value-123');
    assert.includes(report, 'GEMINI_API_KEY: set');
  });

  it('redaction covers accidental logging of a secret', () => {
    const ctx = bootProject({ properties: { LINE_CHANNEL_ACCESS_TOKEN: 'tok-abcdefghijklmnop' } });
    const line = ctx.configRedact('failed with token tok-abcdefghijklmnop in body');
    assert.notIncludes(line, 'tok-abcdefghijklmnop');
    assert.includes(line, 'REDACTED');
  });

  it('AI and push can be switched off at runtime', () => {
    const ctx = bootProject({ properties: { AI_ENABLED: 'true', PUSH_ENABLED: 'true' } });
    assert.equal(ctx.getConfigBool('AI_ENABLED'), true);
    ctx.maintenanceDisableAi();
    ctx.maintenanceDisablePush();
    assert.equal(ctx.getConfigBool('AI_ENABLED'), false);
    assert.equal(ctx.getConfigBool('PUSH_ENABLED'), false);
    const r = sendText(ctx, 'ค่าข้าว 100');
    assert.equal(r.transactions.length, 1, 'recording still works with everything off');
  });

  it('installs and removes its own triggers', () => {
    const ctx = bootProject({ properties: { DAILY_SUMMARY_ENABLED: 'true' } });
    ctx.schedulerInstall();
    const handlers = ctx.__mock.triggers.map(t => t.fn);
    assert.ok(handlers.indexOf('recoveryRun') >= 0);
    assert.ok(handlers.indexOf('maintenanceRun') >= 0);
    assert.ok(handlers.indexOf('scheduledDailySummary') >= 0);
    ctx.schedulerInstall(); // rerun must not duplicate
    assert.equal(ctx.__mock.triggers.filter(t => t.fn === 'recoveryRun').length, 1);
    ctx.schedulerRemoveAll();
    assert.equal(ctx.__mock.triggers.length, 0);
  });
});
