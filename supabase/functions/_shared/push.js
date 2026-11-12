// Web Push (VAPID, RFC 8292) met aes128gcm-versleuteling (RFC 8291) via WebCrypto.
// Draait ongewijzigd in Deno (Supabase Edge Functions) en Node 20+.
const te = new TextEncoder();

export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64u = (s) => {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// Alleen bekende pushdiensten, zodat een abonnement de server niet naar willekeurige adressen laat posten.
const ALLOWED = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    return u.protocol === 'https:' && ALLOWED.some((r) => r.test(u.hostname)) && s.endpoint.length < 1000
      && fromB64u(s.keys.p256dh).length === 65 && fromB64u(s.keys.auth).length === 16;
  } catch { return false; }
}

export async function generateVapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64u(concat(Uint8Array.of(4), fromB64u(x), fromB64u(y))), privateJwk: { kty, crv, x, y, d } };
}

export async function vapidHeader(endpoint, vapid, subject) {
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`)); // ruwe r||s, zoals JWT wil
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// opts.asKeyPair en opts.salt bestaan alleen zodat de test de voorbeeldwaarden uit RFC 8291 kan gebruiken.
export async function encrypt(plaintext, p256dh, authB64, opts = {}) {
  const ua = fromB64u(p256dh); const auth = fromB64u(authB64);
  const pair = opts.asKeyPair || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, secret, concat(te.encode('WebPush: info\0'), ua, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(te.encode(plaintext), Uint8Array.of(2))));
  return concat(salt, Uint8Array.of(0, 0, 16, 0), Uint8Array.of(asPublic.length), asPublic, data);
}

// → 'ok' | 'gone' (abonnement vervallen) | 'error'
export async function send(sub, payload, vapid, subject, fetchFn = fetch) {
  if (!validSubscription(sub)) return 'gone';
  let text = JSON.stringify(payload);
  if (te.encode(text).length > 3000) text = JSON.stringify({ ...payload, body: String(payload.body || '').slice(0, 300) });
  try {
    const res = await fetchFn(sub.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await vapidHeader(sub.endpoint, vapid, subject) },
      body: await encrypt(text, sub.keys.p256dh, sub.keys.auth),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'error';
  } catch { return 'error'; }
}
