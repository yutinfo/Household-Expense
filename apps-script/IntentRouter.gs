/**
 * IntentRouter.gs — turns one user message (or button press) into messages and
 * committed transactions.
 *
 * ctx = { userId, groupId, eventId, memberId, todayISO }
 * Returns { messages: [lineMessage], transactions: [row], pendingCreated: bool }
 */

function routerHandleEvent(ctx, event) {
  if (event.type === 'message' && event.message && event.message.type === 'text') {
    return routerHandleText(event.message.text, ctx);
  }
  if (event.type === 'postback') {
    return routerHandlePostback(event.postback ? event.postback.data : '', ctx);
  }
  if (event.type === 'message' && event.message && event.message.type === 'image') {
    return routerHandleImage(ctx, event);
  }
  if (event.type === 'join') {
    return { messages: [msgText('สวัสดีครับ ผมช่วยจดรายจ่ายให้ พิมพ์ "ช่วยเหลือ" เพื่อดูวิธีใช้'), msgHelp()], transactions: [] };
  }
  return { messages: [], transactions: [] };
}

function routerHandleText(rawText, ctx) {
  var text = String(rawText || '').trim();
  if (!text) return { messages: [], transactions: [] };
  var norm = moneyNormalizeDigits(text);
  var today = ctx.todayISO || timeTodayISO();

  // --- simple commands ------------------------------------------------------
  if (/^(ช่วยเหลือ|help|วิธีใช้|คู่มือ|เมนู)$/i.test(norm)) return { messages: [msgHelp()], transactions: [] };
  if (/^(สถานะ|status)$/i.test(norm)) return { messages: [msgText(reportStatus(ctx.groupId, ctx.eventId))], transactions: [] };
  if (/^(รายการล่าสุด|ล่าสุด|recent)$/i.test(norm)) return { messages: [msgText(reportRecent(5))], transactions: [] };
  if (/^(วันนี้|สรุปวันนี้)$/.test(norm)) return { messages: [msgText(reportToday(today))], transactions: [] };
  if (/^(เดือนนี้|สรุปเดือนนี้|สรุปเดือน)$/.test(norm)) return { messages: [msgText(reportThisMonth(timeMonthOf(today)))], transactions: [] };
  if (/^(เดือนที่แล้ว|เดือนก่อน|สรุปเดือนที่แล้ว)$/.test(norm)) return { messages: [msgText(reportThisMonth(timePreviousMonth(timeMonthOf(today))))], transactions: [] };
  if (/เทียบเดือน(ก่อน|ที่แล้ว)/.test(norm)) return { messages: [msgText(reportCompareMonths(timeMonthOf(today), today))], transactions: [] };
  if (/ใครจ่าย(เท่าไหร่|เท่าไร|กี่บาท)?/.test(norm)) return { messages: [msgText(reportByPayer(timeMonthOf(today)))], transactions: [] };
  if (/^(กฎที่จำ|ดูกฎ|กฎ|rules)$/i.test(norm)) return { messages: [msgText(ruleLearnedListText())], transactions: [] };
  var forget = norm.match(/^(?:ลืมกฎ|ปิดกฎ)\s+(\S+)$/);
  if (forget) {
    var res = ruleDisable(forget[1].toUpperCase());
    return { messages: [msgText(res.ok ? 'ปิดกฎ ' + forget[1].toUpperCase() + ' แล้วครับ' : 'ไม่พบกฎ ' + forget[1])], transactions: [] };
  }

  // --- void / edit ----------------------------------------------------------
  var voidCmd = norm.match(/^(?:ยกเลิก|ลบ)\s*(T[A-Z0-9]{3,10})$/i);
  if (voidCmd) return routerAskVoid_(voidCmd[1].toUpperCase(), ctx);

  var editCmd = norm.match(/^(?:แก้ไข|แก้)\s+(T[A-Z0-9]{3,10}|รายการล่าสุด)\s+(.+)$/i);
  if (editCmd) return routerHandleEditCommand_(editCmd[1], editCmd[2], ctx);
  if (/^(?:แก้ไข|แก้)\s*(รายการล่าสุด)?$/.test(norm)) return routerEditLatest_(ctx);

  // --- budgets --------------------------------------------------------------
  var budgetSetCmd = norm.match(/^ตั้งงบ\s*(.+?)\s*([\d,]+(?:\.\d{1,2})?)\s*(เดือนนี้|เดือนหน้า)?$/);
  if (budgetSetCmd) return routerAskBudget_(budgetSetCmd[1], budgetSetCmd[2], budgetSetCmd[3], ctx);
  var budgetQ = norm.match(/(?:เหลือ)?งบ\s*(.+?)\s*(?:เหลือ)?(?:เท่าไหร่|เท่าไร|กี่บาท)/);
  if (budgetQ) {
    var bc = categoryByName(budgetQ[1].replace(/^ค่า/, ''));
    if (bc) return { messages: [msgText(budgetTextRemaining(bc.category_id, timeMonthOf(today)))], transactions: [] };
  }

  // --- "เดือนนี้ค่าอาหารเท่าไหร่" -------------------------------------------
  if (/(เท่าไหร่|เท่าไร|กี่บาท)/.test(norm)) {
    var month = /เดือนที่แล้ว|เดือนก่อน/.test(norm) ? timePreviousMonth(timeMonthOf(today)) : timeMonthOf(today);
    var isToday = /วันนี้/.test(norm);
    var cleaned = norm.replace(/(เดือนนี้|เดือนที่แล้ว|เดือนก่อน|วันนี้|เท่าไหร่|เท่าไร|กี่บาท|ใช้ไป|จ่ายไป|\?)/g, ' ').replace(/^ค่า/, ' ').trim();
    var cat = categoryByName(cleaned);
    if (cat && !isToday) return { messages: [msgText(reportCategoryInMonth(cat.category_id, month))], transactions: [] };
    if (isToday) return { messages: [msgText(reportToday(today))], transactions: [] };
    if (!cleaned) return { messages: [msgText(reportThisMonth(month))], transactions: [] };
  }

  // --- answering an open question ------------------------------------------
  var openCat = pendingLatestOpenFor(ctx.userId, ctx.groupId, PENDING_TYPES.CHOOSE_CATEGORY);
  if (openCat) {
    var chosen = categoryByName(norm);
    if (chosen) return routerResolveCategory_(openCat.action_id, chosen.category_id, ctx);
    if (/^(ไม่บันทึก|ยกเลิก|ไม่เอา)$/.test(norm)) {
      pendingCancel(openCat.action_id);
      return { messages: [msgText('ไม่บันทึกรายการนี้ครับ')], transactions: [] };
    }
  }
  var openClarify = pendingLatestOpenFor(ctx.userId, ctx.groupId, PENDING_TYPES.CLARIFY);
  if (openClarify) {
    var payload = pendingPayload(openClarify);
    if (payload && payload.code === 'TOTAL_NEEDS_SPLIT' && /^(รวมเป็นรายการเดียว|รายการเดียว|รวมก้อนเดียว)$/.test(norm)) {
      pendingClaim(openClarify.action_id, ctx.userId, ctx.groupId);
      return routerSingleTotal_(payload, ctx);
    }
    if (/^(ไม่บันทึก|ยกเลิก|ไม่เอา)$/.test(norm)) {
      pendingCancel(openClarify.action_id);
      return { messages: [msgText('ยกเลิกรายการนี้ครับ')], transactions: [] };
    }
  }

  // --- expense parsing ------------------------------------------------------
  var parsed = parseMessage(norm, { recorderMemberId: ctx.memberId, todayISO: today });

  // AI is consulted only where the deterministic path could not answer:
  // nothing understood at all, or an item whose category the rules do not know.
  if (aiIsEnabled()) {
    if (parsed.kind === 'none' && aiShouldTry(parsed.reason, norm)) {
      var aiParsed = aiParseMessage(norm, { recorderMemberId: ctx.memberId, todayISO: today });
      if (aiParsed) parsed = aiParsed;
    } else if (parsed.kind === 'items' && parsed.unknownCategoryIndexes && parsed.unknownCategoryIndexes.length) {
      parsed = routerEnrichWithAi_(parsed, norm, ctx, today);
    }
  }

  if (parsed.kind === 'none') {
    if (parsed.reason === 'PLAN') return { messages: [msgText('รับทราบครับ ยังไม่บันทึกเพราะดูเหมือนเป็นแผนจะซื้อ ถ้าจ่ายแล้วพิมพ์ยอดอีกครั้งได้เลย')], transactions: [] };
    if (parsed.reason === 'QUESTION') return { messages: [msgText('ถ้าอยากดูยอด พิมพ์ "เดือนนี้" หรือ "เดือนนี้ค่าอาหารเท่าไหร่" ได้ครับ')], transactions: [] };
    return { messages: [msgNotUnderstood()], transactions: [] };
  }

  if (parsed.kind === 'clarify') {
    var pa = pendingCreate(PENDING_TYPES.CLARIFY, ctx.userId, ctx.groupId, { code: parsed.code, data: parsed.data || {}, text: norm }, { eventId: ctx.eventId });
    return { messages: [msgAskClarify(parsed.question, pa.action_id)], transactions: [], pendingCreated: true };
  }

  return routerCommitOrAsk_(parsed.items, ctx);
}

