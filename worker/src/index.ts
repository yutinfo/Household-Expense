/**
 * Cloudflare Worker — LINE webhook gateway.
 *
 * Why this exists: LINE authenticates its webhook with the `x-line-signature`
 * HTTP header, and an Apps Script Web App does not expose request headers to
 * the script. So the signature is checked here, on the raw bytes, before
 * anything is parsed — and Apps Script independently verifies an internal HMAC,
 * because "the URL is secret" is not a security control.
 *
 * Response policy toward LINE: acknowledge with 200 immediately.
 * LINE gives a webhook 5 seconds before it cancels the connection, and an
 * Apps Script + Sheets round trip is routinely slower than that. Waiting for
 * the backend inline meant LINE hung up, Cloudflare tore the isolate down, and
 * the reply was never sent even though the rows were already committed.
 * So the backend call and the reply run inside ctx.waitUntil(), which keeps the
 * isolate alive for up to 30s after the response — comfortably more than the
 * 20s PROCESSING_DEADLINE_MS that Apps Script bounds itself by.
 *
 * This gives up LINE's own retry on a 500, which never actually fired: LINE had
 * already cancelled at 5s. Events that do reach the Inbox are picked up by the
 * recoveryRun trigger instead.
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
      // Log what we saw so first-time setup can read the real group id here
      // (`wrangler tail`) instead of the Inbox sheet, which these events never reach.
      const seen = [...new Set(events.map(ev => ev.source?.groupId || `(${ev.source?.type ?? 'unknown'})`))];
      console.log(`ignored: events outside the allowed group — saw ${seen.join(', ')}`);
      return json({ ok: true, ignored: events.length });
    }

    // 4) acknowledge LINE now, then do the slow work in the background.
    ctx.waitUntil(deliver(env, rawBody));
    return json({ ok: true, accepted: allowed.length });
  }
};

/**
 * Calls Apps Script and sends whatever replies come back. Runs after the
 * response to LINE, so nothing here can delay the webhook acknowledgement.
 */
async function deliver(env: Env, rawBody: ArrayBuffer): Promise<void> {
  const timeout = Number(env.BACKEND_TIMEOUT_MS || '22000');
  const startedAt = Date.now();
  const result = await callAppsScript(env.APPS_SCRIPT_URL, env.INTERNAL_SIGNING_SECRET, rawBody, timeout);
  const backendMs = Date.now() - startedAt;

  if (!result.ok) {
    console.log(`backend error: ${result.code} — nothing replied; recoveryRun will pick it up if it was stored`);
    return;
  }

  // A failed reply never rolls back a saved record.
  for (const reply of result.replies || []) {
    const sent = await replyMessages(env.LINE_CHANNEL_ACCESS_TOKEN, reply.replyToken, reply.messages);
    if (!sent.ok) console.log(`reply failed (${sent.code}) — record is already saved`);
  }
  console.log(
    `delivered: accepted=${result.accepted || 0} deferred=${result.deferred || 0} ` +
    `backend=${backendMs}ms reply=${Date.now() - startedAt - backendMs}ms`
  );
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
