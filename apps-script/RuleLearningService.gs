/**
 * RuleLearningService.gs — "remember this category?" flow.
 *
 * A correction only becomes a rule after the user says so. Learned rules get
 * priority 120: above seeded store names (40-50) and above generic item words
 * (90-110) for that exact phrase, but they can always be listed and switched
 * off, and a broader learned pattern never silently overrides a longer,
 * more specific one because ties prefer the longer pattern.
 */

function aiRuleLearningEnabled() { return true; }

var RULE_LEARN_STOPWORDS = ['ค่า', 'ซื้อ', 'จ่าย', 'ที่', 'ใน', 'ไป', 'มา', 'ให้', 'ของ'];

/**
 * Learned rules sit above seeded store names (40-50) but below strong item
 * words (90-110), so teaching "อีเกีย = บ้าน" never turns a meal at IKEA into
 * a furniture purchase. Within the same priority the longer (more specific)
 * pattern wins, which stops a broad learned rule from swallowing a narrow one.
 */
var RULE_LEARNED_PRIORITY = 95;

/** Picks the phrase worth remembering out of a description. */
function ruleLearnKeyword(description) {
  var d = String(description || '').trim();
  if (!d) return null;
  for (var pass = 0; pass < 6; pass++) {
    var stripped = false;
    for (var i = 0; i < RULE_LEARN_STOPWORDS.length; i++) {
      var w = RULE_LEARN_STOPWORDS[i];
      if (d.indexOf(w) === 0) { d = d.slice(w.length).trim(); stripped = true; }
    }
    if (!stripped) break;
  }
  d = d.replace(/\s{2,}/g, ' ').trim();
  if (d.length < 2) return null;
  if (d.length > 30) d = d.slice(0, 30);
  return d;
}

/**
 * Creates the "remember?" question, or returns null when there is nothing new
 * to learn (an existing rule already maps this phrase to the same category).
 */
function ruleLearnAsk(description, categoryId, ctx) {
  var keyword = ruleLearnKeyword(description);
  if (!keyword) return null;
  var existing = categoryMatch(keyword);
  if (existing && existing.category_id === categoryId) return null;
  var pa = pendingCreate(PENDING_TYPES.LEARN_RULE, ctx.userId, ctx.groupId, { keyword: keyword, category_id: categoryId }, { eventId: ctx.eventId, ttlMinutes: 30 });
  // The question itself never changes the rules; only "จำไว้" does.
  return msgAskLearnRule(pa.action_id, keyword, categoryId);
}

function ruleLearnApply(payload, actorMemberId) {
  if (!payload || !payload.keyword || !payload.category_id) return { ok: false, code: 'BAD_PAYLOAD' };
  var res = ruleUpsert(payload.keyword, payload.category_id, actorMemberId || 'user', RULE_LEARNED_PRIORITY, 'contains');
  if (res.ok) auditLog('', '', actorMemberId, 'rule_learn', null, { pattern: payload.keyword, category_id: payload.category_id, rule_id: res.rule_id });
  return res;
}

function ruleLearnedListText() {
  var rows = ruleListLearned(20);
  if (!rows.length) return '🧠 ยังไม่มีกฎที่จำเพิ่มเองครับ (ใช้กฎพื้นฐานอย่างเดียว)';
  var lines = ['🧠 กฎที่จำไว้ (ปิดได้ด้วย "ลืมกฎ <รหัส>")'];
  rows.forEach(function (r) {
    lines.push('• ' + r.rule_id + ': “' + r.pattern + '” → ' + categoryName(r.category_id) + (String(r.active) === 'true' ? '' : ' (ปิดอยู่)'));
  });
  return lines.join('\n');
}