/**
 * Asks the AI for the categories the rules could not determine.
 * The deterministic amounts always win: an AI answer is only merged when it
 * describes exactly the same amounts in the same order.
 */
function routerEnrichWithAi_(parsed, text, ctx, today) {
  var ai = aiParseMessage(text, { recorderMemberId: ctx.memberId, todayISO: today });
  if (!ai) return parsed;
  if (ai.kind === 'clarify') return ai;
  if (ai.kind !== 'items' || ai.items.length !== parsed.items.length) return parsed;
  for (var i = 0; i < parsed.items.length; i++) {
    if (Number(ai.items[i].amount_satang) !== Number(parsed.items[i].amount_satang)) return parsed;
  }
  var unknown = [];
  parsed.items.forEach(function (item, i) {
    if (txNeedsCategory(item.type) && !item.category_id && ai.items[i].category_id) {
      item.category_id = ai.items[i].category_id;
      item.category_source = 'ai';
    }
    if (txNeedsCategory(item.type) && !item.category_id) unknown.push(i);
  });
  parsed.unknownCategoryIndexes = unknown;
  return parsed;
}

/** Commits the items, or asks for the first missing category. */
function routerCommitOrAsk_(items, ctx) {
  var missing = -1;
  for (var i = 0; i < items.length; i++) {
    if (txNeedsCategory(items[i].type) && !items[i].category_id) { missing = i; break; }
  }
  if (missing >= 0) {
    var pa = pendingCreate(PENDING_TYPES.CHOOSE_CATEGORY, ctx.userId, ctx.groupId, { items: items, index: missing }, { eventId: ctx.eventId });
    var label = items.length > 1 ? ('รายการที่ ' + (missing + 1) + ' จาก ' + items.length) : '';
    return { messages: [msgAskCategory(pa.action_id, items[missing], label)], transactions: [], pendingCreated: true };
  }
  var rows = txCommitBatch(ctx.eventId, items);
  var extra = notifyBudgetLinesAfterSave(rows, ctx);
  // A slip this same person uploaded and has not resolved yet gets attached to
  // what they just typed. Another person's pending slip is never touched.
  var slipPending = pendingLatestOpenFor(ctx.userId, ctx.groupId, PENDING_TYPES.CONFIRM_SLIP);
  if (slipPending) {
    var claim = pendingClaim(slipPending.action_id, ctx.userId, ctx.groupId);
    if (claim.ok && claim.payload && claim.payload.attachment_id) {
      var link = attachmentLink(rows[0].transaction_id, claim.payload.attachment_id, ctx.memberId);
      if (link.ok) {
        attachmentSetOcr(claim.payload.attachment_id, 'confirmed', (claim.payload.extracted || {}).document_type || '', claim.payload.extracted || null);
        extra.push('📎 แนบรูปที่ส่งมาก่อนหน้ากับ ' + rows[0].transaction_id + ' แล้ว');
      }
    }
  }
  return { messages: [msgSavedTransactions(rows, extra)], transactions: rows };
}

