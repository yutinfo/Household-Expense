/**
 * Cloudflare Worker — LINE webhook gateway.
 *
 * Why this exists: LINE authenticates its webhook with the `x-line-signature`
 * HTTP header, and an Apps Script Web App does not expose request headers to
 * the script. So the signature is checked here, on the raw bytes, before
 * anything is parsed — and Apps Script independently verifies an internal HMAC,
 * because "the URL is secret" is not a security control.
 *
 * Response policy toward LINE:
 *   200 — the event is durably stored (or was rejected as not ours)
 *   500 — storage failed; LINE may retry, and our event_id de-duplication
 *         makes that retry harmless
 */
import { verifyLineSignature } from './line-signature';
import { callAppsScript } from './apps-script-client';
import { replyMessages } from './line-client';

export interface Env {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  INTERNAL_SIGNING_SECRET: string;
  APPS_SCRIPT_URL: string;
  ALLOWED_GROUP_ID: string;
  BACKEND_TIMEOUT_MS?: string;
}

interface LineSource { type?: string; groupId?: string; userId?: string; }
interface LineEvent { type?: string; replyToken?: string; source?: LineSource; }

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'household-expense-gateway' });
    }
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    // 1) read the raw bytes and verify LINE's signature before parsing
    const rawBody = await request.arrayBuffer();
    const valid = await verifyLineSignature(
      env.LINE_CHANNEL_SECRET,
      rawBody,
      request.headers.get('x-line-signature')
    );
    if (!valid) {
      console.log('rejected: bad line signature');
      return new Response('Unauthorized', { status: 401 });
    }

    // 2) parse only after the signature is proven
    let body: { events?: LineEvent[] };
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return json({ ok: false, code: 'BAD_JSON' }, 400);
    }
    const events = body.events || [];

    // LINE's "Verify" button sends an empty event list.
    if (events.length === 0) return json({ ok: true, verified: true });

    // 3) group/member allowlist — an event from anywhere else is dropped here
    const allowed = events.filter(ev => ev.source?.type === 'group' && ev.source?.groupId === env.ALLOWED_GROUP_ID);
    if (allowed.length === 0) {
      console.log('ignored: events outside the allowed group');
      return json({ ok: true, ignored: events.length });
    }

    // 4) hand the raw body to Apps Script with an internal signature
    const timeout = Number(env.BACKEND_TIMEOUT_MS || '25000');
    const result = await callAppsScript(env.APPS_SCRIPT_URL, env.INTERNAL_SIGNING_SECRET, rawBody, timeout);

    if (!result.ok) {
      console.log(`backend error: ${result.code}`);
      // Storage may not have happened — ask LINE to retry.
      return json({ ok: false, code: result.code }, 500);
    }

    // 5) reply with the tokens that are still fresh. A failed reply never
    //    rolls back a saved record and never turns into a webhook retry.
    const replies = result.replies || [];
    for (const reply of replies) {
      const sent = await replyMessages(env.LINE_CHANNEL_ACCESS_TOKEN, reply.replyToken, reply.messages);
      if (!sent.ok) console.log(`reply failed (${sent.code}) — record is already saved`);
    }

    return json({ ok: true, accepted: result.accepted || 0, deferred: result.deferred || 0 });
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
