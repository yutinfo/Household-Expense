/**
 * Auth.gs — trust boundary for requests arriving from the Cloudflare Worker.
 *
 * The Web App URL is not a secret. Every request must carry a valid internal
 * HMAC over the exact raw LINE body, be fresh, and come from an allowlisted
 * group and member. A replayed nonce does no side effect (cache layer), and
 * the durable defence is event_id de-duplication in Inbox.
 */

var ENVELOPE_VERSION = '1';

function authHexFromBytes_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function authHmacHex(message, secret) {
  return authHexFromBytes_(Utilities.computeHmacSha256Signature(message, secret));
}

function authSha256Hex(input) {
  return authHexFromBytes_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input));
}

/** Timing-safe string comparison. */
function authSafeEquals(a, b) {
  var sa = String(a || ''), sb = String(b || '');
  if (sa.length !== sb.length) return false;
  var diff = 0;
  for (var i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

function authEnvelopeMessage_(envelope) {
  return [ENVELOPE_VERSION, envelope.timestamp, envelope.nonce, envelope.body_b64].join('.');
}

/**
 * Verifies an envelope. Returns {ok:true, body} where body is the raw LINE
 * JSON string, or {ok:false, code}.
 */
function authVerifyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, code: 'NO_ENVELOPE' };
  if (String(envelope.v) !== ENVELOPE_VERSION) return { ok: false, code: 'BAD_VERSION' };
  if (!envelope.timestamp || !envelope.nonce || !envelope.body_b64 || !envelope.signature) return { ok: false, code: 'INCOMPLETE' };

  var expected = authHmacHex(authEnvelopeMessage_(envelope), requireSecret('INTERNAL_SIGNING_SECRET'));
  if (!authSafeEquals(expected, String(envelope.signature).toLowerCase())) return { ok: false, code: 'BAD_SIGNATURE' };

  var ageSec = Math.abs((timeNow_().getTime() - Number(envelope.timestamp)) / 1000);
  if (!isFinite(ageSec) || ageSec > getConfigInt('ENVELOPE_MAX_AGE_SEC')) return { ok: false, code: 'STALE' };

  if (authNonceSeen_(envelope.nonce)) return { ok: false, code: 'REPLAY' };

  var body;
  try {
    body = Utilities.newBlob(Utilities.base64Decode(envelope.body_b64)).getDataAsString();
  } catch (e) {
    return { ok: false, code: 'BAD_BODY' };
  }
  return { ok: true, body: body };
}

/** Best-effort replay guard; the durable one is Inbox event_id. */
function authNonceSeen_(nonce) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'nonce:' + String(nonce).slice(0, 200);
    if (cache.get(key)) return true;
    cache.put(key, '1', getConfigInt('ENVELOPE_MAX_AGE_SEC') + 60);
    return false;
  } catch (e) {
    return false; // cache failure must not block legitimate traffic
  }
}

function authIsAllowedGroup(groupId) {
  var allowed = getConfig('ALLOWED_GROUP_ID', true);
  return !!groupId && groupId === allowed;
}

/**
 * Resolves the sender. Returns {ok:true, member} or {ok:false, code}.
 * A message without a user ID is never attributed to anyone.
 */
function authResolveSender(source) {
  if (!source) return { ok: false, code: 'NO_SOURCE' };
  if (source.type !== 'group') return { ok: false, code: 'NOT_GROUP' };
  if (!authIsAllowedGroup(source.groupId)) return { ok: false, code: 'GROUP_NOT_ALLOWED' };
  if (!source.userId) return { ok: false, code: 'NO_USER_ID' };
  var member = memberByLineUserId(source.userId);
  if (!member) return { ok: false, code: 'USER_NOT_ALLOWED' };
  return { ok: true, member: member, groupId: source.groupId, userId: source.userId };
}

// ---------------------------------------------------------------------------
// One-time onboarding codes (Phase 0). Owner generates a code from the editor,
// the member types it once in the group, then onboarding is switched off.
// ---------------------------------------------------------------------------

function authCreateOnboardingCode(memberId, ttlHours) {
  var code = idRandom_(6);
  repoAppendRows('Onboarding', [{
    code: code, member_id: memberId,
    expires_at: timePlusSecondsISO((ttlHours || 24) * 3600),
    used_by: '', used_at: '', status: 'open'
  }]);
  Logger.log('Onboarding code for ' + memberId + ': ' + code + ' (หมดอายุใน ' + (ttlHours || 24) + ' ชม.)');
  return code;
}

/**
 * Consumes a code typed in the group and binds the LINE user ID to a member.
 * Returns {ok, code, member}.
 */
function authRedeemOnboardingCode(codeText, lineUserId) {
  if (!getConfigBool('ONBOARDING_ENABLED')) return { ok: false, code: 'ONBOARDING_CLOSED' };
  return repoWithLock(function () {
    var row = repoFindOne('Onboarding', 'code', String(codeText).trim().toUpperCase());
    if (!row || row.status !== 'open') return { ok: false, code: 'INVALID_CODE' };
    if (timeIsPastISO(row.expires_at)) {
      repoUpdateRow('Onboarding', row._row, { status: 'expired' });
      return { ok: false, code: 'EXPIRED_CODE' };
    }
    var member = repoFindOne('Members', 'member_id', row.member_id);
    if (!member) return { ok: false, code: 'UNKNOWN_MEMBER' };
    if (member.line_user_id && member.line_user_id !== lineUserId) return { ok: false, code: 'ALREADY_BOUND' };
    repoUpdateRow('Members', member._row, { line_user_id: lineUserId, active: 'true' });
    repoUpdateRow('Onboarding', row._row, { status: 'used', used_by: lineUserId, used_at: timeNowISO() });
    auditLog('', '', row.member_id, 'onboarding_redeem', null, { member_id: row.member_id });
    return { ok: true, code: 'BOUND', member: repoFindOne('Members', 'member_id', row.member_id) };
  });
}

/** Turns onboarding off once both members are bound (run from the editor). */
function authCloseOnboarding() {
  PropertiesService.getScriptProperties().setProperty('ONBOARDING_ENABLED', 'false');
  configReset_();
  Logger.log('onboarding closed');
}