function routerSingleTotal_(payload, ctx) {
  var data = payload.data || {};
  var text = payload.text || data.text || '';
  var desc = parseCleanDescription_(String(text).replace(/\d[\d,]*(\.\d{1,2})?/g, ' ').replace(/(รวม|ทั้งหมด|total)/g, ' '));
  var match = categoryMatch(desc);
  var item = {
    type: 'expense',
    amount_satang: data.total_satang,
    description: desc || 'รายการรวม',
    category_id: match ? match.category_id : '',
    category_source: match ? 'rule:' + match.rule_id : 'unknown',
    occurred_date: ctx.todayISO || timeTodayISO(),
    payer_member_id: ctx.memberId,
    recorder_member_id: ctx.memberId,
    original_text: text
  };
  return routerCommitOrAsk_([item], ctx);
}

function routerResolveCategory_(actionId, categoryId, ctx) {
  var claim = pendingClaim(actionId, ctx.userId, ctx.groupId);
  if (!claim.ok) return { messages: [msgText(routerClaimErrorText_(claim.code))], transactions: [] };
  var payload = claim.payload || {};
  var items = payload.items || [];
  var idx = payload.index || 0;
  if (!items[idx]) return { messages: [msgText('รายการนี้ไม่พบแล้วครับ ลองพิมพ์ใหม่อีกครั้ง')], transactions: [] };
  var learnKeyword = items[idx].description;
  items[idx].category_id = categoryId;
  items[idx].category_source = 'user';

  var result = routerCommitOrAsk_(items, ctx);
  if (payload.attachment_id && result.transactions && result.transactions.length) {
    slipLinkAfterCategory(payload, result.transactions, ctx);
    result.messages.push(msgText('📎 แนบหลักฐานกับ ' + result.transactions[0].transaction_id + ' แล้วครับ'));
  }
  if (result.transactions && result.transactions.length && learnKeyword && aiRuleLearningEnabled()) {
    var learn = ruleLearnAsk(learnKeyword, categoryId, ctx);
    if (learn) result.messages.push(learn);
  }
  return result;
}

