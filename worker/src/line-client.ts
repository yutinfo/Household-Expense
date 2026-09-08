/** Minimal LINE Messaging API client for the reply path. */

const LINE_API = 'https://api.line.me/v2/bot';

export interface LineSendResult {
  ok: boolean;
  status: number;
  code?: string;
}

export async function replyMessages(
  accessToken: string,
  replyToken: string,
  messages: unknown[]
): Promise<LineSendResult> {
  if (!replyToken || !messages.length) return { ok: false, status: 0, code: 'NOTHING_TO_SEND' };
  try {
    const res = await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) })
    });
    if (res.ok) return { ok: true, status: res.status };
    // 400 here usually means the reply token expired — the record is already
    // saved, so this must never trigger a retry of the whole webhook.
    return { ok: false, status: res.status, code: `LINE_HTTP_${res.status}` };
  } catch {
    return { ok: false, status: 0, code: 'LINE_UNREACHABLE' };
  }
}

export async function pushMessages(
  accessToken: string,
  to: string,
  messages: unknown[]
): Promise<LineSendResult> {
  try {
    const res = await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) })
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, code: `LINE_HTTP_${res.status}` };
  } catch {
    return { ok: false, status: 0, code: 'LINE_UNREACHABLE' };
  }
}
