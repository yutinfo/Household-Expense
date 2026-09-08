/** Members.gs — the two household members and their nicknames. */

function memberList() {
  return repoFilter('Members', function (m) { return String(m.active) === 'true'; });
}

function memberByLineUserId(lineUserId) {
  if (!lineUserId) return null;
  var list = memberList();
  for (var i = 0; i < list.length; i++) if (list[i].line_user_id === lineUserId) return list[i];
  return null;
}

function memberById(memberId) {
  var list = memberList();
  for (var i = 0; i < list.length; i++) if (list[i].member_id === memberId) return list[i];
  return null;
}

function memberName(memberId) {
  var m = memberById(memberId);
  return m ? m.display_name : (memberId || '?');
}

/** Returns [{member, alias}] sorted by alias length desc for greedy matching. */
function memberAliasIndex() {
  var out = [];
  memberList().forEach(function (m) {
    var aliases = String(m.aliases || '').split(',').map(function (a) { return a.trim(); }).filter(Boolean);
    aliases.push(m.display_name);
    aliases.forEach(function (a) { out.push({ member: m, alias: a }); });
  });
  out.sort(function (a, b) { return b.alias.length - a.alias.length; });
  return out;
}

/** Resolves a nickname (e.g. "เมีย") to a member; exact match on alias (case-insensitive). */
function memberByAlias(alias) {
  if (!alias) return null;
  var a = String(alias).trim().toLowerCase();
  var idx = memberAliasIndex();
  for (var i = 0; i < idx.length; i++) if (idx[i].alias.toLowerCase() === a) return idx[i].member;
  return null;
}