function routerClaimErrorText_(code) {
  switch (code) {
    case 'EXPIRED': return 'คำถามนี้หมดอายุแล้วครับ พิมพ์รายการใหม่อีกครั้งได้เลย';
    case 'ALREADY_DONE': return 'รายการนี้ทำไปแล้วครับ ไม่ได้ทำซ้ำ';
    case 'WRONG_USER': return 'ปุ่มนี้เป็นของอีกคนครับ ให้เจ้าของข้อความกดเอง';
    case 'WRONG_GROUP': return 'ปุ่มนี้ใช้ในกลุ่มนี้ไม่ได้ครับ';
    default: return 'ไม่พบคำขอนี้แล้วครับ อาจหมดอายุไปก่อน';
  }
}

function routerAskVoid_(txId, ctx) {
  var tx = txById(txId);
  if (!tx) return { messages: [msgText('ไม่พบรายการ ' + txId + ' ครับ พิมพ์ "รายการล่าสุด" เพื่อดูรหัส')], transactions: [] };
  if (tx.status === 'void') return { messages: [msgText('รายการ ' + txId + ' ถูกยกเลิกไปแล้วครับ')], transactions: [] };
  var pa = pendingCreate(PENDING_TYPES.CONFIRM_VOID, ctx.userId, ctx.groupId, { transaction_id: txId }, { eventId: ctx.eventId, expectedRevision: tx.revision });
  return { messages: [msgConfirmVoid(pa.action_id, tx)], transactions: [], pendingCreated: true };
}

function routerEditLatest_(ctx) {
  var recent = txRecent(5, ctx.memberId);
  if (!recent.length) return { messages: [msgText('ยังไม่มีรายการที่คุณบันทึกไว้ครับ')], transactions: [] };
  var latestEvent = recent[0].event_id;
  var sameEvent = recent.filter(function (r) { return r.event_id === latestEvent; });
  if (sameEvent.length === 1) return { messages: [msgEditMenu(sameEvent[0])], transactions: [] };
  var quick = sameEvent.map(function (t, i) {
    return msgPostbackItem('#' + (i + 1) + ' ' + moneyFormat(t.amount_satang), msgPostbackData({ a: 'edit_menu', tx: t.transaction_id, rev: t.revision }), 'แก้ ' + t.transaction_id);
  });
  var lines = ['ข้อความล่าสุดมีหลายรายการ เลือกรายการที่จะแก้ครับ'];
  sameEvent.forEach(function (t, i) { lines.push((i + 1) + '. ' + msgTxLine(t)); });
  return { messages: [msgText(lines.join('\n'), quick)], transactions: [] };
}

