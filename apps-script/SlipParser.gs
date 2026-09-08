/**
 * SlipParser.gs — the slip/receipt conversation.
 *
 * Nothing here writes an active transaction on its own: OCR produces a
 * proposal, the proposal is shown with the fields it could not read, and only
 * a confirmation button creates or attaches anything.
 *
 * A caption and an image arrive as separate LINE events, so a description is
 * only attached when the same person answers the bot's own question about
 * that specific attachment.
 */

function slipHandleImageEvent(ctx, event) {
  var messageId = event.message && event.message.id;
  if (!messageId) return { messages: [], transactions: [] };

  var ingest = attachmentIngest(messageId, ctx.eventId, ctx.memberId);
  if (!ingest.ok) return { messages: [msgText(slipIngestErrorText_(ingest.code))], transactions: [] };
  var attachment = ingest.attachment;

  if (ingest.duplicateOfMessage && attachment.ocr_status === 'confirmed') {
    return { messages: [msgText('รูปนี้เคยยืนยันไปแล้วครับ ไม่บันทึกซ้ำ')], transactions: [] };
  }

  if (!ocrIsEnabled()) {
    var pa0 = pendingCreate(PENDING_TYPES.CONFIRM_SLIP, ctx.userId, ctx.groupId,
      { attachment_id: attachment.attachment_id, extracted: null, manual: true }, { eventId: ctx.eventId, ttlMinutes: 60 });
    return {
      messages: [msgText('เก็บรูปเป็นหลักฐานแล้วครับ (ยังไม่เปิดอ่านสลิปอัตโนมัติ)\nพิมพ์รายการกับยอดได้เลย เช่น "ค่าอาหาร 250" แล้วผมจะแนบรูปนี้ให้', [
        msgPostbackItem('ไม่ต้องแนบ', msgPostbackData({ a: 'slip_cancel', p: pa0.action_id }), 'ไม่ต้องแนบ')
      ])],
      transactions: [], pendingCreated: true
    };
  }

  var content = lineGetMessageContent(messageId);
  if (!content.ok) {
    attachmentSetOcr(attachment.attachment_id, 'failed', '', null);
    return { messages: [msgText('ดึงรูปจาก LINE ไม่สำเร็จครับ (' + content.code + ') ส่งรูปใหม่อีกครั้ง หรือพิมพ์ยอดเองได้')], transactions: [] };
  }

  var ocr = ocrExtract(content.blob, content.mime, { todayISO: ctx.todayISO });
  if (!ocr.ok) {
    attachmentSetOcr(attachment.attachment_id, 'failed', '', null);
    var pa1 = pendingCreate(PENDING_TYPES.CONFIRM_SLIP, ctx.userId, ctx.groupId,
      { attachment_id: attachment.attachment_id, extracted: null, manual: true }, { eventId: ctx.eventId, ttlMinutes: 60 });
    return {
      messages: [msgText(slipOcrErrorText_(ocr.code), [
        msgPostbackItem('ไม่ต้องแนบ', msgPostbackData({ a: 'slip_cancel', p: pa1.action_id }), 'ไม่ต้องแนบ')
      ])],
      transactions: [], pendingCreated: true
    };
  }

  var data = ocr.data;
  attachmentSetOcr(attachment.attachment_id, 'read', data.document_type, data);

  if (data.amount_satang === null) {
    var pa2 = pendingCreate(PENDING_TYPES.CONFIRM_SLIP, ctx.userId, ctx.groupId,
      { attachment_id: attachment.attachment_id, extracted: data, manual: true }, { eventId: ctx.eventId, ttlMinutes: 60 });
    return {
      messages: [msgText('อ่านยอดเงินจากรูปไม่ชัดครับ ยังไม่บันทึก\nพิมพ์ยอดกับรายการมาได้เลย เช่น "ค่าอาหาร 250" แล้วผมจะแนบรูปนี้ให้', [
        msgPostbackItem('ไม่ต้องแนบ', msgPostbackData({ a: 'slip_cancel', p: pa2.action_id }), 'ไม่ต้องแนบ')
      ])],
      transactions: [], pendingCreated: true
    };
  }

  var dup = dupFindForAttachment(attachment, data);
  var proposal = slipBuildProposal_(data, ctx);
  var pa = pendingCreate(PENDING_TYPES.CONFIRM_SLIP, ctx.userId, ctx.groupId, {
    attachment_id: attachment.attachment_id,
    extracted: data,
    proposal: proposal,
    duplicates: dup
  }, { eventId: ctx.eventId, ttlMinutes: 60 });

  return { messages: [slipProposalMessage_(pa.action_id, data, proposal, dup, ctx)], transactions: [], pendingCreated: true };
}

