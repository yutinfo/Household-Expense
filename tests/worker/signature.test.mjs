// Run with: node --experimental-strip-types tests/worker/signature.test.mjs
import crypto from 'node:crypto';
import { verifyLineSignature, hmacHex, safeEquals } from '../../worker/src/line-signature.ts';

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

console.log('\nWorker · LINE signature');
const raw = new TextEncoder().encode(JSON.stringify({ events: [{ type: 'message' }] })).buffer;
const secret = 'line-channel-secret-for-tests';
const good = crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('base64');

check('accepts a valid base64 signature', await verifyLineSignature(secret, raw, good));
check('rejects a tampered signature', !(await verifyLineSignature(secret, raw, good.slice(0, -2) + 'AA')));
check('rejects a missing signature', !(await verifyLineSignature(secret, raw, null)));
check('rejects the wrong secret', !(await verifyLineSignature('other-secret', raw, good)));

const tampered = new TextEncoder().encode(JSON.stringify({ events: [{ type: 'postback' }] })).buffer;
check('rejects a modified body', !(await verifyLineSignature(secret, tampered, good)));

console.log('\nWorker · internal envelope HMAC');
const message = ['1', 1757300000000, 'nonce-1', 'Ym9keQ=='].join('.');
const expected = crypto.createHmac('sha256', 'internal-secret').update(message).digest('hex');
check('matches the Apps Script hex format', (await hmacHex('internal-secret', message)) === expected);
check('safeEquals is length-aware', safeEquals('abc', 'abc') && !safeEquals('abc', 'abd') && !safeEquals('abc', 'ab'));

console.log(failed ? `\n${failed} failed` : '\nall worker checks passed');
process.exit(failed ? 1 : 0);