function routerHandleEditCommand_(target, rest, ctx) {
  var tx = null;
  if (/^รายการล่าสุด$/.test(target)) {
    var recent = txRecent(1, ctx.memberId);
    if (!recent.length) return { messages: [msgText('ยังไม่มีรายการที่คุณบันทึกไว้ครับ')], transactions: [] };
    tx = recent[0];
  } else {
    tx = txById(target.toUpperCase());
  }
  if (!tx) return { messages: [msgText('ไม่พบรายการ ' + target + ' ครับ')], transactions: [] };
  if (tx.status === 'void') return { messages: [msgText('รายการ ' + tx.transaction_id + ' ถูกยกเลิกไปแล้ว แก้ไม่ได้ครับ')], transactions: [] };

  var patch = {};
  var previews = [];
  var r = String(rest).trim();

  var mAmount = r.match(/(?:ยอด|จำนวน|เงิน)\s*([\d,]+(?:\.\d{1,2})?)/);
  if (mAmount) {
    var sat = moneyParseToSatang(mAmount[1]);
    if (sat === null || sat <= 0) return { messages: [msgText('จำนวนเงินไม่ถูกต้องครับ')], transactions: [] };
    patch.amount_satang = sat;
    previews.push('ยอด ' + moneyFormatBaht(sat));
  }
  var mCat = r.match(/หมวด\s*(.+?)(?:\s|$)/);
  if (mCat) {
    var c = categoryByName(mCat[1]);
    if (!c) return { messages: [msgText('ไม่รู้จักหมวด "' + mCat[1] + '" ครับ หมวดที่มี: ' + categoryList().map(function (x) { return x.name; }).join(', '))], transactions: [] };
    patch.category_id = c.category_id;
    previews.push('หมวด ' + c.name);
  }
  var mDate = r.match(/วันที่\s*(\S+)/);
  if (mDate) {
    var dinfo = parseFindDate_(mDate[1], ctx.todayISO || timeTodayISO());
    var iso = dinfo && dinfo.date ? dinfo.date : (timeIsValidDateISO(mDate[1]) ? mDate[1] : null);
    if (!iso) return { messages: [msgText('วันที่ไม่ชัดเจนครับ ใช้รูปแบบ 2026-09-05 หรือ 05/09/2026')], transactions: [] };
    if (iso > (ctx.todayISO || timeTodayISO())) return { messages: [msgText('วันที่เป็นอนาคต แก้ไม่ได้ครับ')], transactions: [] };
    patch.occurred_date = iso;
    previews.push('วันที่ ' + timeThaiDateLabel(iso));
  }
  var mPayer = r.match(/(?:ผู้จ่าย|คนจ่าย|จ่ายโดย)\s*(\S+)/);
  if (mPayer) {
    var mem = memberByAlias(mPayer[1]);
    if (!mem) return { messages: [msgText('ไม่รู้จักชื่อ "' + mPayer[1] + '" ครับ')], transactions: [] };
    patch.payer_member_id = mem.member_id;
    previews.push('ผู้จ่าย ' + mem.display_name);
  }
  if (!Object.keys(patch).length) {
    return { messages: [msgEditMenu(tx)], transactions: [] };
  }
  var pa = pendingCreate(PENDING_TYPES.CONFIRM_EDIT, ctx.userId, ctx.groupId, { transaction_id: tx.transaction_id, patch: patch }, { eventId: ctx.eventId, expectedRevision: tx.revision });
  return { messages: [msgConfirmEdit(pa.action_id, tx, previews.join(' · '))], transactions: [], pendingCreated: true };
}

