/**
 * Signed transport to the Apps Script Web App.
 *
 * The Web App URL is not a secret, so every request carries an HMAC over the
 * exact raw LINE body plus a timestamp and a nonce. Apps Script rejects
 * anything unsigned, stale, or replayed.
 */
import { hmacHex } from './line-signature';

export interface AppsScriptReply {
  replyToken: string;
  messages: unknown[];
}

export interface AppsScriptResponse {
  ok: boolean;
  code?: string;
  replies?: AppsScriptReply[];
  accepted?: number;
  deferred?: number;
}

const ENVELOPE_VERSION = '1';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

export async function callAppsScript(
  endpoint: string,
  signingSecret: string,
  rawBody: ArrayBuffer,
  timeoutMs: number
): Promise<AppsScriptResponse> {
  const bodyB64 = toBase64(rawBody);
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const signature = await hmacHex(signingSecret, [ENVELOPE_VERSION, timestamp, nonce, bodyB64].join('.'));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: ENVELOPE_VERSION, timestamp, nonce, body_b64: bodyB64, signature }),
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, code: `BACKEND_HTTP_${res.status}` };
    try {
      return JSON.parse(text) as AppsScriptResponse;
    } catch {
      return { ok: false, code: 'BACKEND_BAD_JSON' };
    }
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, code: aborted ? 'BACKEND_TIMEOUT' : 'BACKEND_UNREACHABLE' };
  } finally {
    clearTimeout(timer);
  }
}