/** Turns validated OCR data into a draft transaction (category may be empty). */
function slipBuildProposal_(data, ctx) {
  var isInternalTransfer = false;
  var counterpart = null;
  if (data.document_type === 'transfer_slip' && data.receiver_name) {
    var m = slipMatchMember_(data.receiver_name);
    if (m) { isInternalTransfer = true; counterpart = m.member_id; }
  }
  var desc = data.document_type === 'transfer_slip'
    ? (data.receiver_name ? 'โอนให้ ' + data.receiver_name : 'โอนเงิน')
    : (data.merchant_name || 'ใบเสร็จ');

  // A category is only guessed from something that identifies what was bought:
  // a shop name. A person's name says nothing about the purpose, so the bot
  // asks instead of inferring (a transfer to "นายสมชาย" is not food).
  var category = '';
  if (!isInternalTransfer) {
    var nameForCategory = data.merchant_name || (slipLooksLikeMerchant_(data.receiver_name) ? data.receiver_name : '');
    if (nameForCategory) category = (categoryMatch(nameForCategory) || {}).category_id || '';
  }
  return {
    type: isInternalTransfer ? 'transfer' : 'expense',
    amount_satang: data.amount_satang,
    description: desc,
    category_id: category || '',
    occurred_date: data.date || (ctx.todayISO || timeTodayISO()),
    payer_member_id: ctx.memberId,
    recorder_member_id: ctx.memberId,
    original_text: '[slip]',
    counterpart_member_id: counterpart,
    date_was_read: !!data.date
  };
}

var SLIP_MERCHANT_PREFIXES = ['ร้าน', 'บริษัท', 'บจก', 'หจก', 'บมจ', 'company', 'co.', 'ltd', 'shop', 'store', 'cafe', 'คาเฟ่'];
var SLIP_PERSON_PREFIXES = ['นาย', 'นาง', 'น.ส.', 'นางสาว', 'คุณ', 'ด.ช.', 'ด.ญ.', 'mr', 'mrs', 'ms'];