function routerAskBudget_(categoryText, amountText, monthWord, ctx) {
  var cat = categoryByName(String(categoryText).replace(/^ค่า/, '').trim());
  if (!cat) return { messages: [msgText('ไม่รู้จักหมวด "' + categoryText + '" ครับ หมวดที่มี: ' + categoryList().map(function (x) { return x.name; }).join(', '))], transactions: [] };
  var sat = moneyParseToSatang(amountText);
  if (sat === null || sat <= 0) return { messages: [msgText('จำนวนงบไม่ถูกต้องครับ')], transactions: [] };
  var today = ctx.todayISO || timeTodayISO();
  var month = timeMonthOf(today);
  if (monthWord === 'เดือนหน้า') {
    var p = month.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1], 1));
    month = d.toISOString().slice(0, 7);
  }
  var existing = budgetGet(month, cat.category_id);
  var pa = pendingCreate(PENDING_TYPES.CONFIRM_BUDGET, ctx.userId, ctx.groupId, { month: month, category_id: cat.category_id, limit_satang: sat }, { eventId: ctx.eventId });
  var lines = ['ยืนยันตั้งงบไหมครับ',
    'หมวด: ' + cat.name + ' เดือน ' + timeThaiMonthLabel(month),
    'ก่อน: ' + (existing ? moneyFormatBaht(existing.limit_satang) : 'ยังไม่ตั้งงบ'),
    'หลัง: ' + moneyFormatBaht(sat)];
  return {
    messages: [msgText(lines.join('\n'), [
      msgPostbackItem('ยืนยัน', msgPostbackData({ a: 'budget_do', p: pa.action_id }), 'ยืนยันตั้งงบ'),
      msgPostbackItem('ไม่ตั้ง', msgPostbackData({ a: 'cancel', p: pa.action_id }), 'ไม่ตั้งงบ')
    ])],
    transactions: [], pendingCreated: true
  };
}

