'use strict';
/** Phase 2 — signed transport, allowlists, idempotent delivery. */
const crypto = require('crypto');
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');

const SECRET = 'internal-secret-for-tests-0123456789';

function envelope(bodyObj, opts) {
  opts = opts || {};
  const body = JSON.stringify(bodyObj);
  const bodyB64 = Buffer.from(body, 'utf8').toString('base64');
  const timestamp = opts.timestamp || Date.now();
  const nonce = opts.nonce || crypto.randomUUID();
  const message = ['1', timestamp, nonce, bodyB64].join('.');
  const signature = opts.signature || crypto.createHmac('sha256', opts.secret || SECRET).update(message).digest('hex');
  return { v: '1', timestamp, nonce, body_b64: bodyB64, signature };
}

function post(ctx, bodyObj, opts) {
  const env = envelope(bodyObj, opts);
  const res = ctx.doPost({ postData: { contents: JSON.stringify(env) } });
  return JSON.parse(res.getContent());
}

function textEvent(text, opts) {
  opts = opts || {};
  return {
    type: 'message',
    webhookEventId: opts.eventId || ('WE' + Math.random().toString(36).slice(2, 10)),
    timestamp: 1757300000000,
    replyToken: opts.replyToken || 'RT' + Math.random().toString(36).slice(2, 8),
    source: { type: 'group', groupId: opts.groupId || 'Cgroup1', userId: opts.userId || 'Uyut' },
    message: { id: 'M' + Math.random().toString(36).slice(2, 10), type: 'text', text }
  };
}

describe('Phase 2 · envelope verification', () => {
  it('accepts a correctly signed request and records the expense', () => {
    const ctx = bootProject();
    const res = post(ctx, { destination: 'x', events: [textEvent('ค่าข้าว 100')] });
    assert.equal(res.ok, true);
    assert.equal(res.replies.length, 1);
    assert.includes(res.replies[0].messages[0].text, 'บันทึกแล้ว');
    assert.equal(ctx.txAll().length, 1);
  });

  it('LINE verify (no events) succeeds without side effects', () => {
    const ctx = bootProject();
    const res = post(ctx, { destination: 'x', events: [] });
    assert.equal(res.ok, true);
    assert.equal(ctx.txAll().length, 0);
  });

  it('T16 a forged internal signature creates nothing', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100')] }, { signature: 'deadbeef'.repeat(8) });
    assert.equal(res.ok, false);
    assert.equal(res.code, 'BAD_SIGNATURE');
    assert.equal(ctx.txAll().length, 0);
  });

  it('a request signed with the wrong secret creates nothing', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100')] }, { secret: 'some-other-secret-value-here' });
    assert.equal(res.code, 'BAD_SIGNATURE');
    assert.equal(ctx.txAll().length, 0);
  });

  it('a stale envelope is rejected', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100')] }, { timestamp: Date.now() - 40 * 60 * 1000 });
    assert.equal(res.code, 'STALE');
    assert.equal(ctx.txAll().length, 0);
  });

  it('a replayed nonce is rejected', () => {
    const ctx = bootProject();
    const nonce = 'fixed-nonce-1';
    const ev = textEvent('ค่าข้าว 100');
    const first = post(ctx, { events: [ev] }, { nonce });
    assert.equal(first.ok, true);
    const second = post(ctx, { events: [textEvent('ค่ากาแฟ 60')] }, { nonce });
    assert.equal(second.code, 'REPLAY');
    assert.equal(ctx.txAll().length, 1);
  });
});

describe('Phase 2 · allowlists', () => {
  it('T16 a user outside the member list is ignored silently', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100', { userId: 'Ustranger' })] });
    assert.equal(res.ok, true);
    assert.equal(res.replies.length, 0, 'no answer to strangers');
    assert.equal(ctx.txAll().length, 0);
  });

  it('another group cannot read or write the ledger', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('เดือนนี้', { groupId: 'Cother' })] });
    assert.equal(res.replies.length, 0);
    assert.equal(ctx.txAll().length, 0);
  });

  it('an event without a user id is never attributed to anyone', () => {
    const ctx = bootProject();
    const ev = textEvent('ค่าข้าว 100');
    delete ev.source.userId;
    const res = post(ctx, { events: [ev] });
    assert.equal(res.replies.length, 0);
    assert.equal(ctx.txAll().length, 0);
  });
});