/** True only when the printed name clearly identifies a business. */
function slipLooksLikeMerchant_(name) {
  var n = String(name || '').trim().toLowerCase();
  if (!n) return false;
  for (var p = 0; p < SLIP_PERSON_PREFIXES.length; p++) {
    if (n.indexOf(SLIP_PERSON_PREFIXES[p]) === 0) return false;
  }
  for (var i = 0; i < SLIP_MERCHANT_PREFIXES.length; i++) {
    if (n.indexOf(SLIP_MERCHANT_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/** Matches a name printed on a slip against the two registered members. */
function slipMatchMember_(name) {
  var n = String(name || '').toLowerCase().replace(/\s+/g, '');
  if (!n) return null;
  var idx = memberAliasIndex();
  for (var i = 0; i < idx.length; i++) {
    var a = String(idx[i].alias).toLowerCase().replace(/\s+/g, '');
    if (a.length >= 2 && (n.indexOf(a) >= 0 || a.indexOf(n) >= 0)) return idx[i].member;
  }
  return null;
}

function slipProposalMessage_(actionId, data, proposal, dup, ctx) {
  var lines = [];
  lines.push(data.document_type === 'transfer_slip' ? '🧾 อ่านสลิปโอนเงินได้ดังนี้' : '🧾 อ่านใบเสร็จได้ดังนี้');
  lines.push('ยอด: ' + moneyFormatBaht(data.amount_satang) + (data.fee_satang ? ' (ค่าธรรมเนียมอีก ' + moneyFormatBaht(data.fee_satang) + ' แยกต่างหาก)' : ''));
  lines.push('วันที่: ' + (data.date ? timeThaiDateLabel(data.date) : 'อ่านไม่ได้ → ใช้วันนี้ถ้ายืนยัน') + (data.time ? ' ' + data.time : ''));
  if (data.sender_name) lines.push('ผู้โอน: ' + data.sender_name);
  if (data.receiver_name) lines.push('ผู้รับ: ' + data.receiver_name + (data.receiver_account_masked ? ' (' + data.receiver_account_masked + ')' : ''));
  if (data.merchant_name) lines.push('ร้าน: ' + data.merchant_name);
  if (data.reference_no) lines.push('เลขอ้างอิง: ' + data.reference_no);

  if (proposal.type === 'transfer') {
    lines.push('→ เสนอบันทึกเป็น "โอนภายในครอบครัว" ไม่นับเป็นรายจ่าย');
  } else {
    lines.push('→ เสนอบันทึกเป็นรายจ่าย ผู้จ่าย: ' + memberName(proposal.payer_member_id));
    lines.push('หมวด: ' + (proposal.category_id ? categoryName(proposal.category_id) : 'ยังไม่ทราบ — จะถามก่อนบันทึก'));
  }
  if (data.uncertain && data.uncertain.length) lines.push('อ่านไม่ชัด: ' + data.uncertain.join(', '));

  if (dup && dup.strong && dup.strong.length) lines.push('⚠️ เลขอ้างอิงนี้เคยแนบไว้แล้ว อาจเป็นสลิปซ้ำ');
  if (dup && dup.candidates && dup.candidates.length) {
    lines.push('อาจตรงกับรายการที่เคยพิมพ์ไว้:');
    dup.candidates.slice(0, 3).forEach(function (c) { lines.push('  • ' + msgTxLine(c.transaction)); });
  }
  lines.push('ยังไม่บันทึกจนกว่าจะกดยืนยันครับ');

  var quick = [msgPostbackItem('ยืนยันบันทึก', msgPostbackData({ a: 'slip_confirm', p: actionId }), 'ยืนยันบันทึก')];
  var attachables = dup && dup.candidates && dup.candidates.length
    ? dup.candidates.map(function (c) { return c.transaction; })
    : dupAttachableTransactions(data, ctx.memberId);
  attachables.slice(0, 3).forEach(function (t) {
    quick.push(msgPostbackItem('แนบกับ ' + t.transaction_id, msgPostbackData({ a: 'slip_attach', p: actionId, tx: t.transaction_id }), 'แนบกับ ' + t.transaction_id));
  });
  quick.push(msgPostbackItem('แก้ข้อมูล', msgPostbackData({ a: 'slip_edit', p: actionId }), 'แก้ข้อมูล'));
  quick.push(msgPostbackItem('ยกเลิก', msgPostbackData({ a: 'slip_cancel', p: actionId }), 'ยกเลิก'));

  return msgText(lines.join('\n'), quick);
}

function slipHandlePostback(p, ctx) {
  if (p.a === 'slip_cancel') {
    var row = pendingGet(p.p);
    if (row && row.owner_user_id && row.owner_user_id !== ctx.userId) return { messages: [msgText(routerClaimErrorText_('WRONG_USER'))], transactions: [] };
    pendingCancel(p.p);
    return { messages: [msgText('ไม่บันทึกรูปนี้เป็นรายการครับ (รูปยังเก็บไว้ 30 วันแล้วลบอัตโนมัติถ้าไม่ได้ใช้)')], transactions: [] };
  }

  if (p.a === 'slip_edit') {
    var open = pendingGet(p.p);
    if (!open || open.status !== 'open') return { messages: [msgText(routerClaimErrorText_('ALREADY_DONE'))], transactions: [] };
    return {
      messages: [msgText([
        'พิมพ์ข้อมูลที่ถูกต้องมาได้เลยครับ เช่น',
        '  ค่าอาหาร 250',
        '  ค่าอาหาร 250 เมียจ่าย',
        'ผมจะบันทึกตามที่พิมพ์และแนบรูปนี้ให้ (ยอดจากรูปจะไม่ถูกใช้)'
      ].join('\n'))],
      transactions: []
    };
  }

  var claim = pendingClaim(p.p, ctx.userId, ctx.groupId);
  if (!claim.ok) return { messages: [msgText(routerClaimErrorText_(claim.code))], transactions: [] };
  var payload = claim.payload || {};

  if (p.a === 'slip_attach') {
    var link = attachmentLink(p.tx, payload.attachment_id, ctx.memberId);
    if (!link.ok) return { messages: [msgText('แนบไม่สำเร็จ (' + link.code + ')')], transactions: [] };
    attachmentSetOcr(payload.attachment_id, 'confirmed', (payload.extracted || {}).document_type || '', payload.extracted);
    var tx = txById(p.tx);
    return { messages: [msgText('📎 แนบหลักฐานกับ ' + p.tx + ' แล้วครับ ยอดรวมไม่เปลี่ยน\n' + (tx ? msgTxLine(tx) : '') + '\nเปิดไฟล์ได้เฉพาะบัญชี Google ที่มีสิทธิ์')], transactions: [] };
  }

  if (p.a === 'slip_confirm') {
    var proposal = payload.proposal;
    if (!proposal) return { messages: [msgText('ข้อมูลสลิปหมดอายุแล้วครับ ส่งรูปใหม่อีกครั้ง')], transactions: [] };
    if (proposal.type !== 'transfer' && !proposal.category_id) {
      var pa = pendingCreate(PENDING_TYPES.CHOOSE_CATEGORY, ctx.userId, ctx.groupId, {
        items: [slipProposalToDraft_(proposal, ctx)],
        index: 0,
        attachment_id: payload.attachment_id
      }, { eventId: ctx.eventId });
      return { messages: [msgAskCategory(pa.action_id, { description: proposal.description, amount_satang: proposal.amount_satang }, '')], transactions: [], pendingCreated: true };
    }
    var rows = txCommitBatch(ctx.eventId, [slipProposalToDraft_(proposal, ctx)]);
    attachmentLink(rows[0].transaction_id, payload.attachment_id, ctx.memberId);
    attachmentSetOcr(payload.attachment_id, 'confirmed', (payload.extracted || {}).document_type || '', payload.extracted);
    var extra = notifyBudgetLinesAfterSave(rows, ctx);
    extra.push('📎 แนบหลักฐานแล้ว (เปิดได้เฉพาะบัญชีที่มีสิทธิ์)');
    return { messages: [msgSavedTransactions(rows, extra)], transactions: rows };
  }

  return { messages: [msgText('ปุ่มนี้ใช้ไม่ได้แล้วครับ')], transactions: [] };
}

function slipProposalToDraft_(proposal, ctx) {
  return {
    type: proposal.type,
    amount_satang: proposal.amount_satang,
    description: proposal.description,
    category_id: proposal.category_id || '',
    occurred_date: proposal.occurred_date,
    payer_member_id: proposal.payer_member_id || ctx.memberId,
    recorder_member_id: ctx.memberId,
    original_text: proposal.original_text || '[slip]'
  };
}

function slipIngestErrorText_(code) {
  switch (code) {
    case 'UNSUPPORTED_TYPE': return 'รองรับเฉพาะรูป JPEG/PNG ครับ';
    case 'TOO_LARGE': return 'ไฟล์ใหญ่เกินไปครับ ลองส่งรูปที่เล็กลง';
    case 'CONTENT_EXPIRED': return 'รูปหมดอายุใน LINE แล้วครับ ส่งใหม่อีกครั้ง';
    default: return 'เก็บรูปไม่สำเร็จครับ (' + code + ') ลองส่งใหม่อีกครั้ง';
  }
}

function slipOcrErrorText_(code) {
  if (code === 'BUDGET_EXHAUSTED') return 'งบอ่านรูปเดือนนี้เต็มแล้วครับ เก็บรูปไว้เป็นหลักฐานให้แล้ว พิมพ์ยอดเองได้เลย';
  if (code === 'UNREADABLE') return 'รูปไม่ชัดพอจะอ่านตัวเลขครับ ถ่ายใหม่ให้เห็นยอดชัด ๆ หรือพิมพ์ยอดเองได้';
  return 'อ่านรูปไม่สำเร็จครับ (' + code + ') เก็บรูปไว้แล้ว พิมพ์ยอดเองได้เลย';
}

/**
 * Called after a category is chosen for a slip-originated draft, to attach the
 * evidence to the transaction that was just created.
 */
function slipLinkAfterCategory(payload, rows, ctx) {
  if (!payload || !payload.attachment_id || !rows || !rows.length) return;
  attachmentLink(rows[0].transaction_id, payload.attachment_id, ctx.memberId);
  attachmentSetOcr(payload.attachment_id, 'confirmed', '', attachmentExtracted(payload.attachment_id));
}