/** Button presses. */
function routerHandlePostback(data, ctx) {
  var p = msgParsePostbackData(data);
  switch (p.a) {
    case 'cat':
      return routerResolveCategory_(p.p, p.c, ctx);
    case 'cancel': {
      var row = pendingGet(p.p);
      if (row && row.owner_user_id && row.owner_user_id !== ctx.userId) return { messages: [msgText(routerClaimErrorText_('WRONG_USER'))], transactions: [] };
      pendingCancel(p.p);
      return { messages: [msgText('ยกเลิกคำขอนี้แล้วครับ')], transactions: [] };
    }
    case 'void_ask': {
      return routerAskVoid_(p.tx, ctx);
    }
    case 'void_do': {
      var claim = pendingClaim(p.p, ctx.userId, ctx.groupId);
      if (!claim.ok) return { messages: [msgText(routerClaimErrorText_(claim.code))], transactions: [] };
      var res = txVoid(claim.payload.transaction_id, ctx.memberId, claim.action.expected_revision, p.p);
      if (!res.ok && res.code === 'REVISION_CONFLICT') {
        return { messages: [msgText('รายการนี้เพิ่งถูกแก้โดยอีกคนครับ กด "รายการล่าสุด" เพื่อโหลดข้อมูลล่าสุดแล้วลองใหม่')], transactions: [] };
      }
      if (!res.ok) return { messages: [msgText('ยกเลิกไม่สำเร็จ (' + res.code + ')')], transactions: [] };
      return { messages: [msgText('🗑️ ยกเลิกรายการ ' + res.transaction.transaction_id + ' แล้ว ยอดสรุปปรับตามแล้วครับ')], transactions: [] };
    }
    case 'edit_menu': {
      var tx = txById(p.tx);
      if (!tx) return { messages: [msgText('ไม่พบรายการนี้ครับ')], transactions: [] };
      return { messages: [msgEditMenu(tx)], transactions: [] };
    }
    case 'edit_cat_menu': {
      var tx2 = txById(p.tx);
      if (!tx2) return { messages: [msgText('ไม่พบรายการนี้ครับ')], transactions: [] };
      return { messages: [msgEditCategoryMenu(tx2)], transactions: [] };
    }
    case 'edit_cat': {
      var tx3 = txById(p.tx);
      if (!tx3) return { messages: [msgText('ไม่พบรายการนี้ครับ')], transactions: [] };
      var r3 = txEdit(p.tx, { category_id: p.c }, ctx.memberId, p.rev, '');
      if (!r3.ok && r3.code === 'REVISION_CONFLICT') {
        return { messages: [msgText('รายการนี้เพิ่งถูกแก้โดยอีกคน (ตอนนี้: ' + msgTxLine(r3.transaction) + ')\nกดแก้ใหม่จากข้อมูลล่าสุดครับ', [msgPostbackItem('แก้ไข', msgPostbackData({ a: 'edit_menu', tx: p.tx, rev: r3.transaction.revision }))])], transactions: [] };
      }
      if (!r3.ok) return { messages: [msgText('แก้ไม่สำเร็จ (' + r3.code + ')')], transactions: [] };
      var out = { messages: [msgText('✏️ แก้แล้ว: ' + msgTxLine(r3.transaction))], transactions: [] };
      if (aiRuleLearningEnabled()) {
        var ask = ruleLearnAsk(r3.transaction.description, p.c, ctx);
        if (ask) out.messages.push(ask);
      }
      return out;
    }
    case 'edit_do': {
      var claim2 = pendingClaim(p.p, ctx.userId, ctx.groupId);
      if (!claim2.ok) return { messages: [msgText(routerClaimErrorText_(claim2.code))], transactions: [] };
      var res2 = txEdit(claim2.payload.transaction_id, claim2.payload.patch, ctx.memberId, claim2.action.expected_revision, p.p);
      if (!res2.ok && res2.code === 'REVISION_CONFLICT') {
        return { messages: [msgText('รายการนี้เพิ่งถูกแก้โดยอีกคนครับ ลองสั่งแก้ใหม่จากข้อมูลล่าสุด')], transactions: [] };
      }
      if (!res2.ok) return { messages: [msgText('แก้ไม่สำเร็จ (' + res2.code + ')')], transactions: [] };
      return { messages: [msgText('✏️ แก้แล้ว: ' + msgTxLine(res2.transaction))], transactions: [] };
    }
    case 'budget_do': {
      var claim3 = pendingClaim(p.p, ctx.userId, ctx.groupId);
      if (!claim3.ok) return { messages: [msgText(routerClaimErrorText_(claim3.code))], transactions: [] };
      var b = claim3.payload;
      var rb = budgetSet(b.month, b.category_id, b.limit_satang, ctx.memberId);
      if (!rb.ok) return { messages: [msgText('ตั้งงบไม่สำเร็จ (' + rb.code + ')')], transactions: [] };
      return { messages: [msgText('💰 ตั้งงบ' + categoryName(b.category_id) + ' เดือน ' + timeThaiMonthLabel(b.month) + ' = ' + moneyFormatBaht(b.limit_satang) + ' แล้วครับ')], transactions: [] };
    }
    case 'learn_yes': {
      var claim4 = pendingClaim(p.p, ctx.userId, ctx.groupId);
      if (!claim4.ok) return { messages: [msgText(routerClaimErrorText_(claim4.code))], transactions: [] };
      var lr = ruleLearnApply(claim4.payload, ctx.memberId);
      return { messages: [msgText(lr.ok ? '🧠 จำไว้แล้ว: “' + claim4.payload.keyword + '” = ' + categoryName(claim4.payload.category_id) + ' (ปิดได้ด้วย "ลืมกฎ ' + lr.rule_id + '")' : 'จำกฎไม่สำเร็จ (' + lr.code + ')')], transactions: [] };
    }
    case 'learn_no': {
      pendingCancel(p.p);
      return { messages: [msgText('โอเคครับ ใช้เฉพาะครั้งนี้ ไม่ตั้งเป็นกฎถาวร')], transactions: [] };
    }
    case 'slip_confirm':
    case 'slip_edit':
    case 'slip_attach':
    case 'slip_cancel':
      return slipHandlePostback(p, ctx);
    default:
      return { messages: [msgText('ปุ่มนี้ใช้ไม่ได้แล้วครับ')], transactions: [] };
  }
}

/** Image events are handled by the Phase 8 slip pipeline. */
function routerHandleImage(ctx, event) {
  return slipHandleImageEvent(ctx, event);
}
