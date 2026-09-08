/**
 * LineService.gs — LINE Messaging API calls made directly from Apps Script.
 *
 * The Worker replies for the fast path (it still holds a fresh reply token).
 * These functions are used by recovery, schedulers, and slip downloads, where
 * the reply token is gone or the payload is binary.
 */

var LINE_API = 'https://api.line.me/v2/bot';
var LINE_DATA_API = 'https://api-data.line.me/v2/bot';

function lineHeaders_() {
  return {
    Authorization: 'Bearer ' + requireSecret('LINE_CHANNEL_ACCESS_TOKEN'),
    'Content-Type': 'application/json'
  };
}

function lineReply(replyToken, messages) {
  if (!replyToken) return { ok: false, code: 'NO_TOKEN' };
  return linePost_('/message/reply', { replyToken: replyToken, messages: messages.slice(0, 5) });
}

function linePush(to, messages) {
  if (!to) return { ok: false, code: 'NO_TARGET' };
  return linePost_('/message/push', { to: to, messages: messages.slice(0, 5) });
}

function linePost_(path, payload) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + path, {
      method: 'post',
      headers: lineHeaders_(),
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, code: code };
    Logger.log('LINE ' + path + ' failed: ' + code + ' ' + configRedact(res.getContentText()).slice(0, 200));
    return { ok: false, code: 'HTTP_' + code };
  } catch (e) {
    Logger.log('LINE ' + path + ' error: ' + configRedact(String(e)));
    return { ok: false, code: 'FETCH_ERROR' };
  }
}

/** Group member profile — used only to show a display name, never to authorise. */
function lineGroupMemberProfile(groupId, userId) {
  try {
    var res = UrlFetchApp.fetch(LINE_API + '/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId), {
      method: 'get', headers: lineHeaders_(), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    return null;
  }
}

/**
 * Downloads a message's binary content (image). Returns {ok, blob, mime, size}
 * or {ok:false, code}. The access token is never written to a sheet or log.
 */
function lineGetMessageContent(messageId) {
  try {
    var res = UrlFetchApp.fetch(LINE_DATA_API + '/message/' + encodeURIComponent(messageId) + '/content', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + requireSecret('LINE_CHANNEL_ACCESS_TOKEN') },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 404 || code === 410) return { ok: false, code: 'CONTENT_EXPIRED' };
    if (code !== 200) return { ok: false, code: 'HTTP_' + code };
    var blob = res.getBlob();
    var mime = blob.getContentType() || (res.getHeaders() || {})['Content-Type'] || '';
    return { ok: true, blob: blob, mime: String(mime).split(';')[0], size: blob.getBytes().length };
  } catch (e) {
    Logger.log('LINE content error: ' + configRedact(String(e)));
    return { ok: false, code: 'FETCH_ERROR' };
  }
}