describe('Phase 2 · delivery guarantees', () => {
  it('T11 the same webhook event delivered twice produces one record', () => {
    const ctx = bootProject();
    const ev = textEvent('ค่าข้าว 100', { eventId: 'WE-SAME' });
    const first = post(ctx, { events: [ev] });
    const second = post(ctx, { events: [ev] });
    assert.equal(ctx.txAll().length, 1, 'exactly one row');
    assert.includes(second.replies[0].messages[0].text, 'บันทึกแล้ว', 'the stored reply is replayed');
    assert.equal(ctx.reportMonthTotals(ctx.timeCurrentMonth()).net, 10000);
  });

  it('T18 a failed reply leaves the ledger correct and visible via สถานะ', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100')] });
    // The Worker would now fail to deliver res.replies — nothing rolls back.
    assert.equal(ctx.txAll().length, 1);
    const status = post(ctx, { events: [textEvent('สถานะ')] });
    assert.includes(status.replies[0].messages[0].text, 'สถานะระบบ');
    assert.equal(ctx.reportMonthTotals(ctx.timeCurrentMonth()).net, 10000, 'no double count after the failed reply');
  });

  it('handles several events in one webhook body', () => {
    const ctx = bootProject();
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100'), textEvent('ค่ากาแฟ 60')] });
    assert.equal(res.accepted, 2);
    assert.equal(ctx.txAll().length, 2);
  });

  it('a storage failure returns an error so LINE can retry', () => {
    const ctx = bootProject();
    const sheet = ctx.__mock.getSpreadsheet('TEST_SS');
    const inbox = sheet.getSheetByName('Inbox');
    const original = inbox.getRange.bind(inbox);
    inbox.getRange = () => { throw new Error('sheet unavailable'); };
    const res = post(ctx, { events: [textEvent('ค่าข้าว 100')] });
    inbox.getRange = original;
    assert.equal(res.ok, false);
    assert.equal(res.code, 'STORE_FAILED');
    assert.equal(ctx.txAll().length, 0);
  });

  it('an unparsable envelope body is rejected', () => {
    const ctx = bootProject();
    const res = JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).getContent());
    assert.equal(res.code, 'BAD_JSON');
  });

  it('a request with no body is rejected', () => {
    const ctx = bootProject();
    const res = JSON.parse(ctx.doPost({}).getContent());
    assert.equal(res.code, 'NO_BODY');
  });
});

describe('Phase 2 · onboarding', () => {
  it('binds a member with a one-time code and then refuses reuse', () => {
    const ctx = bootProject({ properties: { ONBOARDING_ENABLED: 'true' } });
    ctx.setupAddMember('kid', '', 'ลูก', '');
    const code = ctx.authCreateOnboardingCode('kid', 24);
    const res = post(ctx, { events: [textEvent('ลงทะเบียน ' + code, { userId: 'Unewuser' })] });
    assert.includes(res.replies[0].messages[0].text, 'ลงทะเบียน');
    assert.equal(ctx.memberByLineUserId('Unewuser').member_id, 'kid');

    const again = ctx.authRedeemOnboardingCode(code, 'Uother');
    assert.equal(again.ok, false, 'a used code cannot be redeemed again');
  });

  it('rejects codes once onboarding is closed', () => {
    const ctx = bootProject({ properties: { ONBOARDING_ENABLED: 'true' } });
    ctx.setupAddMember('kid', '', 'ลูก', '');
    const code = ctx.authCreateOnboardingCode('kid', 24);
    ctx.authCloseOnboarding();
    const res = ctx.authRedeemOnboardingCode(code, 'Unewuser');
    assert.equal(res.code, 'ONBOARDING_CLOSED');
  });
});
