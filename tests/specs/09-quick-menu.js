'use strict';
/** Quick-reply command menu attached to the bot's replies. */
const { describe, it, assert } = require('../harness/runner');
const { bootProject } = require('../harness/load');

function items(msg) { return (msg.quickReply && msg.quickReply.items) || []; }
function labels(msg) { return items(msg).map(i => i.action.label); }

describe('Quick menu · ปุ่มคำสั่งสำเร็จรูป', () => {
  it('มี 6 ปุ่ม และทุกปุ่มส่งข้อความแบบที่ผู้ใช้พิมพ์เอง', () => {
    const ctx = bootProject();
    const menu = ctx.msgMenuItems();
    assert.equal(menu.length, 6);
    menu.forEach(i => {
      assert.equal(i.type, 'action');
      assert.equal(i.action.type, 'message', 'ต้องเป็น message action จะได้ไหลเข้าท่อเดิม');
      assert.ok(i.action.text, 'ต้องมีข้อความที่จะส่ง');
      assert.ok(i.action.label.length <= 20, 'label ยาวเกิน 20 ตัวอักษร LINE ไม่รับ');
    });
  });

  it('แปะเมนูกับข้อความธรรมดาที่ยังไม่มีปุ่ม', () => {
    const ctx = bootProject();
    const out = ctx.msgAttachMenu([ctx.msgText('ยอดเดือนนี้ 200 บาท')]);
    assert.equal(items(out[0]).length, 6);
  });

  it('แปะเมนูต่อท้ายปุ่มเดิมของข้อความ "บันทึกแล้ว"', () => {
    const ctx = bootProject();
    const withButtons = ctx.msgText('✅ บันทึกแล้ว', [
      ctx.msgPostbackItem('แก้ไข', ctx.msgPostbackData({ a: 'edit_menu', tx: 'T1', rev: 1 })),
      ctx.msgPostbackItem('ยกเลิกรายการ', ctx.msgPostbackData({ a: 'void_ask', tx: 'T1', rev: 1 }))
    ]);
    const out = ctx.msgAttachMenu([withButtons]);
    assert.equal(items(out[0]).length, 8);
    assert.equal(labels(out[0])[0], 'แก้ไข', 'ปุ่มเดิมต้องมาก่อน');
  });

  it('ไม่แปะเมนูตอนบอทกำลังรอให้ยืนยัน', () => {
    const ctx = bootProject();
    const asking = ctx.msgAskLearnRule('A1', 'กาแฟ', 'food');
    const out = ctx.msgAttachMenu([asking]);
    assert.equal(items(out[0]).length, 2, 'ห้ามมีเมนูมากวนตอนรอตัดสินใจ');
  });

  it('ไม่แปะเมนูเมื่อรวมแล้วปุ่มจะเกิน 13 ที่ LINE จำกัด', () => {
    const ctx = bootProject();
    const many = ctx.msgText('เลือกหมวด', Array.from({ length: 8 }, (_, i) =>
      ctx.msgPostbackItem('หมวด' + i, ctx.msgPostbackData({ a: 'x', tx: 'T1' }))));
    const out = ctx.msgAttachMenu([many]);
    assert.equal(items(out[0]).length, 8, '8 + 6 = 14 เกิน 13 ต้องข้าม');
  });

  it('แปะกับข้อความสุดท้ายเท่านั้นเมื่อตอบหลายข้อความ', () => {
    const ctx = bootProject();
    const out = ctx.msgAttachMenu([ctx.msgText('บรรทัดแรก'), ctx.msgText('บรรทัดสอง')]);
    assert.equal(items(out[0]).length, 0);
    assert.equal(items(out[1]).length, 6);
  });

  it('ไม่พังเมื่อไม่มีข้อความจะตอบ', () => {
    const ctx = bootProject();
    assert.deepEqual(ctx.msgAttachMenu([]), []);
  });
});
