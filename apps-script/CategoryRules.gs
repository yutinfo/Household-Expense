/**
 * CategoryRules.gs — deterministic category matching.
 *
 * Priority model: every rule has a numeric priority; the highest priority match
 * wins. Item/food words are seeded at 100 and store names at 40-50, so
 * "กินข้าวที่อีเกีย" resolves to food, while "ซื้อของในอีเกีย" resolves to home.
 * A tie is broken by the longer pattern (more specific) and then by rule_id.
 */

function categoryList() {
  var rows = repoFilter('Categories', function (c) { return String(c.active) === 'true'; });
  rows.sort(function (a, b) { return Number(a.sort_order) - Number(b.sort_order); });
  return rows;
}

function categoryById(categoryId) {
  if (!categoryId) return null;
  var list = categoryList();
  for (var i = 0; i < list.length; i++) if (list[i].category_id === categoryId) return list[i];
  return null;
}

function categoryName(categoryId) {
  var c = categoryById(categoryId);
  return c ? c.name : (categoryId || '-');
}

/** Resolves a user-typed category name/id, e.g. "อาหาร" or "food". */
function categoryByName(text) {
  if (!text) return null;
  var t = String(text).trim().toLowerCase();
  var list = categoryList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].category_id.toLowerCase() === t) return list[i];
    if (String(list[i].name).toLowerCase() === t) return list[i];
  }
  // loose contains match, longest name first
  var sorted = list.slice().sort(function (a, b) { return String(b.name).length - String(a.name).length; });
  for (var j = 0; j < sorted.length; j++) {
    if (t.indexOf(String(sorted[j].name).toLowerCase()) >= 0) return sorted[j];
  }
  return null;
}

function ruleActiveList() {
  return repoFilter('Rules', function (r) { return String(r.active) === 'true' && r.pattern && r.category_id; });
}

function ruleMatches_(rule, text) {
  var p = String(rule.pattern).toLowerCase();
  if (!p) return false;
  switch (rule.match_type) {
    case 'exact':
      return text === p;
    case 'word':
      // whole-token match; Thai has no spaces, so this is mainly for latin tokens
      return new RegExp('(^|[^a-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(text);
    case 'regex':
      try { return new RegExp(rule.pattern, 'i').test(text); } catch (e) { return false; }
    case 'contains':
    default:
      return text.indexOf(p) >= 0;
  }
}

/**
 * Returns {category_id, rule_id, priority, pattern} or null.
 * Never invents a category: an unmatched text returns null so the caller asks.
 */
function categoryMatch(text) {
  var t = moneyNormalizeDigits(String(text || '')).toLowerCase();
  if (!t) return null;
  var best = null;
  ruleActiveList().forEach(function (r) {
    if (!ruleMatches_(r, t)) return;
    if (!best) { best = r; return; }
    var pr = Number(r.priority) - Number(best.priority);
    if (pr > 0) { best = r; return; }
    if (pr === 0) {
      var lr = String(r.pattern).length - String(best.pattern).length;
      if (lr > 0 || (lr === 0 && String(r.rule_id) < String(best.rule_id))) best = r;
    }
  });
  if (!best) return null;
  if (!categoryById(best.category_id)) return null; // rule points at a removed category
  return { category_id: best.category_id, rule_id: best.rule_id, priority: Number(best.priority), pattern: best.pattern };
}

/** Adds or updates a learned rule. Learned rules sit above store names but below food words. */
function ruleUpsert(pattern, categoryId, createdBy, priority, matchType) {
  var p = String(pattern || '').trim();
  if (!p) return { ok: false, code: 'EMPTY_PATTERN' };
  if (!categoryById(categoryId)) return { ok: false, code: 'UNKNOWN_CATEGORY' };
  var existing = null;
  repoReadAll('Rules').rows.forEach(function (r) {
    if (String(r.pattern).toLowerCase() === p.toLowerCase() && r.match_type === (matchType || 'contains')) existing = r;
  });
  var now = timeNowISO();
  if (existing) {
    repoUpdateRow('Rules', existing._row, { category_id: categoryId, active: 'true', priority: priority || existing.priority || RULE_LEARNED_PRIORITY, updated_at: now, created_by: createdBy || existing.created_by });
    return { ok: true, code: 'UPDATED', rule_id: existing.rule_id };
  }
  var id = idRule();
  repoAppendRows('Rules', [{
    rule_id: id, pattern: p, match_type: matchType || 'contains', category_id: categoryId,
    priority: priority || RULE_LEARNED_PRIORITY, active: 'true', created_by: createdBy || 'user', updated_at: now
  }]);
  return { ok: true, code: 'CREATED', rule_id: id };
}

function ruleDisable(ruleId) {
  var r = repoFindOne('Rules', 'rule_id', ruleId);
  if (!r) return { ok: false, code: 'NOT_FOUND' };
  repoUpdateRow('Rules', r._row, { active: 'false', updated_at: timeNowISO() });
  return { ok: true, code: 'DISABLED' };
}

/** Rules created by users (not the seed set), most recent first. */
function ruleListLearned(limit) {
  var rows = repoFilter('Rules', function (r) { return r.created_by && r.created_by !== 'seed'; });
  rows.sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
  return rows.slice(0, limit || 20);
}
