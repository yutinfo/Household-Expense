/**
 * LINE webhook signature verification.
 *
 * LINE signs the RAW request body with the channel secret (HMAC-SHA256,
 * base64). The body must be verified BEFORE it is parsed or used in any way.
 */

const encoder = new TextEncoder();

async function hmacSha256(secret: string, message: ArrayBuffer): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, message);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function bufferToBase64Public(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer);
}

/** Constant-time string comparison. */
export function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies the `x-line-signature` header against the raw body bytes. */
export async function verifyLineSignature(
  channelSecret: string,
  rawBody: ArrayBuffer,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = bufferToBase64(await hmacSha256(channelSecret, rawBody));
  return safeEquals(expected, signatureHeader);
}

/** HMAC-SHA256 hex, used for the internal envelope to Apps Script. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  return bufferToHex(await hmacSha256(secret, encoder.encode(message).buffer as ArrayBuffer));
}
